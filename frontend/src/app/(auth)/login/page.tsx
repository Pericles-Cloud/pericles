'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { LoginForm } from '@/components/auth/login-form';

const errorMessages: Record<string, string> = {
  oauth_denied: 'Google sign-in was cancelled.',
  oauth_failed: 'Google sign-in failed. Please try again.',
  domain_not_allowed: 'Only Pericles users (@pericles.cloud or @pericles.ai) can sign in with Google.',
  missing_code: 'Invalid OAuth callback. Please try again.',
  session_expired: 'Your session has expired. Please sign in again.',
  token_error: 'Authentication error. Please try again.',
  id_error: 'Authentication error. Please try again.',
};

function LoginError() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  if (!error || !errorMessages[error]) return null;

  return (
    <div className="mb-4 p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950 rounded-md text-center">
      {errorMessages[error]}
    </div>
  );
}

export default function LoginPage() {
  return (
    <div>
      <Suspense fallback={null}>
        <LoginError />
      </Suspense>
      <LoginForm />
    </div>
  );
}
