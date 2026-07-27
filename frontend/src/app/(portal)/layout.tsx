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
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  // If not authenticated, the AuthProvider will redirect
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className={cn('bg-gray-50 dark:bg-gray-900', isFullBleed ? 'h-screen overflow-hidden' : 'min-h-screen')}>
      <Header />
      <Sidebar />
      <main
        className={cn(
          'transition-[padding] duration-200 ease-out',
          // Full-bleed routes (Atlas) run edge-to-edge under the header and the
          // nav floats above them, so they get no padding at all (GH #8).
          isFullBleed
            ? 'h-[calc(100vh-4rem)] lg:pl-16'
            : cn('p-6', isExpanded ? 'lg:pl-[calc(16rem+1.5rem)]' : 'lg:pl-[calc(4rem+1.5rem)]'),
        )}
      >
        {children}
      </main>
    </div>
  );
}
