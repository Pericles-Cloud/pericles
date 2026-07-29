import type { MetadataRoute } from 'next';

/**
 * PWA manifest. `pericles-mobile` makes the PWA over `frontend/` the preferred
 * V1 mobile client, so this is the install surface on iOS and Android.
 *
 * Next serves this at /manifest.webmanifest and injects the <link> itself — do
 * not also set `manifest` in the root layout's metadata.
 *
 * NOTE: `icons` is deliberately absent — no brand icon assets exist in
 * public/ yet. Without them the app renders correctly but is not installable
 * (both iOS and Android require at least a 192px and a 512px icon for the
 * install prompt). Add them and the icons array to finish PWA support.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pericles — Supply Chain Risk Management',
    short_name: 'Pericles',
    description:
      'AI-powered supply chain risk monitoring and incident management',
    start_url: '/',
    display: 'standalone',
    // No `orientation` lock: WCAG 1.3.4 prohibits restricting to a single
    // orientation unless essential, and Atlas is a full-screen map that is
    // materially better in landscape.
    // A manifest can only encode ONE value, but the shell now flips with the
    // mode (--sidebar is purple-100 light / purple-600 dark) and layout.tsx
    // declares both. purple-600 is the deliberate choice for the install
    // splash and standalone chrome; an installed light-mode user therefore
    // gets purple-600 chrome above a purple-100 header. Fixing that properly
    // needs a runtime theme-color update, not a manifest change.
    background_color: '#524765',
    theme_color: '#524765',
  };
}
