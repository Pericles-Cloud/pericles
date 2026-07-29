// frontend/src/providers/theme-provider.tsx
// Requires: npm i next-themes
'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

type ThemeProviderProps = React.ComponentProps<typeof NextThemesProvider>;

/**
 * Wraps next-themes with the Pericles defaults.
 *
 * - attribute="class"        → toggles `dark` on <html>, which is what the
 *                              `@custom-variant dark (&:is(.dark *))` in
 *                              globals.css matches.
 * - defaultTheme="system"    → respect the OS/device preference; an explicit
 *                              user choice is persisted over it.
 * - disableTransitionOnChange → no colour-crossfade smear on toggle.
 *
 * The parent <html> MUST carry suppressHydrationWarning — next-themes writes
 * the class before React hydrates.
 */
export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children, ...props }) => (
  <NextThemesProvider
    attribute="class"
    defaultTheme="system"
    enableSystem
    disableTransitionOnChange
    {...props}
  >
    {children}
  </NextThemesProvider>
);
