import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

/**
 * Hash a password using bcrypt with 12 rounds.
 * Following NIST SP 800-63B guidelines:
 * - Minimum 8 characters
 * - Maximum 72 characters (bcrypt limit)
 * - No arbitrary composition rules
 */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  if (password.length > 72) {
    throw new Error('Password exceeds maximum length of 72 characters');
  }

  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a stored hash.
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
