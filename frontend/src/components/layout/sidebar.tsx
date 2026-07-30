'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useSidebarExpanded, useSidebarStore } from '@/stores/sidebar-store';
import { Fillet } from '@/components/ui/fillet';

interface NavItem {
  name: string;
  href: string;
  icon: React.ReactNode;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const navigation: NavSection[] = [
  {
    items: [
      {
        name: 'Dashboard',
        href: '/dashboard',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
        ),
      },
      {
        name: 'Atlas',
        href: '/atlas',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
          </svg>
        ),
      },
      {
        // Events + Insights merged into one module (GH #12).
        name: 'Intelligence',
        href: '/intelligence',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
          </svg>
        ),
      },
      {
        name: 'Plans',
        href: '/plans',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
          </svg>
        ),
      },
      {
        name: 'Assessments',
        href: '/assessments',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'Manage',
    items: [
      {
        name: 'Organizations',
        href: '/manage/organizations',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
          </svg>
        ),
      },
      {
        name: 'Suppliers',
        href: '/manage/suppliers',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
          </svg>
        ),
      },
      {
        name: 'Carriers',
        href: '/manage/carriers',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
        ),
      },
      {
        name: 'Shipments',
        href: '/manage/shipments',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        ),
      },
      {
        name: 'Agents',
        href: '/manage/agents',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
          </svg>
        ),
      },
      {
        // "Org Settings" so it reads distinctly from the personal Settings in
        // the header account menu (/settings). GH #12.
        name: 'Org Settings',
        href: '/manage/settings',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        ),
      },
    ],
  },
];

/** Width classes, kept here so the layout can mirror them for content padding. */
export const SIDEBAR_WIDTH = { expanded: 'w-64', collapsed: 'w-16' } as const;

export function Sidebar() {
  const pathname = usePathname();
  const { isExpanded, isModal, drawerOpen, collapse } = useSidebarExpanded(pathname);
  const setDrawerOpen = useSidebarStore((state) => state.setDrawerOpen);
  const asideRef = useRef<HTMLElement>(null);

  // Only trap/scrim when the nav actually floats above content: the Atlas
  // overlay (GH #8) or the below-lg drawer. As a docked rail it is part of the
  // page, and trapping Tab there would strand keyboard users inside the nav.
  const isModalOpen = isExpanded && isModal;

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === href;
    return pathname.startsWith(href);
  };

  // `collapse` changes identity with the drawer state; holding it in a ref keeps
  // the effect below keyed purely on open/closed, so it cannot re-run mid-open
  // and yank focus back to the first nav item.
  const collapseRef = useRef(collapse);
  useEffect(() => {
    collapseRef.current = collapse;
  }, [collapse]);

  // Navigating from inside the drawer should not leave it covering the page it
  // just opened. Only the transient drawer is closed — never the stored rail.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname, setDrawerOpen]);

  // Modal behaviour while open: focus moves in, Escape closes, Tab cycles, and
  // focus returns to whatever opened it.
  useEffect(() => {
    if (!isModalOpen) return;
    const aside = asideRef.current;
    if (!aside) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        aside.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      ).filter((el) => el.offsetParent !== null);

    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        collapseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [isModalOpen]);

  return (
    <>
      {/* Scrim: only when the nav is floating above content. */}
      {isModalOpen && (
        <div
          onClick={collapse}
          aria-hidden="true"
          className="fixed inset-x-0 bottom-0 top-[var(--app-header-h)] z-20 bg-black/30 backdrop-blur-[1px]"
        />
      )}

      <aside
        ref={asideRef}
        id="primary-navigation"
        aria-label="Main navigation"
        role={isModalOpen ? 'dialog' : undefined}
        aria-modal={isModalOpen ? true : undefined}
        className={cn(
          // Brand chrome — flips with the mode: purple-100 light, purple-600 dark.
          // NO pl-safe here: the aside has a fixed width (w-16 / w-64) and
          // border-box sizing, so a left inset would be subtracted from the
          // usable width — a 44px landscape notch leaves the 64px rail with
          // 20px of content box. The inset goes on the inner nav's padding
          // instead, where it is additive.
          'fixed bottom-0 left-0 top-[var(--app-header-h)] z-30 flex flex-col border-r border-sidebar-border bg-sidebar',
          'transition-[width,transform] duration-200 ease-out',
          isExpanded ? SIDEBAR_WIDTH.expanded : SIDEBAR_WIDTH.collapsed,
          // Below lg the transform is the drawer, which starts closed — so the
          // prerendered markup is off-canvas on phones. From lg up it is always
          // on-canvas and the width above decides rail vs expanded.
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0',
        )}
      >
        {/* Bottom padding is `1rem + the home-indicator inset`, written as a
            calc rather than `py-4 pb-safe`: .pb-safe sets padding-bottom, which
            REPLACES py-4's block-end value, so on any device without an inset
            (all desktop) the last nav item would sit flush against the edge.
            overscroll-contain stops scroll chaining into the page behind. */}
        <nav className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain pl-[calc(0.5rem+env(safe-area-inset-left))] pr-2 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <ul className="flex flex-1 flex-col gap-y-6">
            {navigation.map((section, sectionIndex) => (
              <li key={sectionIndex}>
                {section.title && (
                  <div
                    className={cn(
                      // Mono eyebrow — the brand's section-label treatment.
                      'mb-2 px-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-sidebar-muted-foreground',
                      // The label is meaningless next to icon-only items.
                      !isExpanded && 'sr-only',
                    )}
                  >
                    {section.title}
                  </div>
                )}
                {/* Divider stands in for the hidden section label on the rail. */}
                {section.title && !isExpanded && (
                  <div className="mx-2 mb-2 border-t border-sidebar-border" />
                )}
                <ul className="space-y-1">
                  {section.items.map((item) => (
                    <li key={item.name}>
                      <Link
                        href={item.href}
                        title={!isExpanded ? item.name : undefined}
                        aria-current={isActive(item.href) ? 'page' : undefined}
                        className={cn(
                          isActive(item.href)
                            ? 'bg-sidebar-primary text-sidebar-foreground'
                            // hover uses --sidebar-accent, NOT --sidebar-primary:
                            // sharing the active fill made a hovered inactive
                            // item indistinguishable from the active one.
                            : 'text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                          'group relative flex items-center gap-x-3 rounded-md p-2 text-sm font-medium',
                          'pointer-coarse:min-h-11 active:opacity-80',
                          !isExpanded && 'justify-center',
                        )}
                      >
                        {/* The gold rule carries the active state: a purple-600
                            fill is one ramp step from the shell in either mode and would
                            be invisible on its own. */}
                        {isActive(item.href) && (
                          <Fillet
                            orientation="vertical"
                            tone="shell"
                            className="absolute inset-y-1 left-0"
                          />
                        )}
                        <span className="shrink-0">{item.icon}</span>
                        <span className={cn('truncate', !isExpanded && 'sr-only')}>
                          {item.name}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}
