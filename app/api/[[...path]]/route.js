import { MongoClient } from 'mongodb';
import { NextResponse } from 'next/server';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

// Initialize MongoDB client
let client;
let clientPromise;

if (!client) {
  client = new MongoClient(process.env.MONGO_URL);
  clientPromise = client.connect();
}

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

// Database helper
async function getDatabase() {
  const client = await clientPromise;
  return client.db(process.env.DB_NAME);
}

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
  // In production, we'd analyze transaction patterns more sophisticatedly
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

export async function GET(request, { params }) {
  try {
    const db = await getDatabase();
    const url = new URL(request.url);
    const path = params.path ? params.path.join('/') : '';

    switch (path) {
      case 'health':
        return NextResponse.json({ status: 'healthy', timestamp: new Date().toISOString() });

      case 'link-token':
        try {
          const linkTokenRequest = {
            user: {
              client_user_id: 'unique_user_id_' + Date.now(),
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
          const accounts = await db.collection('accounts').find({}).toArray();
          return NextResponse.json(accounts);
        } catch (error) {
          console.error('Error fetching accounts:', error);
          return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 });
        }

      case 'dashboard':
        try {
          // Get all credit card accounts
          const accounts = await db.collection('accounts').find({ 
            subtype: 'credit card' 
          }).toArray();

          if (accounts.length === 0) {
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
            const balance = account.balances?.current || 0;
            const limit = account.balances?.limit || 0;
            const utilization = calculateUtilization(balance, limit);
            const band = getUtilizationBand(utilization);
            
            // Estimate statement close date
            const closeDate = inferStatementCloseDate([], account.lastStatementDate);
            const daysUntilClose = getDaysUntilClose(closeDate);
            
            // Calculate payment recommendation
            const paydownAmount = calculatePaydownAmount(balance, limit, 0.09);
            
            return {
              id: account.account_id,
              name: account.name,
              officialName: account.official_name,
              balance: balance,
              limit: limit,
              utilization: utilization,
              band: band,
              closeDate: closeDate.toISOString(),
              daysUntilClose: daysUntilClose,
              paydownAmount: paydownAmount,
              lastUpdated: account.lastUpdated || new Date().toISOString()
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
    const db = await getDatabase();
    const url = new URL(request.url);
    const path = params.path ? params.path.join('/') : '';
    const body = await request.json();

    switch (path) {
      case 'exchange-token':
        try {
          const { public_token } = body;
          
          // Exchange public token for access token
          const tokenResponse = await plaidClient.itemPublicTokenExchange({
            public_token: public_token,
          });

          const accessToken = tokenResponse.data.access_token;
          const itemId = tokenResponse.data.item_id;

          // Get account information
          const accountsResponse = await plaidClient.accountsGet({
            access_token: accessToken,
          });

          const accounts = accountsResponse.data.accounts;

          // Store accounts in database
          for (const account of accounts) {
            await db.collection('accounts').updateOne(
              { account_id: account.account_id },
              {
                $set: {
                  ...account,
                  access_token: accessToken,
                  item_id: itemId,
                  lastUpdated: new Date().toISOString(),
                  // Try to get last statement date from account metadata
                  lastStatementDate: null // Will be refined over time
                }
              },
              { upsert: true }
            );
          }

          // Get initial transactions to help infer statement cycles
          try {
            const transactionsResponse = await plaidClient.transactionsGet({
              access_token: accessToken,
              start_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 90 days ago
              end_date: new Date().toISOString().split('T')[0],
            });

            // Store transactions for statement cycle analysis
            await db.collection('transactions').insertMany(
              transactionsResponse.data.transactions.map(tx => ({
                ...tx,
                access_token: accessToken,
                lastUpdated: new Date().toISOString()
              }))
            );
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
          const accounts = await db.collection('accounts').find({}).toArray();
          let updatedCount = 0;

          for (const account of accounts) {
            if (account.access_token) {
              try {
                const accountsResponse = await plaidClient.accountsGet({
                  access_token: account.access_token,
                });

                const updatedAccount = accountsResponse.data.accounts.find(
                  acc => acc.account_id === account.account_id
                );

                if (updatedAccount) {
                  await db.collection('accounts').updateOne(
                    { account_id: account.account_id },
                    {
                      $set: {
                        ...updatedAccount,
                        access_token: account.access_token,
                        item_id: account.item_id,
                        lastUpdated: new Date().toISOString(),
                        lastStatementDate: account.lastStatementDate
                      }
                    }
                  );
                  updatedCount++;
                }
              } catch (error) {
                console.warn(`Failed to update account ${account.account_id}:`, error);
              }
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
          const { cardId, target, monthlyLimit } = body;
          
          await db.collection('user_settings').updateOne(
            { userId: 'default' }, // In a real app, use actual user ID
            {
              $set: {
                [`cardTargets.${cardId}`]: target,
                monthlyLimit: monthlyLimit,
                lastUpdated: new Date().toISOString()
              }
            },
            { upsert: true }
          );

          return NextResponse.json({ success: true });
        } catch (error) {
          console.error('Error updating targets:', error);
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