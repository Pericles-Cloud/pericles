/**
 * Sidebar expand/collapse state.
 *
 * Atlas wants the map edge-to-edge with navigation collapsed to a rail (GH #8),
 * while every other module reads better with the nav expanded. Rather than
 * force one global preference, the choice is remembered per *surface*:
 *
 *   • 'map'      — full-bleed routes (Atlas). Collapsed by default; when the
 *                  user expands it, the nav overlays the map rather than
 *                  shrinking it.
 *   • 'standard' — everything else. Expanded by default; content reflows.
 *
 * A deliberate toggle wins and persists for that surface, so someone who likes
 * the nav open on Atlas keeps it open without also forcing it collapsed
 * everywhere else.
 *
 * Below `lg` none of that applies: there is no room for a rail beside the
 * content, so the nav is a drawer that starts closed and is NOT persisted.
 * Keeping the drawer out of the stored preference matters — otherwise
 * dismissing it once on a phone would also collapse the nav to a rail on the
 * same user's desktop, and every page would load behind a scrim.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SidebarSurface = 'map' | 'standard';

/** Routes that render edge-to-edge with the nav floating above them. */
const FULL_BLEED_ROUTES = ['/atlas'];

export function surfaceForPath(pathname: string): SidebarSurface {
  return FULL_BLEED_ROUTES.some((route) => pathname.startsWith(route)) ? 'map' : 'standard';
}

export function isFullBleedPath(pathname: string): boolean {
  return surfaceForPath(pathname) === 'map';
}

interface SidebarState {
  /** Persisted per-surface rail preference. Only consulted from `lg` up. */
  expanded: Record<SidebarSurface, boolean>;
  /** Transient below-`lg` drawer. Deliberately not persisted. */
  drawerOpen: boolean;
  toggle: (surface: SidebarSurface) => void;
  setExpanded: (surface: SidebarSurface, value: boolean) => void;
  setDrawerOpen: (value: boolean) => void;
}

const DEFAULT_EXPANDED: Record<SidebarSurface, boolean> = {
  map: false,
  standard: true,
};

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      expanded: DEFAULT_EXPANDED,
      drawerOpen: false,
      toggle: (surface) =>
        set((state) => ({
          expanded: { ...state.expanded, [surface]: !state.expanded[surface] },
        })),
      setExpanded: (surface, value) =>
        set((state) => ({ expanded: { ...state.expanded, [surface]: value } })),
      setDrawerOpen: (value) => set({ drawerOpen: value }),
    }),
    {
      name: 'pericles.sidebar',
      // The drawer is a transient mobile affordance, never a stored preference.
      partialize: (state) => ({ expanded: state.expanded }),
    },
  ),
);

/** Tailwind's `lg`. Kept in sync with the `lg:` classes in the nav + layout. */
const LG_QUERY = '(min-width: 1024px)';

function subscribeToBreakpoint(onChange: () => void): () => void {
  const mql = window.matchMedia(LG_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * True when the viewport is narrower than `lg`.
 *
 * The server snapshot is `false` so the prerendered markup matches the desktop
 * layout; the nav's own classes keep the drawer off-canvas below `lg` until
 * this resolves, so a phone never paints an open drawer.
 */
export function useIsBelowLg(): boolean {
  return useSyncExternalStore(
    subscribeToBreakpoint,
    () => !window.matchMedia(LG_QUERY).matches,
    () => false,
  );
}

/**
 * True once the persisted state has been read from localStorage.
 *
 * The layout is prerendered, so rendering the stored width on the first pass
 * would mismatch the server markup. Components render the defaults until this
 * flips, then transition to the user's preference.
 */
export function useSidebarHydrated(): boolean {
  // Subscribing to the persist API directly (rather than mirroring it into
  // component state) keeps the server snapshot pinned to `false` and avoids a
  // setState-in-effect cascade.
  return useSyncExternalStore(subscribeToHydration, hasHydrated, () => false);
}

function subscribeToHydration(onStoreChange: () => void): () => void {
  return useSidebarStore.persist.onFinishHydration(onStoreChange);
}

function hasHydrated(): boolean {
  return useSidebarStore.persist.hasHydrated();
}

/** Resolved expand state for a pathname, defaults-safe before hydration. */
export function useSidebarExpanded(pathname: string): {
  surface: SidebarSurface;
  isExpanded: boolean;
  /** The nav floats above content, so it owns focus and needs a scrim. */
  isModal: boolean;
  /** Below-`lg` drawer state, for the off-canvas transform. */
  drawerOpen: boolean;
  toggle: () => void;
  collapse: () => void;
} {
  const surface = surfaceForPath(pathname);
  const hydrated = useSidebarHydrated();
  const isBelowLg = useIsBelowLg();

  const railExpanded = useSidebarStore((state) => state.expanded[surface]);
  const drawerOpen = useSidebarStore((state) => state.drawerOpen);
  const toggleRail = useSidebarStore((state) => state.toggle);
  const setExpanded = useSidebarStore((state) => state.setExpanded);
  const setDrawerOpen = useSidebarStore((state) => state.setDrawerOpen);

  const railIsExpanded = hydrated ? railExpanded : DEFAULT_EXPANDED[surface];

  const toggleSurface = useCallback(() => {
    if (isBelowLg) setDrawerOpen(!drawerOpen);
    else toggleRail(surface);
  }, [isBelowLg, drawerOpen, setDrawerOpen, toggleRail, surface]);

  const collapseSurface = useCallback(() => {
    if (isBelowLg) setDrawerOpen(false);
    else setExpanded(surface, false);
  }, [isBelowLg, setDrawerOpen, setExpanded, surface]);

  return {
    surface,
    isExpanded: isBelowLg ? drawerOpen : railIsExpanded,
    // A rail docked beside the page is part of the document; only the drawer
    // and the Atlas overlay float above content.
    isModal: isBelowLg || surface === 'map',
    drawerOpen,
    toggle: toggleSurface,
    collapse: collapseSurface,
  };
}
