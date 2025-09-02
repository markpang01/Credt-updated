import { NextResponse } from 'next/server';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { createServiceClient, createServerClient } from '@/lib/supabase/server';
import { encryptSensitiveData, decryptSensitiveData } from '@/lib/security/encryption';
import { 
  validateRequest, 
  tokenExchangeSchema, 
  accountUpdateSchema,
  validateEnvironment,
  sanitizeString 
} from '@/lib/security/validation';

// Initialize Plaid client
const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

// Validate environment on startup
try {
  validateEnvironment();
  console.log('✅ Environment validation passed');
} catch (error) {
  console.error('❌ Environment validation failed:', error.message);
  // In production, you might want to exit the process here
}

// Rate limiting storage (in production, use Redis)
const rateLimitStore = new Map();

// Utility functions for utilization calculations
function calculateUtilization(balance, limit) {
  return limit > 0 ? Math.round((balance / limit) * 100) : 0;
}

function getUtilizationBand(utilization) {
  if (utilization <= 9) return { band: 'excellent', color: 'green', description: '0-9% (Excellent)' };
  if (utilization <= 29) return { band: 'good', color: 'blue', description: '10-29% (Good)' };
  if (utilization <= 49) return { band: 'warning', color: 'yellow', description: '30-49% (Penalty Begins)' };
  if (utilization <= 74) return { band: 'bad', color: 'orange', description: '50-74% (Large Penalty)' };
  return { band: 'severe', color: 'red', description: '75-100% (Severe)' };
}

function calculatePaydownAmount(currentBalance, limit, targetUtilization = 0.09) {
  const maxAllowed = limit * targetUtilization;
  if (currentBalance <= maxAllowed) return 0;
  return Math.ceil(currentBalance - maxAllowed);
}

// Infer statement close date from transaction history
function inferStatementCloseDate(transactions, lastStatementDate) {
  if (lastStatementDate) {
    const lastDate = new Date(lastStatementDate);
    const nextMonth = new Date(lastDate);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return nextMonth;
  }
  
  // Fallback: assume close date is around same day each month
  const today = new Date();
  const estimatedCloseDay = 15; // Default assumption
  const closeDate = new Date(today.getFullYear(), today.getMonth(), estimatedCloseDay);
  
  if (closeDate < today) {
    closeDate.setMonth(closeDate.getMonth() + 1);
  }
  
  return closeDate;
}

// Calculate days until close with buffer
function getDaysUntilClose(closeDate, buffer = 2) {
  const today = new Date();
  const diffTime = closeDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays - buffer);
}

// Helper function to get decrypted access token
async function getDecryptedAccessToken(encryptedToken) {
  if (typeof encryptedToken === 'string') {
    // If it's already a plain string (backward compatibility)
    return encryptedToken;
  }
  
  if (encryptedToken && encryptedToken.iv && encryptedToken.tag && encryptedToken.encrypted) {
    // If it's an encrypted object, decrypt it
    return decryptSensitiveData(encryptedToken);
  }
  
  throw new Error('Invalid access token format');
}

// Simple rate limiting function
function checkRateLimit(identifier, limit = 100, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const windowStart = now - windowMs;
  
  if (!rateLimitStore.has(identifier)) {
    rateLimitStore.set(identifier, []);
  }
  
  const requests = rateLimitStore.get(identifier);
  const recentRequests = requests.filter(timestamp => timestamp > windowStart);
  
  if (recentRequests.length >= limit) {
    return false;
  }
  
  recentRequests.push(now);
  rateLimitStore.set(identifier, recentRequests);
  return true;
}

// Get authenticated user
async function getAuthenticatedUser(request) {
  try {
    const supabase = createServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      return null;
    }
    
    return user;
  } catch (error) {
    console.error('Auth error:', error);
    return null;
  }
}

