'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';
import { useSidebarExpanded } from '@/stores/sidebar-store';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Fillet } from '@/components/ui/fillet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// App-shell vertical budget. The header OWNS this custom property: it publishes
// its measured height so the fixed nav rail, the drawer scrim, the full-bleed
// <main> and the Atlas feed max-height can never desync from the real box
// (GH #34). Written to documentElement because those consumers are siblings,
// not descendants — a property set on the <header> itself would not reach
// them. globals.css keeps the same value as a calc() fallback for first paint
// / SSR; once this effect runs, the measured pixel value wins.
const APP_HEADER_H_PROP = '--app-header-h';

export function Header() {
  const { user, currentOrganization, logout } = useAuth();
  const pathname = usePathname();
  const { isExpanded, toggle } = useSidebarExpanded(pathname);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    // Publishes the real rendered height (h-16 + pt-safe inset + border-b).
    // Change any of the header's own classes and the observer republishes —
    // globals.css needs no edit (its calc is only the pre-measurement
    // fallback). Custom-property writes do not change layout, so observing the
    // element cannot loop.
    const publish = () => {
      document.documentElement.style.setProperty(
        APP_HEADER_H_PROP,
        `${el.getBoundingClientRect().height}px`,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      // The measured value only means something while THIS header is mounted.
      document.documentElement.style.removeProperty(APP_HEADER_H_PROP);
    };
  }, []);

  const handleLogout = async () => {
    await logout();
  };

  return (
    // Brand chrome — flips with the mode: purple-100 in light, purple-600 in
    // dark. Everything on it must use --sidebar-* tokens, not fixed ramp steps.
    // pt-safe keeps the bar clear of the iOS notch under viewportFit: 'cover'.
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-sidebar-border bg-sidebar pt-safe pl-safe pr-safe">
      <div className="flex h-16 items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-4">
          {/* Nav toggle (GH #8). The nav lives below the header now, so the
              wordmark moved here — it used to sit in the sidebar underneath
              this bar, where the header painted over it. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={isExpanded ? 'Collapse navigation' : 'Expand navigation'}
            aria-expanded={isExpanded}
            aria-controls="primary-navigation"
            // The shell has its own surface in each mode, so the default ghost
            // hover (--accent, tuned for the page canvas) would be wrong here.
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <svg
              className="size-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
              />
            </svg>
          </Button>
          {/* Wordmark + fillet — the brand's primary signature, exactly as the
              colour system sets it: display serif over the gold rule. */}
          <div className="flex flex-col">
            <h1 className="font-display text-2xl font-semibold leading-none tracking-wide text-sidebar-foreground">
              Pericles
            </h1>
            <Fillet tone="shell" className="mt-1 w-14" />
          </div>
          {currentOrganization && (
            <span className="hidden text-sm text-sidebar-muted-foreground sm:block">
              {currentOrganization.name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-lg"
                className="rounded-full hover:bg-sidebar-accent"
              >
                {/* bg-primary inverts with the mode, so the disc contrasts with the
                    shell in both: purple-600 on the light shell (7.15:1),
                    purple-200 on the dark shell (5.75:1). A fixed ramp value
                    would vanish in one of them. */}
                <div className="flex size-10 items-center justify-center rounded-full bg-primary">
                  <span className="text-sm font-medium text-primary-foreground">
                    {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end">
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium">{user?.name || 'User'}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/profile">Profile</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
