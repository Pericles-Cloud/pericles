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
  expanded: Record<SidebarSurface, boolean>;
  toggle: (surface: SidebarSurface) => void;
  setExpanded: (surface: SidebarSurface, value: boolean) => void;
}

const DEFAULT_EXPANDED: Record<SidebarSurface, boolean> = {
  map: false,
  standard: true,
};

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      expanded: DEFAULT_EXPANDED,
      toggle: (surface) =>
        set((state) => ({
          expanded: { ...state.expanded, [surface]: !state.expanded[surface] },
        })),
      setExpanded: (surface, value) =>
        set((state) => ({ expanded: { ...state.expanded, [surface]: value } })),
    }),
    { name: 'pericles.sidebar' },
  ),
);

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
  return useSyncExternalStore(
    (onStoreChange) => useSidebarStore.persist.onFinishHydration(onStoreChange),
    () => useSidebarStore.persist.hasHydrated(),
    () => false,
  );
}

/** Resolved expand state for a pathname, defaults-safe before hydration. */
export function useSidebarExpanded(pathname: string): {
  surface: SidebarSurface;
  isExpanded: boolean;
  toggle: () => void;
  collapse: () => void;
} {
  const surface = surfaceForPath(pathname);
  const hydrated = useSidebarHydrated();
  const expanded = useSidebarStore((state) => state.expanded[surface]);
  const toggle = useSidebarStore((state) => state.toggle);
  const setExpanded = useSidebarStore((state) => state.setExpanded);

  // Stable identities — the sidebar keys its keydown listener on `collapse`.
  const toggleSurface = useCallback(() => toggle(surface), [toggle, surface]);
  const collapseSurface = useCallback(() => setExpanded(surface, false), [setExpanded, surface]);

  return {
    surface,
    isExpanded: hydrated ? expanded : DEFAULT_EXPANDED[surface],
    toggle: toggleSurface,
    collapse: collapseSurface,
  };
}
