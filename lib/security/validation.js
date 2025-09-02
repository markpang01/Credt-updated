import { z } from 'zod';

/**
 * Production-ready validation schemas for Credt API
 * Implements strict validation for all user inputs to prevent injection attacks
 */

// User profile validation
export const userProfileSchema = z.object({
  email: z.string().email('Invalid email format').max(254),
  full_name: z.string().min(1).max(100).optional(),
  default_target_utilization: z.number().min(0.01).max(0.30).default(0.09),
  monthly_paydown_limit: z.number().min(0).max(100000).default(1000),
});

// Plaid token exchange validation
export const tokenExchangeSchema = z.object({
  public_token: z.string().min(1).max(200),
  metadata: z.object({
    institution: z.object({
      institution_id: z.string().min(1).max(50),
      name: z.string().min(1).max(100),
    }).optional(),
    accounts: z.array(z.object({
      id: z.string().min(1).max(50),
      name: z.string().min(1).max(100),
      subtype: z.string().min(1).max(50),
    })).optional(),
  }).optional(),
});

// Account update validation
export const accountUpdateSchema = z.object({
  target_utilization: z.number().min(0.01).max(0.50).optional(),
  monthly_paydown_limit: z.number().min(0).max(100000).optional(),
});

// Plaid webhook validation
export const webhookSchema = z.object({
  webhook_type: z.string().min(1).max(50),
  webhook_code: z.string().min(1).max(50),
  item_id: z.string().min(1).max(50),
  environment: z.enum(['sandbox', 'development', 'production']),
});

/**
 * Sanitize string inputs to prevent XSS and injection attacks
 */
export function sanitizeString(input) {
  if (typeof input !== 'string') return input;
  
  return input
    .trim()
    .replace(/[<>\"'&]/g, (match) => {
      const replacements = {
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '&': '&amp;',
      };
      return replacements[match];
    });
}

/**
 * Validate environment configuration
 */
export function validateEnvironment() {
  const requiredEnvVars = [
    'PLAID_CLIENT_ID',
    'PLAID_SECRET',
    'PLAID_ENV',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  if (process.env.NODE_ENV === 'production') {
    requiredEnvVars.push(
      'PLAID_ENCRYPTION_KEY',
      'PLAID_WEBHOOK_SECRET'
    );
  }

  const missing = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate Plaid environment
  const validPlaidEnvs = ['sandbox', 'development', 'production'];
  if (!validPlaidEnvs.includes(process.env.PLAID_ENV)) {
    throw new Error(`PLAID_ENV must be one of: ${validPlaidEnvs.join(', ')}`);
  }

  return true;
}

/**
 * Rate limiting configuration
 */
export const rateLimits = {
  // Standard API endpoints
  standard: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // requests per window
  },
  // Authentication endpoints (more restrictive)
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // requests per window
  },
  // Plaid webhook endpoints
  webhook: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 50, // requests per window
  },
};

/**
 * Request validation middleware
 */
export function validateRequest(schema, data) {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      throw new Error(`Validation failed: ${JSON.stringify(errors)}`);
    }
    throw error;
  }
}

/**
 * SQL injection prevention for dynamic queries
 */
export function sanitizeSqlIdentifier(identifier) {
  // Only allow alphanumeric characters and underscores
  return identifier.replace(/[^a-zA-Z0-9_]/g, '');
}

/**
 * Validate UUID format
 */
export function isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate monetary amounts
 */
export function validateAmount(amount) {
  const num = parseFloat(amount);
  return !isNaN(num) && num >= 0 && num <= 1000000 && Number.isFinite(num);
}

/**
 * Clean and validate utilization percentage
 */
export function validateUtilization(utilization) {
  const num = parseFloat(utilization);
  return !isNaN(num) && num >= 0 && num <= 100 && Number.isFinite(num);
}