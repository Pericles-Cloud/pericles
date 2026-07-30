'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';
import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';
import { isFullBleedPath, useSidebarExpanded } from '@/stores/sidebar-store';
import { cn } from '@/lib/utils';

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated } = useAuth();
  const pathname = usePathname();
  const isFullBleed = isFullBleedPath(pathname);
  const { isExpanded } = useSidebarExpanded(pathname);

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="text-center">
          {/* No motion-reduce: utility — globals.css already caps every
              animation at one iteration under prefers-reduced-motion, and only
              this one spinner out of nine carried the class. */}
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // If not authenticated, the AuthProvider will redirect
  if (!isAuthenticated) {
    return null;
  }

  return (
    // dvh, not vh — 100vh sits under the iOS Safari toolbar and clips content.
    <div className={cn('bg-background', isFullBleed ? 'h-dvh overflow-hidden' : 'min-h-dvh')}>
      <Header />
      <Sidebar />
      <main
        className={cn(
          'transition-[padding] duration-200 ease-out',
          // Full-bleed routes (Atlas) run edge-to-edge under the header and the
          // nav floats above them, so they get no padding at all (GH #8).
          isFullBleed
            ? 'h-[calc(100dvh-var(--app-header-h))] lg:pl-16'
            // pb is `1.5rem + the home-indicator inset`, not `py-6`: a bare
            // 1.5rem is less than the 34px inset, so the last row of a
            // scrolling page sits under the indicator on a notched device.
            : cn('pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))]', isExpanded ? 'lg:pl-[calc(16rem+1.5rem)]' : 'lg:pl-[calc(4rem+1.5rem)]'),
        )}
      >
        {children}
      </main>
    </div>
  );
}
