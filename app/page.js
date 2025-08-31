'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePlaidLink } from 'react-plaid-link';
import { createClient } from '@/lib/supabase/client';
import { 
  CreditCard, 
  TrendingUp, 
  TrendingDown,
  AlertCircle, 
  CheckCircle2, 
  RefreshCw,
  Calendar,
  DollarSign,
  Target,
  Zap,
  LogIn,
  LogOut,
  User
} from 'lucide-react';

const COLORS = {
  excellent: '#10b981', // green
  good: '#3b82f6',      // blue
  warning: '#f59e0b',   // yellow
  bad: '#f97316',       // orange
  severe: '#ef4444'     // red
};

export default function UtilizationPilot() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [linkToken, setLinkToken] = useState(null);
  const [dashboardData, setDashboardData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const supabase = createClient();

  // Initialize app and check auth status
  useEffect(() => {
    let mounted = true;
    
    const initializeApp = async () => {
      try {
        console.log('Initializing Utilization Pilot with Supabase...');
        
        // Check initial auth state
        const { data: { user: initialUser } } = await supabase.auth.getUser();
        
        if (mounted) {
          setUser(initialUser);
          
          if (initialUser) {
            console.log('User authenticated:', initialUser.email);
            await loadUserData();
          } else {
            console.log('No authenticated user');
            setLoading(false);
          }
        }
      } catch (error) {
        console.error('App initialization error:', error);
        if (mounted) {
          setError('Failed to initialize app');
          setLoading(false);
        }
      }
    };
    
    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session?.user?.email);
      
      if (mounted) {
        setUser(session?.user ?? null);
        
        if (session?.user) {
          await loadUserData();
        } else {
          setDashboardData(null);
          setLinkToken(null);
          setLoading(false);
        }
      }
    });
    
    initializeApp();
    
    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  const loadUserData = async () => {
    try {
      console.log('Loading user data...');
      
      // Load dashboard and link token in parallel
      const [dashboardResponse, linkTokenResponse] = await Promise.all([
        fetch('/api/dashboard'),
        fetch('/api/link-token')
      ]);
      
      if (dashboardResponse.ok) {
        const dashboardData = await dashboardResponse.json();
        console.log('Dashboard loaded:', dashboardData);
        setDashboardData(dashboardData);
      } else {
        console.error('Dashboard fetch failed:', dashboardResponse.status);
      }
      
      if (linkTokenResponse.ok) {
        const linkData = await linkTokenResponse.json();
        if (linkData.link_token) {
          console.log('Plaid Link token ready');
          setLinkToken(linkData.link_token);
        }
      } else {
        console.error('Link token fetch failed:', linkTokenResponse.status);
      }
      
    } catch (error) {
      console.error('Error loading user data:', error);
      setError('Failed to load user data');
    } finally {
      setLoading(false);
    }
  };

  const signInWithEmail = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) throw error;

      alert('Check your email for the magic link!');
    } catch (error) {
      console.error('Sign in error:', error);
      setError(error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Sign out error:', error);
    }
  };

  const refreshAccounts = async () => {
    try {
      setRefreshing(true);
      const response = await fetch('/api/refresh-accounts', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        await loadUserData();
      }
    } catch (error) {
      console.error('Error refreshing accounts:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const plaidConfig = {
    token: linkToken,
    onSuccess: async (public_token, metadata) => {
      console.log('Plaid Link success! Connected accounts:', metadata.accounts.length);
      console.log('Institution:', metadata.institution.name);
      
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch('/api/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            public_token,
            metadata: {
              institution: metadata.institution,
              accounts: metadata.accounts
            }
          }),
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Account linking successful:', data);
        
        if (data.success) {
          await loadUserData();
          console.log(`Successfully linked ${data.accounts} accounts!`);
        } else {
          setError('Failed to save account information');
        }
      } catch (error) {
        console.error('Error exchanging token:', error);
        setError('Failed to link accounts. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    onExit: (err, metadata) => {
      if (err) {
        console.error('Plaid Link error:', err);
        if (err.error_code !== 'USER_CANCELLED') {
          setError('Account linking failed. Please try again.');
        }
      } else {
        console.log('User exited Plaid Link');
      }
    },
    env: 'sandbox',
  };
  
  const { open: openPlaidLink, ready } = usePlaidLink(plaidConfig);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getBandColor = (band) => {
    return COLORS[band] || '#6b7280';
  };

  // Show loading screen
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading your credit utilization data...</p>
        </div>
      </div>
    );
  }

  // TEMPORARY: Mock data for UI preview (bypass authentication)
  const mockDashboardData = {
    creditCards: [
      {
        id: '1',
        name: 'Chase Sapphire Preferred',
        officialName: 'Chase Sapphire Preferred Card',
        balance: 4200,
        limit: 15000,
        utilization: 28,
        band: { band: 'good', color: 'blue', description: '10-29% (Good)' },
        closeDate: new Date('2025-02-15').toISOString(),
        daysUntilClose: 12,
        paydownAmount: 2850, // To get to 9%
        lastUpdated: new Date().toISOString()
      },
      {
        id: '2', 
        name: 'Capital One Venture X',
        officialName: 'Capital One Venture X Rewards Credit Card',
        balance: 8500,
        limit: 10000,
        utilization: 85,
        band: { band: 'severe', color: 'red', description: '75-100% (Severe)' },
        closeDate: new Date('2025-02-18').toISOString(),
        daysUntilClose: 15,
        paydownAmount: 7600, // To get to 9%
        lastUpdated: new Date().toISOString()
      },
      {
        id: '3',
        name: 'American Express Gold',
        officialName: 'Gold Card from American Express',
        balance: 450,
        limit: 25000,
        utilization: 2,
        band: { band: 'excellent', color: 'green', description: '0-9% (Excellent)' },
        closeDate: new Date('2025-02-20').toISOString(),
        daysUntilClose: 17,
        paydownAmount: 0,
        lastUpdated: new Date().toISOString()
      },
      {
        id: '4',
        name: 'Citi Double Cash',
        officialName: 'Citi Double Cash Card',
        balance: 3750,
        limit: 8000,
        utilization: 47,
        band: { band: 'warning', color: 'yellow', description: '30-49% (Penalty Begins)' },
        closeDate: new Date('2025-02-10').toISOString(),
        daysUntilClose: 7,
        paydownAmount: 3030, // To get to 9%
        lastUpdated: new Date().toISOString()
      },
      {
        id: '5',
        name: 'Discover it Cash Back',
        officialName: 'Discover it Cash Back',
        balance: 1200,
        limit: 12000,
        utilization: 10,
        band: { band: 'good', color: 'blue', description: '10-29% (Good)' },
        closeDate: new Date('2025-02-25').toISOString(),
        daysUntilClose: 22,
        paydownAmount: 120, // To get to 9%
        lastUpdated: new Date().toISOString()
      }
    ],
    overallUtilization: 31, // (4200+8500+450+3750+1200) / (15000+10000+25000+8000+12000)
    totalLimit: 70000,
    totalBalance: 18100,
    recommendations: [
      {
        cardId: '2',
        cardName: 'Capital One Venture X',
        amount: 7600,
        currentUtilization: 85,
        targetUtilization: 9,
        daysUntilClose: 15,
        closeDate: new Date('2025-02-18').toISOString(),
        priority: 'high'
      },
      {
        cardId: '4', 
        cardName: 'Citi Double Cash',
        amount: 3030,
        currentUtilization: 47,
        targetUtilization: 9,
        daysUntilClose: 7,
        closeDate: new Date('2025-02-10').toISOString(),
        priority: 'high'
      },
      {
        cardId: '1',
        cardName: 'Chase Sapphire Preferred', 
        amount: 2850,
        currentUtilization: 28,
        targetUtilization: 9,
        daysUntilClose: 12,
        closeDate: new Date('2025-02-15').toISOString(),
        priority: 'medium'
      },
      {
        cardId: '5',
        cardName: 'Discover it Cash Back',
        amount: 120,
        currentUtilization: 10,
        targetUtilization: 9,
        daysUntilClose: 22,
        closeDate: new Date('2025-02-25').toISOString(),
        priority: 'low'
      }
    ],
    summary: {
      excellentCards: 1,
      goodCards: 2, 
      warningCards: 1,
      badCards: 0,
      severeCards: 1
    }
  };

  // TEMPORARY: Use mock data instead of authentication
  const tempUser = { email: 'demo@example.com' };
  const tempDashboardData = mockDashboardData;

  // Show authentication screen if not logged in
  if (!tempUser) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center max-w-2xl mx-auto">
            <div className="mb-8">
              <Zap className="h-16 w-16 mx-auto mb-4 text-primary" />
              <h1 className="text-4xl font-bold mb-2">Utilization Pilot</h1>
              <p className="text-xl text-muted-foreground mb-8">
                Time your payments to what credit models actually see
              </p>
            </div>

            {error && (
              <Alert className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="flex items-center justify-center">
                  <LogIn className="mr-2 h-5 w-5" />
                  Sign In to Get Started
                </CardTitle>
                <CardDescription>
                  Get personalized credit utilization tracking and payment recommendations
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={signInWithEmail} className="space-y-4">
                  <Input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full"
                  />
                  <Button 
                    type="submit" 
                    disabled={authLoading}
                    className="w-full"
                    size="lg"
                  >
                    {authLoading ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Sending Magic Link...
                      </>
                    ) : (
                      <>
                        <LogIn className="mr-2 h-4 w-4" />
                        Send Magic Link
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="text-left space-y-4">
              <h3 className="text-lg font-semibold">How It Works</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-4 border rounded-lg">
                  <Calendar className="h-8 w-8 text-blue-500 mb-2" />
                  <h4 className="font-medium mb-1">Statement Close Tracking</h4>
                  <p className="text-sm text-muted-foreground">
                    We track when your credit cards report to bureaus (statement close dates), not just payment due dates.
                  </p>
                </div>
                <div className="p-4 border rounded-lg">
                  <Target className="h-8 w-8 text-green-500 mb-2" />
                  <h4 className="font-medium mb-1">Utilization Optimization</h4>
                  <p className="text-sm text-muted-foreground">
                    Get alerts to make small pre-close payments that keep your reported balances in healthy bands (0-9%).
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show onboarding if user has no credit cards connected
  if (tempDashboardData && (!tempDashboardData.creditCards || tempDashboardData.creditCards.length === 0)) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          {/* Header with user info */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center space-x-4">
              <Zap className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-2xl font-bold">Utilization Pilot</h1>
                <p className="text-sm text-muted-foreground">Welcome, {tempUser.email}!</p>
              </div>
            </div>
            <Button onClick={signOut} variant="outline" size="sm">
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>

          <div className="text-center max-w-2xl mx-auto">
            {error && (
              <Alert className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Connect Your Accounts</CardTitle>
                <CardDescription>
                  Link your credit cards and checking account to start optimizing your credit utilization
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span>Track utilization in real-time</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span>Get payment timing alerts</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span>Optimize before statement close</span>
                  </div>
                </div>
                <Button 
                  onClick={() => {
                    if (linkToken && ready) {
                      openPlaidLink();
                    } else {
                      console.log('Plaid Link not ready yet. Token:', !!linkToken, 'Ready:', ready);
                    }
                  }}
                  disabled={!linkToken || !ready}
                  className="w-full"
                  size="lg"
                >
                  <CreditCard className="mr-2 h-5 w-5" />
                  {!linkToken ? 'Loading...' : 'Connect Your Accounts'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Main dashboard with credit card data
  const { creditCards, overallUtilization, totalLimit, totalBalance, recommendations, summary } = tempDashboardData || {};

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <Zap className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-3xl font-bold">Utilization Pilot</h1>
              <p className="text-muted-foreground">Credit utilization optimization dashboard</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <Button onClick={refreshAccounts} disabled={refreshing} variant="outline">
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh Data
            </Button>
            <Button onClick={signOut} variant="outline" size="sm">
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>

        {error && (
          <Alert className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Priority Recommendations - Only cards needing payment within 2 weeks */}
        {recommendations && recommendations.filter(rec => rec.daysUntilClose <= 14).length > 0 && (
          <Alert className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Urgent Payment Recommendations</AlertTitle>
            <AlertDescription>
              <div className="mt-3 grid gap-2">
                {recommendations.filter(rec => rec.daysUntilClose <= 14).slice(0, 3).map((rec, index) => (
                  <div key={index} className="flex items-center justify-between bg-white/50 rounded-md px-3 py-2 border">
                    <div className="flex items-center space-x-3">
                      <Badge variant={rec.priority === 'high' ? 'destructive' : rec.priority === 'medium' ? 'default' : 'secondary'} className="text-xs">
                        {rec.priority.toUpperCase()}
                      </Badge>
                      <span className="font-medium text-sm">{rec.cardName}</span>
                      <span className="text-xs text-muted-foreground">
                        {rec.currentUtilization}% → {rec.targetUtilization}%
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-sm">Pay {formatCurrency(rec.amount)}</div>
                      <div className="text-xs text-muted-foreground">by {formatDate(rec.closeDate)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Overall Utilization</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{overallUtilization}%</div>
              <Progress value={overallUtilization} className="mt-2" />
              <p className="text-xs text-muted-foreground mt-2">
                {formatCurrency(totalBalance)} of {formatCurrency(totalLimit)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cards in Excellent Range</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div className="cursor-pointer hover:bg-muted/50 rounded-md p-1 -m-1">
                    <div className="text-2xl font-bold text-green-600">{summary?.excellentCards || 0}</div>
                    <p className="text-xs text-muted-foreground">0-9% utilization ▼</p>
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-80 max-h-96 overflow-y-auto">
                  {creditCards?.filter(card => card.band.band === 'excellent').map(card => (
                    <div key={card.id} className="p-3 border-b last:border-b-0">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center">
                          <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                          <span className="font-medium text-sm">{card.name}</span>
                        </div>
                        <Badge style={{ backgroundColor: getBandColor(card.band.band) }} className="text-white text-xs">
                          {card.utilization}% - {card.band.band.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">{card.officialName}</div>
                      <Progress value={card.utilization} className="h-1 mb-2" />
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Balance:</span>
                          <div className="font-medium">{formatCurrency(card.balance)}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Limit:</span>
                          <div className="font-medium">{formatCurrency(card.limit)}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Statement Close:</span>
                          <div className="font-medium">{formatDate(card.closeDate)}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Days Until Close:</span>
                          <div className={`font-medium ${card.daysUntilClose <= 3 ? 'text-red-600' : 'text-green-600'}`}>
                            {card.daysUntilClose} days
                          </div>
                        </div>
                      </div>
                      {card.paydownAmount > 0 && (
                        <div className="mt-2 p-2 bg-green-50 rounded text-xs">
                          <span className="text-green-700 font-medium">
                            Pay {formatCurrency(card.paydownAmount)} by {formatDate(card.closeDate)} to maintain 9% utilization
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                  {creditCards?.filter(card => card.band.band === 'excellent').length === 0 && (
                    <div className="p-3 text-center text-muted-foreground text-sm">No cards in excellent range</div>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cards Need Attention</CardTitle>
              <AlertCircle className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div className="cursor-pointer hover:bg-muted/50 rounded-md p-1 -m-1">
                    <div className="text-2xl font-bold text-orange-600">
                      {(summary?.warningCards || 0) + (summary?.badCards || 0) + (summary?.severeCards || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground">Above 30% utilization ▼</p>
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-80 max-h-96 overflow-y-auto">
                  {creditCards?.filter(card => card.utilization >= 30).map(card => (
                    <div key={card.id} className="p-3 border-b last:border-b-0">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center">
                          <div className={`w-3 h-3 rounded-full mr-2 ${
                            card.band.band === 'severe' ? 'bg-red-500' : 
                            card.band.band === 'bad' ? 'bg-orange-500' : 'bg-yellow-500'
                          }`}></div>
                          <span className="font-medium text-sm">{card.name}</span>
                        </div>
                        <Badge style={{ backgroundColor: getBandColor(card.band.band) }} className="text-white text-xs">
                          {card.utilization}% - {card.band.band.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">{card.officialName}</div>
                      <Progress value={card.utilization} className="h-1 mb-2" />
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Balance:</span>
                          <div className="font-medium">{formatCurrency(card.balance)}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Limit:</span>
                          <div className="font-medium">{formatCurrency(card.limit)}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Statement Close:</span>
                          <div className="font-medium">{formatDate(card.closeDate)}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Days Until Close:</span>
                          <div className={`font-medium ${card.daysUntilClose <= 3 ? 'text-red-600' : 'text-green-600'}`}>
                            {card.daysUntilClose} days
                          </div>
                        </div>
                      </div>
                      {card.paydownAmount > 0 && (
                        <div className={`mt-2 p-2 rounded text-xs ${
                          card.band.band === 'severe' ? 'bg-red-50' : 
                          card.band.band === 'bad' ? 'bg-orange-50' : 'bg-yellow-50'
                        }`}>
                          <span className={`font-medium ${
                            card.band.band === 'severe' ? 'text-red-700' : 
                            card.band.band === 'bad' ? 'text-orange-700' : 'text-yellow-700'
                          }`}>
                            RECOMMENDED: Pay {formatCurrency(card.paydownAmount)} by {formatDate(card.closeDate)} to achieve 9% utilization
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                  {creditCards?.filter(card => card.utilization >= 30).length === 0 && (
                    <div className="p-3 text-center text-muted-foreground text-sm">No cards need attention</div>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Credit Limit</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(totalLimit)}</div>
              <p className="text-xs text-muted-foreground">Available credit power</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="cards" className="space-y-6">
          <TabsList>
            <TabsTrigger value="cards">Credit Cards</TabsTrigger>
            <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="cards" className="space-y-6">
            <div className="grid gap-6">
              {creditCards && creditCards.map((card) => (
                <Card key={card.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center">
                          <CreditCard className="mr-2 h-5 w-5" />
                          {card.name}
                        </CardTitle>
                        {card.officialName && (
                          <CardDescription>{card.officialName}</CardDescription>
                        )}
                      </div>
                      <Badge 
                        style={{ backgroundColor: getBandColor(card.band.band) }}
                        className="text-white"
                      >
                        {card.utilization}% - {card.band.band.toUpperCase()}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">Current Utilization</span>
                        <span className="text-sm">{card.utilization}%</span>
                      </div>
                      <Progress 
                        value={card.utilization} 
                        className="h-2"
                      />
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
                        <div>
                          <p className="text-xs text-muted-foreground">Balance</p>
                          <p className="font-medium">{formatCurrency(card.balance)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Limit</p>
                          <p className="font-medium">{formatCurrency(card.limit)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Statement Close</p>
                          <p className="font-medium">{formatDate(card.closeDate)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Days Until Close</p>
                          <p className={`font-medium ${card.daysUntilClose <= 3 ? 'text-red-600' : 'text-green-600'}`}>
                            {card.daysUntilClose} days
                          </p>
                        </div>
                      </div>

                      {card.paydownAmount > 0 && (
                        <Alert>
                          <Target className="h-4 w-4" />
                          <AlertTitle>Payment Recommendation</AlertTitle>
                          <AlertDescription>
                            Pay {formatCurrency(card.paydownAmount)} by {formatDate(card.closeDate)} to achieve 9% utilization
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="recommendations" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Optimization Recommendations</CardTitle>
                <CardDescription>
                  Pre-statement-close payments to optimize your credit utilization
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!recommendations || recommendations.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">All Set!</h3>
                    <p className="text-muted-foreground">
                      Your credit card utilization is already optimized. No payments needed before statement close.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {recommendations.map((rec, index) => (
                      <div key={index} className={`p-4 border rounded-lg ${
                        rec.priority === 'high' ? 'border-red-200 bg-red-50' : 
                        rec.priority === 'medium' ? 'border-orange-200 bg-orange-50' : 
                        'border-blue-200 bg-blue-50'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium">{rec.cardName}</h4>
                          <Badge variant={
                            rec.priority === 'high' ? 'destructive' : 
                            rec.priority === 'medium' ? 'default' : 
                            'secondary'
                          }>
                            {rec.priority.charAt(0).toUpperCase() + rec.priority.slice(1)} Priority
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Payment Amount</span>
                            <p className="font-medium text-lg">{formatCurrency(rec.amount)}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Current Util.</span>
                            <p className="font-medium">{rec.currentUtilization}%</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Target Util.</span>
                            <p className="font-medium text-green-600">{rec.targetUtilization}%</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Days Left</span>
                            <p className={`font-medium ${rec.daysUntilClose <= 3 ? 'text-red-600' : 'text-green-600'}`}>
                              {rec.daysUntilClose} days
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                          Make payment by {formatDate(rec.closeDate)} (statement close date)
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Utilization Distribution</CardTitle>
                  <CardDescription>How your cards are distributed across utilization bands</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-4 h-4 bg-green-500 rounded"></div>
                      <span className="text-sm">Excellent (0-9%): {summary?.excellentCards || 0} cards</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-4 h-4 bg-blue-500 rounded"></div>
                      <span className="text-sm">Good (10-29%): {summary?.goodCards || 0} cards</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-4 h-4 bg-yellow-500 rounded"></div>
                      <span className="text-sm">Warning (30-49%): {summary?.warningCards || 0} cards</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-4 h-4 bg-orange-500 rounded"></div>
                      <span className="text-sm">Bad (50-74%): {summary?.badCards || 0} cards</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-4 h-4 bg-red-500 rounded"></div>
                      <span className="text-sm">Severe (75-100%): {summary?.severeCards || 0} cards</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Quick Stats</CardTitle>
                  <CardDescription>Key metrics at a glance</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Total Cards</span>
                      <span className="font-medium">{creditCards?.length || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Average Utilization</span>
                      <span className="font-medium">
                        {creditCards?.length ? Math.round(creditCards.reduce((sum, card) => sum + card.utilization, 0) / creditCards.length) : 0}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Cards Needing Action</span>
                      <span className="font-medium text-orange-600">{recommendations?.length || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Total Available Credit</span>
                      <span className="font-medium">{formatCurrency(totalLimit - totalBalance)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}