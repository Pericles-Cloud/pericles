// frontend/src/providers/theme-color-sync.tsx
'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';

// Must match the static <meta name="theme-color"> pair in layout.tsx's
// `viewport` export (purple-100 / purple-600, the --sidebar values per mode).
// Duplicated as literals rather than imported from globals.css for the same
// reason atlas-brand.ts hardcodes hex: neither the metadata export nor a
// plain DOM attribute can read a CSS custom property.
const LIGHT = '#ECE9F1';
const DARK = '#524765';

/**
 * Keeps the browser-chrome color in sync with the actual in-app theme choice,
 * not just the OS preference (#32).
 *
 * layout.tsx's static `viewport.themeColor` ships two
 * `<meta name="theme-color" media="(prefers-color-scheme: …)">` tags — right
 * for the common case (in-app choice matches OS) and necessary for the color
 * to be correct on first paint, before this effect can run. But a user whose
 * OS is light and who picks Dark in-app (or vice versa) got the wrong one,
 * because the browser picks between the two purely by OS media query.
 *
 * Once mounted, this overwrites BOTH tags' `content` with the resolved
 * app theme's color. Setting both (rather than trying to pick "the" active
 * one) means the fix holds regardless of which media condition the browser
 * evaluates as matching.
 */
export function ThemeColorSync(): null {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!resolvedTheme) return; // undefined until next-themes resolves
    const color = resolvedTheme === 'dark' ? DARK : LIGHT;
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute('content', color));
  }, [resolvedTheme]);

  return null;
}
