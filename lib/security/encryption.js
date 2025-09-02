import crypto from 'crypto';

// Encryption configuration for Plaid access tokens
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits

/**
 * Get or generate encryption key from environment
 * In production, this should be stored in a secure secret manager
 */
function getEncryptionKey() {
  const key = process.env.PLAID_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('PLAID_ENCRYPTION_KEY environment variable is required for production');
  }
  
  // Ensure key is exactly 32 bytes
  if (Buffer.from(key, 'hex').length !== KEY_LENGTH) {
    throw new Error('PLAID_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  
  return Buffer.from(key, 'hex');
}

/**
 * Encrypt sensitive data (access tokens, etc.)
 * Returns encrypted object with iv, tag, and encrypted data
 */
export function encryptSensitiveData(data) {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(data, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    const tag = cipher.getAuthTag();
    
    return {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      encrypted: encrypted.toString('hex')
    };
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt sensitive data');
  }
}

/**
 * Decrypt sensitive data
 * Takes encrypted object and returns decrypted string
 */
export function decryptSensitiveData(encryptedObj) {
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(encryptedObj.iv, 'hex');
    const tag = Buffer.from(encryptedObj.tag, 'hex');
    const encrypted = Buffer.from(encryptedObj.encrypted, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt sensitive data');
  }
}

/**
 * Generate a new encryption key for initial setup
 * Run this once and store the result in your environment variables
 */
export function generateEncryptionKey() {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Validate webhook signature from Plaid
 * Implements HMAC SHA-256 verification as required by Plaid
 */
export function verifyWebhookSignature(payload, signature, secret) {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
    
    // Use timing-safe comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (error) {
    console.error('Webhook signature verification error:', error);
    return false;
  }
}

/**
 * Hash sensitive data for storage (one-way)
 * Used for data that doesn't need to be decrypted
 */
export function hashSensitiveData(data, salt = null) {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(data, actualSalt, 100000, 64, 'sha512').toString('hex');
  
  return {
    hash,
    salt: actualSalt
  };
}

/**
 * Verify hashed data
 */
export function verifyHashedData(data, hash, salt) {
  const { hash: newHash } = hashSensitiveData(data, salt);
  return crypto.timingSafeEqual(
    Buffer.from(hash, 'hex'),
    Buffer.from(newHash, 'hex')
  );
}