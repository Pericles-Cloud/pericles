// frontend/src/app/layout.tsx
// Root layout: fonts, per-mode browser chrome, safe-area opt-in, theme provider.
import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Geist, IBM_Plex_Mono } from 'next/font/google';

import './globals.css';
import { AuthProvider } from '@/providers/auth-provider';
import { ThemeProvider } from '@/providers/theme-provider';

// UI / body. Neo-grotesque; the brand doc specifies Inter — Geist is the
// already-wired equivalent (see SKILL.md open questions).
const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });

// Display. Page titles and section heads. Never below 20px, never in body
// copy. The variant list here must match what actually renders (GH #36):
// every font-display call site is font-semibold in normal style, so weight
// 500 and italic are NOT preloaded. The colour-system doc calls for italic
// section heads — add 'italic' (or '500') in the same commit as its first
// real use, never ahead of it.
const cormorant = Cormorant_Garamond({
  variable: '--font-cormorant',
  subsets: ['latin'],
  weight: ['600'],
  style: ['normal'],
});

// Data / eyebrows. Metrics, IDs, timestamps, uppercase labels.
const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'Pericles - Supply Chain Risk Management',
  description: 'AI-powered supply chain risk monitoring and incident management',
  // PWA is the preferred V1 mobile client (pericles-mobile), so the web app
  // has to present correctly when installed to a home screen. The manifest
  // itself comes from app/manifest.ts — Next injects the <link> automatically.
  appleWebApp: { capable: true, title: 'Pericles', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  // Required for env(safe-area-inset-*) to report real values on notched iOS.
  viewportFit: 'cover',
  // Drives the Android Chrome address bar and iOS Safari chrome. These match
  // --sidebar per mode, because the shell now flips with the theme.
  //
  // Correct for first paint (before React hydrates) for the common case
  // where the in-app choice matches the OS preference. For every render
  // after that, ThemeColorSync (mounted inside ThemeProvider) overwrites
  // both tags below with the actual resolved app theme's color, so an
  // in-app choice that diverges from the OS preference — e.g. OS light,
  // app Dark — stops showing the wrong browser chrome color (#32).
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ECE9F1' }, // purple-100
    { media: '(prefers-color-scheme: dark)', color: '#524765' }, // purple-600
  ],
  // Do NOT set maximumScale/userScalable — pinch-zoom is an accessibility
  // affordance and blocking it fails WCAG 1.4.4.
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: next-themes sets the `dark` class on <html>
    // before hydration; without this React logs a mismatch on every load.
    <html lang="en" suppressHydrationWarning>
      {/* `font-sans` is load-bearing, not decorative. Tailwind's preflight sets
          the base family on <html> from --default-font-family, which resolves
          to var(--font-geist-sans) — and next/font declares that variable on
          <body> (via the .variable class), not on :root. On <html> it is
          therefore undefined, the var() fallback wins, and the whole app
          renders in ui-sans-serif/system-ui with Geist downloaded but never
          used. Applying font-sans here puts the family on the element where
          the variable actually exists. */}
      <body
        className={`${geistSans.variable} ${cormorant.variable} ${plexMono.variable} font-sans antialiased`}
      >
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