export async function GET(request, { params }) {
  try {
    const url = new URL(request.url);
    const path = params.path ? params.path.join('/') : '';
    
    // Get client IP for rate limiting (fallback to user-agent if no IP)
    const clientId = request.headers.get('x-forwarded-for') || 
                    request.headers.get('x-real-ip') || 
                    request.headers.get('user-agent') || 
                    'anonymous';

    // Health check doesn't require auth or rate limiting
    if (path === 'health') {
      return NextResponse.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        environment: process.env.PLAID_ENV || 'unknown'
      });
    }

    // Apply rate limiting to other endpoints
    if (!checkRateLimit(clientId, 100, 15 * 60 * 1000)) {
      return NextResponse.json({ 
        error: 'Rate limit exceeded. Please try again later.' 
      }, { status: 429 });
    }

    // Get authenticated user for all other routes
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient();

    switch (path) {
      case 'link-token':
        try {
          const linkTokenRequest = {
            user: {
              client_user_id: user.id, // Use actual user ID from Supabase auth
            },
            client_name: 'Utilization Pilot',
            products: ['assets', 'transactions'],
            country_codes: ['US'],
            language: 'en',
            account_filters: {
              depository: {
                account_subtypes: ['checking', 'savings'],
              },
              credit: {
                account_subtypes: ['credit card'],
              },
            },
          };

          const response = await plaidClient.linkTokenCreate(linkTokenRequest);
          return NextResponse.json({ link_token: response.data.link_token });
        } catch (error) {
          console.error('Error creating link token:', error);
          return NextResponse.json({ error: 'Failed to create link token' }, { status: 500 });
        }

      case 'accounts':
        try {
          const { data: accounts, error } = await supabase
            .from('accounts')
            .select('*')
            .eq('user_id', user.id)
            .eq('is_active', true);

          if (error) throw error;

          return NextResponse.json(accounts || []);
        } catch (error) {
          console.error('Error fetching accounts:', error);
          return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 });
        }

      case 'dashboard':
        try {
          // Get all credit card accounts for the user
          const { data: accounts, error } = await supabase
            .from('accounts')
            .select('*')
            .eq('user_id', user.id)
            .eq('subtype', 'credit card')
            .eq('is_active', true);

          if (error) throw error;

          if (!accounts || accounts.length === 0) {
            return NextResponse.json({
              creditCards: [],
              overallUtilization: 0,
              totalLimit: 0,
              totalBalance: 0,
              recommendations: [],
              summary: {
                excellentCards: 0,
                goodCards: 0,
                warningCards: 0,
                badCards: 0,
                severeCards: 0
              }
            });
          }

          // Calculate utilization for each card
          const creditCards = accounts.map(account => {
            const balance = account.current_balance || 0;
            const limit = account.credit_limit || 0;
            const utilization = calculateUtilization(balance, limit);
            const band = getUtilizationBand(utilization);
            
            // Estimate statement close date
            const closeDate = inferStatementCloseDate([], account.last_statement_date);
            const daysUntilClose = getDaysUntilClose(closeDate);
            
            // Calculate payment recommendation
            const paydownAmount = calculatePaydownAmount(balance, limit, account.target_utilization || 0.09);
            
            return {
              id: account.id,
              name: account.name,
              officialName: account.official_name,
              balance: balance,
              limit: limit,
              utilization: utilization,
              band: band,
              closeDate: closeDate.toISOString(),
              daysUntilClose: daysUntilClose,
              paydownAmount: paydownAmount,
              lastUpdated: account.updated_at
            };
          });

          // Calculate overall utilization
          const totalBalance = creditCards.reduce((sum, card) => sum + card.balance, 0);
          const totalLimit = creditCards.reduce((sum, card) => sum + card.limit, 0);
          const overallUtilization = calculateUtilization(totalBalance, totalLimit);

          // Generate recommendations
          const recommendations = creditCards
            .filter(card => card.paydownAmount > 0 && card.daysUntilClose >= 0)
            .sort((a, b) => b.utilization - a.utilization)
            .map(card => ({
              cardId: card.id,
              cardName: card.name,
              amount: card.paydownAmount,
              currentUtilization: card.utilization,
              targetUtilization: 9,
              daysUntilClose: card.daysUntilClose,
              closeDate: card.closeDate,
              priority: card.utilization >= 75 ? 'high' : card.utilization >= 50 ? 'medium' : 'low'
            }));

          // Summary stats
          const summary = {
            excellentCards: creditCards.filter(c => c.band.band === 'excellent').length,
            goodCards: creditCards.filter(c => c.band.band === 'good').length,
            warningCards: creditCards.filter(c => c.band.band === 'warning').length,
            badCards: creditCards.filter(c => c.band.band === 'bad').length,
            severeCards: creditCards.filter(c => c.band.band === 'severe').length
          };

          return NextResponse.json({
            creditCards,
            overallUtilization,
            totalLimit,
            totalBalance,
            recommendations,
            summary
          });

        } catch (error) {
          console.error('Error fetching dashboard data:', error);
          return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 });
        }

      case 'user-profile':
        try {
          const { data: profile, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', user.id)
            .single();

          if (error && error.code !== 'PGRST116') throw error;

          return NextResponse.json(profile || { id: user.id, email: user.email });
        } catch (error) {
          console.error('Error fetching user profile:', error);
          return NextResponse.json({ error: 'Failed to fetch user profile' }, { status: 500 });
        }

      default:
        return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const url = new URL(request.url);
    const path = params.path ? params.path.join('/') : '';
    
    // Get client IP for rate limiting
    const clientId = request.headers.get('x-forwarded-for') || 
                    request.headers.get('x-real-ip') || 
                    request.headers.get('user-agent') || 
                    'anonymous';

    // Apply stricter rate limiting to POST endpoints
    if (!checkRateLimit(`post_${clientId}`, 20, 15 * 60 * 1000)) {
      return NextResponse.json({ 
        error: 'Rate limit exceeded. Please try again later.' 
      }, { status: 429 });
    }

    const body = await request.json();

    // Get authenticated user
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient();

    switch (path) {
      case 'exchange-token':
        try {
          // Validate input using Zod schema
          const validatedData = validateRequest(tokenExchangeSchema, body);
          const { public_token, metadata } = validatedData;
          
          console.log('Exchanging public token for user:', user.id);
          
          // Exchange public token for access token
          const tokenResponse = await plaidClient.itemPublicTokenExchange({
            public_token: public_token,
          });

          const accessToken = tokenResponse.data.access_token;
          const itemId = tokenResponse.data.item_id;
          
          console.log('Token exchange successful, encrypting access token...');
          
          // Encrypt the access token before storage
          const encryptedAccessToken = encryptSensitiveData(accessToken);
          
          console.log('Access token encrypted, fetching account details...');

          // Get account information
          const accountsResponse = await plaidClient.accountsGet({
            access_token: accessToken,
          });

          const accounts = accountsResponse.data.accounts;

          // Store Plaid item with encrypted access token
          const { data: plaidItem, error: itemError } = await supabase
            .from('plaid_items')
            .upsert({
              user_id: user.id,
              item_id: itemId,
              access_token: encryptedAccessToken, // Store encrypted token
              institution_id: metadata?.institution?.institution_id,
              institution_name: sanitizeString(metadata?.institution?.name || ''),
              is_active: true,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'user_id,item_id'
            })
            .select()
            .single();

          if (itemError) throw itemError;

          // Store accounts in database with input sanitization
          const accountInserts = accounts.map(account => ({
            user_id: user.id,
            plaid_item_id: plaidItem.id,
            account_id: account.account_id,
            name: sanitizeString(account.name || ''),
            official_name: sanitizeString(account.official_name || ''),
            type: sanitizeString(account.type || ''),
            subtype: sanitizeString(account.subtype || ''),
            current_balance: Math.max(0, account.balances.current || 0),
            available_balance: account.balances.available,
            credit_limit: Math.max(0, account.balances.limit || 0),
            target_utilization: 0.09, // Default 9%
            is_active: true,
            updated_at: new Date().toISOString()
          }));

          const { data: insertedAccounts, error: accountsError } = await supabase
            .from('accounts')
            .upsert(accountInserts, {
              onConflict: 'user_id,account_id'
            });

          if (accountsError) throw accountsError;

          // Get initial transactions for statement cycle analysis
          try {
            const transactionsResponse = await plaidClient.transactionsGet({
              access_token: accessToken,
              start_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              end_date: new Date().toISOString().split('T')[0],
            });

            // Store transactions
            if (transactionsResponse.data.transactions.length > 0) {
              const transactionInserts = transactionsResponse.data.transactions.map(tx => ({
                user_id: user.id,
                account_id: accounts.find(acc => acc.account_id === tx.account_id)?.account_id,
                transaction_id: tx.transaction_id,
                amount: tx.amount,
                date: tx.date,
                name: tx.name,
                merchant_name: tx.merchant_name,
                category: tx.category,
                is_pending: tx.pending
              })).filter(tx => tx.account_id); // Only include transactions for accounts we have

              // Find the corresponding account UUIDs
              const { data: accountsData } = await supabase
                .from('accounts')
                .select('id, account_id')
                .eq('user_id', user.id);

              const accountMap = accountsData.reduce((map, acc) => {
                map[acc.account_id] = acc.id;
                return map;
              }, {});

              const finalTransactionInserts = transactionInserts.map(tx => ({
                ...tx,
                account_id: accountMap[tx.account_id]
              })).filter(tx => tx.account_id);

              await supabase
                .from('transactions')
                .upsert(finalTransactionInserts, {
                  onConflict: 'user_id,transaction_id'
                });
            }
          } catch (transactionError) {
            console.warn('Could not fetch transactions:', transactionError);
          }

          return NextResponse.json({ 
            success: true, 
            accounts: accounts.length,
            message: 'Accounts linked successfully' 
          });

        } catch (error) {
          console.error('Error exchanging token:', error);
          return NextResponse.json({ error: 'Failed to exchange token' }, { status: 500 });
        }

      case 'refresh-accounts':
        try {
          // Get all active Plaid items for the user
          const { data: plaidItems, error: itemsError } = await supabase
            .from('plaid_items')
            .select('*')
            .eq('user_id', user.id)
            .eq('is_active', true);

          if (itemsError) throw itemsError;

          let updatedCount = 0;

          for (const item of plaidItems) {
            try {
              // Decrypt the access token
              const accessToken = await getDecryptedAccessToken(item.access_token);
              
              const accountsResponse = await plaidClient.accountsGet({
                access_token: accessToken,
              });

              const accounts = accountsResponse.data.accounts;

              for (const account of accounts) {
                const { error: updateError } = await supabase
                  .from('accounts')
                  .update({
                    current_balance: account.balances.current || 0,
                    available_balance: account.balances.available,
                    credit_limit: account.balances.limit,
                    updated_at: new Date().toISOString()
                  })
                  .eq('user_id', user.id)
                  .eq('account_id', account.account_id);

                if (!updateError) {
                  updatedCount++;
                }
              }
            } catch (error) {
              console.warn(`Failed to update accounts for item ${item.item_id}:`, error);
            }
          }

          return NextResponse.json({ 
            success: true, 
            updated: updatedCount,
            message: `Updated ${updatedCount} accounts` 
          });

        } catch (error) {
          console.error('Error refreshing accounts:', error);
          return NextResponse.json({ error: 'Failed to refresh accounts' }, { status: 500 });
        }

      case 'update-targets':
        try {
          // Validate input using Zod schema
          const validatedData = validateRequest(accountUpdateSchema, body);
          const { accountId, target_utilization, monthly_paydown_limit } = validatedData;
          
          if (accountId && target_utilization !== undefined) {
            const { error: accountError } = await supabase
              .from('accounts')
              .update({ target_utilization })
              .eq('user_id', user.id)
              .eq('id', accountId);

            if (accountError) throw accountError;
          }

          if (monthly_paydown_limit !== undefined) {
            const { error: profileError } = await supabase
              .from('user_profiles')
              .update({ monthly_paydown_limit })
              .eq('id', user.id);

            if (profileError) throw profileError;
          }

          return NextResponse.json({ success: true });
        } catch (error) {
          console.error('Error updating targets:', error);
          if (error.message.includes('Validation failed')) {
            return NextResponse.json({ error: error.message }, { status: 400 });
          }
          return NextResponse.json({ error: 'Failed to update targets' }, { status: 500 });
        }

      default:
        return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }
  } catch (error) {
    console.error('API POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}