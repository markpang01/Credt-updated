'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { usePlaidLink } from 'react-plaid-link';
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
  Zap
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = {
  excellent: '#10b981', // green
  good: '#3b82f6',      // blue
  warning: '#f59e0b',   // yellow
  bad: '#f97316',       // orange
  severe: '#ef4444'     // red
};

export default function UtilizationPilot() {
  const [linkToken, setLinkToken] = useState(null);
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Force loading to false after a short delay to prevent hanging
  useEffect(() => {
    const timer = setTimeout(() => {
      console.log('Forcing loading to false after 3 seconds');
      setLoading(false);
      setDataLoaded(true);
    }, 3000);
    
    return () => clearTimeout(timer);
  }, []);

  // Fetch data in parallel
  useEffect(() => {
    const fetchData = async () => {
      try {
        console.log('Fetching dashboard data...');
        const dashboardResponse = await fetch('/api/dashboard');
        if (dashboardResponse.ok) {
          const data = await dashboardResponse.json();
          console.log('Dashboard data loaded:', data);
          setDashboardData(data);
        }
      } catch (error) {
        console.error('Dashboard fetch error:', error);
      }
    };
    
    const fetchLinkToken = async () => {
      try {
        console.log('Fetching link token...');
        const response = await fetch('/api/link-token');
        if (response.ok) {
          const data = await response.json();
          if (data.link_token) {
            console.log('Link token loaded');
            setLinkToken(data.link_token);
          }
        }
      } catch (error) {
        console.error('Link token fetch error:', error);
      }
    };
    
    fetchData();
    fetchLinkToken();
  }, []);

  const fetchLinkToken = async () => {
    try {
      console.log('Fetching link token...');
      const response = await fetch('/api/link-token');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Link token response:', data);
      
      if (data.link_token) {
        setLinkToken(data.link_token);
      } else {
        console.error('No link_token in response');
      }
    } catch (error) {
      console.error('Error fetching link token:', error);
    }
  };

  const fetchDashboard = async () => {
    try {
      const response = await fetch('/api/dashboard');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Dashboard data:', data); // Debug log
      setDashboardData(data);
      setError(null);
      setLoading(false); // Set loading to false only after successful data fetch
    } catch (error) {
      console.error('Error fetching dashboard:', error);
      setError('Failed to load dashboard data');
      setLoading(false); // Also set loading to false on error
    }
  };

  const refreshAccounts = async () => {
    try {
      setRefreshing(true);
      const response = await fetch('/api/refresh-accounts', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        await fetchDashboard();
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
      console.log('Plaid Link success, public_token:', public_token);
      try {
        setLoading(true);
        const response = await fetch('/api/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token }),
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Exchange token response:', data);
        
        if (data.success) {
          await fetchDashboard();
        } else {
          setError('Failed to exchange token');
        }
      } catch (error) {
        console.error('Error exchanging token:', error);
        setError('Failed to link accounts');
      } finally {
        setLoading(false);
      }
    },
    onExit: (err, metadata) => {
      console.log('Plaid Link exit:', err, metadata);
      if (err) {
        console.error('Plaid Link error:', err);
        setError('Account linking was cancelled or failed');
      }
    },
    env: process.env.NEXT_PUBLIC_PLAID_ENV,
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

  // Show onboarding if we don't have dashboard data or have no credit cards
  if (!dashboardData || !dashboardData.creditCards || dashboardData.creditCards.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center max-w-2xl mx-auto">
            <div className="mb-8">
              <CreditCard className="h-16 w-16 mx-auto mb-4 text-primary" />
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
                <CardTitle>Get Started</CardTitle>
                <CardDescription>
                  Connect your credit cards and checking account to start optimizing your credit utilization
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
                  onClick={openPlaidLink} 
                  disabled={!ready || loading}
                  className="w-full"
                  size="lg"
                >
                  <CreditCard className="mr-2 h-5 w-5" />
                  Connect Your Accounts
                </Button>
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

  const { 
    creditCards = [], 
    overallUtilization = 0, 
    totalLimit = 0, 
    totalBalance = 0, 
    recommendations = [], 
    summary = {} 
  } = dashboardData || {};

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center">
              <Zap className="mr-3 h-8 w-8 text-primary" />
              Utilization Pilot
            </h1>
            <p className="text-muted-foreground">Credit utilization optimization dashboard</p>
          </div>
          <Button onClick={refreshAccounts} disabled={refreshing} variant="outline">
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Data
          </Button>
        </div>

        {error && (
          <Alert className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Priority Recommendations */}
        {recommendations.length > 0 && (
          <Alert className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Urgent Recommendations</AlertTitle>
            <AlertDescription>
              <div className="mt-2 space-y-2">
                {recommendations.slice(0, 3).map((rec, index) => (
                  <div key={index} className="text-sm">
                    <strong>{rec.cardName}:</strong> Pay {formatCurrency(rec.amount)} by {formatDate(rec.closeDate)} 
                    ({rec.daysUntilClose} days) to reduce from {rec.currentUtilization}% to ~{rec.targetUtilization}%
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
              <div className="text-2xl font-bold text-green-600">{summary.excellentCards}</div>
              <p className="text-xs text-muted-foreground">0-9% utilization</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cards Need Attention</CardTitle>
              <AlertCircle className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                {summary.warningCards + summary.badCards + summary.severeCards}
              </div>
              <p className="text-xs text-muted-foreground">Above 30% utilization</p>
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
              {creditCards.map((card) => (
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
                        style={{ 
                          backgroundColor: '#f1f5f9',
                        }}
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
                {recommendations.length === 0 ? (
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
                      <span className="text-sm">Excellent (0-9%): {summary.excellentCards} cards</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-4 h-4 bg-blue-500 rounded"></div>
                      <span className="text-sm">Good (10-29%): {summary.goodCards} cards</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-4 h-4 bg-yellow-500 rounded"></div>
                      <span className="text-sm">Warning (30-49%): {summary.warningCards} cards</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-4 h-4 bg-orange-500 rounded"></div>
                      <span className="text-sm">Bad (50-74%): {summary.badCards} cards</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-4 h-4 bg-red-500 rounded"></div>
                      <span className="text-sm">Severe (75-100%): {summary.severeCards} cards</span>
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
                      <span className="font-medium">{creditCards.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Average Utilization</span>
                      <span className="font-medium">
                        {Math.round(creditCards.reduce((sum, card) => sum + card.utilization, 0) / creditCards.length)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Cards Needing Action</span>
                      <span className="font-medium text-orange-600">{recommendations.length}</span>
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