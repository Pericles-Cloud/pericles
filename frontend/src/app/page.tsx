'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';

export default function HomePage() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useAuth();
  const hasNavigated = useRef(false);

  useEffect(() => {
    if (!isLoading && !hasNavigated.current) {
      hasNavigated.current = true;
      // Use replace to avoid back-button issues with auth redirects
      if (isAuthenticated) {
        router.replace('/dashboard');
      } else {
        router.replace('/login');
      }
    }
  }, [isLoading, isAuthenticated, router]);

  // Show loading state while checking auth
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-foreground mb-4">
          Pericles
        </h1>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto"></div>
        <p className="mt-4 text-muted-foreground">
          Loading...
        </p>
      </div>
    </div>
  );
}
