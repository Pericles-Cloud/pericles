'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { storeTokens } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useAuth();

  useEffect(() => {
    const handleCallback = async () => {
      const accessToken = searchParams.get('accessToken');
      const refreshToken = searchParams.get('refreshToken');
      const redirect = searchParams.get('redirect') || '/dashboard';

      if (accessToken) {
        try {
          storeTokens(accessToken, refreshToken || undefined);
          await refreshUser();
          router.replace(redirect);
        } catch (error) {
          console.error('Auth callback error:', error);
          router.replace('/login?error=oauth_failed');
        }
      } else {
        router.replace('/login?error=oauth_failed');
      }
    };

    void handleCallback();
  }, [searchParams, router, refreshUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white mx-auto"></div>
        <p className="mt-4 text-gray-600 dark:text-gray-400">
          Completing sign in...
        </p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white mx-auto"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
          </div>
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
