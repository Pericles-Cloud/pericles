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
 * Update profile request schema (PATCH /api/auth/profile).
 * At least one updatable field must be provided.
 */
export const UpdateProfileSchema = z
  .object({
    name: z.string().min(1, 'Name cannot be empty').max(100).optional(),
    avatarUrl: z.string().url('Invalid avatar URL').max(2048).optional(),
  })
  .refine((data) => data.name !== undefined || data.avatarUrl !== undefined, {
    message: 'At least one field (name or avatarUrl) must be provided',
  });

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

/**
 * Update password request schema (POST /api/auth/password).
 * Authenticated change: requires the current password. Follows the same
 * NIST length policy as registration (min 8, max 72; no composition rules).
 */
export const UpdatePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password exceeds maximum length'),
});

export type UpdatePasswordInput = z.infer<typeof UpdatePasswordSchema>;

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
