import { z } from 'zod';

/**
 * Registration request schema.
 * Following NIST SP 800-63B guidelines:
 * - Minimum 8 characters
 * - No arbitrary composition rules (uppercase, special chars, etc.)
 * - Allow up to 72 characters (bcrypt limit)
 */
export const RegisterSchema = z.object({
  email: z.string().email('Invalid email address').max(254),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password exceeds maximum length'),
  name: z.string().min(1, 'Name is required').max(100).optional(),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

/**
 * Login request schema.
 */
export const LoginSchema = z.object({
  email: z.string().email('Invalid email address').max(254),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * Token refresh request schema.
 */
export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;

/**
 * Google OAuth callback schema.
 */
export const GoogleCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().optional(),
});

export type GoogleCallbackInput = z.infer<typeof GoogleCallbackSchema>;

/**
 * Password reset request schema.
 */
export const PasswordResetRequestSchema = z.object({
  email: z.string().email('Invalid email address').max(254),
});

export type PasswordResetRequestInput = z.infer<typeof PasswordResetRequestSchema>;

/**
 * Password reset complete schema.
 */
export const PasswordResetCompleteSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password exceeds maximum length'),
});

export type PasswordResetCompleteInput = z.infer<typeof PasswordResetCompleteSchema>;

/**
 * User role enum.
 */
export const UserRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']);

export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * Standard API error response.
 */
export interface AuthErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

/**
 * Standard API success response with user data.
 */
export interface AuthSuccessResponse {
  success: true;
  data: {
    user: {
      id: string;
      email: string;
      name: string | null;
      avatarUrl: string | null;
    };
    organization: {
      id: string;
      name: string;
      role: UserRole;
    } | null;
    accessToken: string;
    refreshToken?: string;
  };
}

/**
 * Current user response (for /me endpoint).
 */
export interface CurrentUserResponse {
  success: true;
  data: {
    user: {
      id: string;
      email: string;
      name: string | null;
      avatarUrl: string | null;
      emailVerified: boolean;
    };
    organizations: Array<{
      id: string;
      name: string;
      role: UserRole;
    }>;
  };
}
