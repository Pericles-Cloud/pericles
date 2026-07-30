import { useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';

const subscribe = () => () => {};
const getSnapshot = () => document.documentElement.classList.contains('dark');
const getServerSnapshot = () => false;

/**
 * `true` when the app is in dark mode, correct on the FIRST client paint.
 *
 * next-themes' `resolvedTheme` is `undefined` until it resolves after mount, so
 * anything that picks a colour from it — a Google Maps style array, a reactflow
 * dot grid — paints in the wrong mode and then repaints. next-themes has
 * already written the `dark` class onto <html> before hydration, so reading
 * that class covers the gap.
 *
 * Uses `useSyncExternalStore` rather than a `useState` initializer: reading the
 * DOM in an initializer makes the React Compiler bail out of optimising the
 * whole component ("Existing memoization could not be preserved").
 *
 * Only for consumers that need a literal colour. Anything expressible in CSS
 * should use a role token and let the cascade handle it.
 */
export function useResolvedDark(): boolean {
  const { resolvedTheme } = useTheme();
  const domIsDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return resolvedTheme ? resolvedTheme === 'dark' : domIsDark;
}
