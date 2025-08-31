-- Utilization Pilot Database Schema for Supabase
-- This creates all necessary tables for the credit utilization tracking app

-- Enable Row Level Security
ALTER DATABASE postgres SET "app.settings.jwt_secret" TO 'your-jwt-secret';

-- Create profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Utilization settings
  default_target_utilization DECIMAL DEFAULT 0.09, -- 9% default target
  monthly_paydown_limit DECIMAL DEFAULT 1000.00, -- $1000 default monthly limit
  
  PRIMARY KEY (id)
);

-- Create plaid_items table (stores Plaid connection info)
CREATE TABLE IF NOT EXISTS public.plaid_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL, -- Plaid item_id
  access_token TEXT NOT NULL, -- Encrypted in production
  institution_id TEXT,
  institution_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, item_id)
);

-- Create accounts table (credit cards and bank accounts)
CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  plaid_item_id UUID REFERENCES public.plaid_items(id) ON DELETE CASCADE,
  
  -- Plaid account data
  account_id TEXT NOT NULL UNIQUE, -- Plaid account_id
  name TEXT NOT NULL,
  official_name TEXT,
  type TEXT NOT NULL, -- 'depository', 'credit'
  subtype TEXT NOT NULL, -- 'checking', 'savings', 'credit card'
  
  -- Account balances (updated regularly)
  current_balance DECIMAL DEFAULT 0,
  available_balance DECIMAL,
  credit_limit DECIMAL, -- For credit cards
  
  -- Utilization tracking
  target_utilization DECIMAL DEFAULT 0.09, -- Per-card target
  last_statement_balance DECIMAL,
  last_statement_date DATE,
  estimated_close_date DATE, -- Inferred statement close date
  next_close_date DATE, -- Predicted next close date
  
  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, account_id)
);

-- Create transactions table (for statement cycle analysis)
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  
  -- Plaid transaction data
  transaction_id TEXT NOT NULL, -- Plaid transaction_id
  amount DECIMAL NOT NULL,
  date DATE NOT NULL,
  name TEXT,
  merchant_name TEXT,
  category TEXT[],
  
  -- Transaction metadata
  is_pending BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, transaction_id)
);

-- Create utilization_history table (track utilization over time)
CREATE TABLE IF NOT EXISTS public.utilization_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  
  -- Utilization snapshot
  recorded_date DATE NOT NULL,
  balance DECIMAL NOT NULL,
  credit_limit DECIMAL NOT NULL,
  utilization_percentage DECIMAL NOT NULL,
  
  -- Context
  is_statement_close BOOLEAN DEFAULT false,
  statement_date DATE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, account_id, recorded_date)
);

-- Create payment_recommendations table
CREATE TABLE IF NOT EXISTS public.payment_recommendations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  
  -- Recommendation details
  recommended_amount DECIMAL NOT NULL,
  target_utilization DECIMAL NOT NULL,
  current_utilization DECIMAL NOT NULL,
  due_date DATE NOT NULL, -- When to pay by
  priority TEXT CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
  
  -- Status tracking
  status TEXT CHECK (status IN ('pending', 'completed', 'ignored', 'expired')) DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create user_settings table (app preferences)
CREATE TABLE IF NOT EXISTS public.user_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  
  -- Notification settings
  email_notifications BOOLEAN DEFAULT true,
  push_notifications BOOLEAN DEFAULT true,
  notification_days_before INTEGER DEFAULT 3, -- Days before statement close
  
  -- App preferences
  theme TEXT DEFAULT 'light',
  timezone TEXT DEFAULT 'America/New_York',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id)
);

-- Row Level Security Policies

-- Enable RLS on all tables
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utilization_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- Policies for user_profiles
CREATE POLICY "Users can view own profile" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Policies for plaid_items
CREATE POLICY "Users can manage own plaid items" ON public.plaid_items
  FOR ALL USING (auth.uid() = user_id);

-- Policies for accounts
CREATE POLICY "Users can manage own accounts" ON public.accounts
  FOR ALL USING (auth.uid() = user_id);

-- Policies for transactions
CREATE POLICY "Users can manage own transactions" ON public.transactions
  FOR ALL USING (auth.uid() = user_id);

-- Policies for utilization_history
CREATE POLICY "Users can manage own utilization history" ON public.utilization_history
  FOR ALL USING (auth.uid() = user_id);

-- Policies for payment_recommendations
CREATE POLICY "Users can manage own payment recommendations" ON public.payment_recommendations
  FOR ALL USING (auth.uid() = user_id);

-- Policies for user_settings
CREATE POLICY "Users can manage own settings" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON public.accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_type_subtype ON public.accounts(type, subtype);
CREATE INDEX IF NOT EXISTS idx_transactions_user_account ON public.transactions(user_id, account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_utilization_history_user_account ON public.utilization_history(user_id, account_id);
CREATE INDEX IF NOT EXISTS idx_utilization_history_date ON public.utilization_history(recorded_date DESC);
CREATE INDEX IF NOT EXISTS idx_payment_recommendations_user_status ON public.payment_recommendations(user_id, status);

-- Create functions for automatic profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name');
  
  INSERT INTO public.user_settings (user_id)
  VALUES (new.id);
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new user registration
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_plaid_items_updated_at BEFORE UPDATE ON public.plaid_items FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_payment_recommendations_updated_at BEFORE UPDATE ON public.payment_recommendations FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();