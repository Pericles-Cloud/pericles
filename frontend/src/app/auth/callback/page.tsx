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
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto"></div>
        <p className="mt-4 text-muted-foreground">
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
        <div className="flex min-h-dvh items-center justify-center bg-background">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading...</p>
          </div>
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
