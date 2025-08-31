# Supabase Database Setup for Utilization Pilot

## Step 1: Create the Database Tables

1. **Go to your Supabase Dashboard**: https://app.supabase.com/project/ynqpdbitqpakndztonkp
2. **Navigate to SQL Editor** (in the left sidebar)
3. **Create a new query** and copy/paste the content from `/app/supabase/schema.sql`
4. **Run the query** to create all tables, policies, and triggers

## Step 2: Verify Tables Were Created

After running the schema, you should see these tables in your Database > Tables:

- ✅ `user_profiles` - User profile information and settings
- ✅ `plaid_items` - Plaid connection information
- ✅ `accounts` - Credit cards and bank accounts
- ✅ `transactions` - Transaction history for analysis
- ✅ `utilization_history` - Historical utilization tracking
- ✅ `payment_recommendations` - Payment suggestions
- ✅ `user_settings` - User preferences

## Step 3: Test the App

1. Open the app at http://localhost:3000
2. You should see the Supabase authentication screen
3. Enter your email and click "Send Magic Link"
4. Check your email for the magic link
5. Click the link to authenticate
6. You'll be redirected back to the app where you can connect your accounts

## Features Now Available:

🔐 **User Authentication** - Secure magic link sign-in
👤 **User-specific Data** - Each user's accounts are private
🔗 **Plaid Integration** - Connect credit cards per authenticated user
📊 **Real-time Dashboard** - Live utilization tracking
🛡️ **Row Level Security** - Data protection at database level

## Database Schema Overview:

The schema creates a complete multi-user system with:
- User profiles with utilization preferences
- Secure Plaid token storage
- Credit card and bank account tracking
- Transaction analysis for statement cycles
- Payment recommendations
- Historical utilization tracking

## Row Level Security:

All tables have RLS enabled so users can only see their own data:
- Users can only access their own accounts
- All queries are automatically filtered by authenticated user ID
- No risk of data leakage between users

Run the schema and the app will be ready for multi-user credit utilization tracking! 🚀