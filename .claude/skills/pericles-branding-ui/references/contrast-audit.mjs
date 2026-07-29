#!/usr/bin/env node
/**
 * Pericles theme contrast audit.
 *
 * Asserts every published light/dark token pair against WCAG 2.1 AA:
 *   4.5:1 for body text, 3.0:1 for large text and non-text UI boundaries.
 *
 * Run after ANY change to the ramps or role tokens in
 * `templates/globals.css` (or `frontend/src/app/globals.css` once landed):
 *
 *   node .claude/skills/pericles-branding-ui/references/contrast-audit.mjs
 *
 * Exits non-zero on failure. Add a row whenever you add a token pair — a pair
 * that isn't in this file has not been verified.
 *
 * The KNOWN_TRAPS block at the bottom pins the combinations that FAIL, so a
 * future edit can't quietly reintroduce them.
 */

const RAMPS = {
  'purple-50': '#F7F6F9', 'purple-100': '#ECE9F1', 'purple-200': '#D7D1E0',
  'purple-300': '#B4AAC5', 'purple-400': '#8778A1', 'purple-500': '#6B5D84',
  'purple-600': '#524765', 'purple-700': '#423851', 'purple-800': '#2E273A',
  'purple-900': '#1D1825',

  'gold-50': '#FAF7EF', 'gold-100': '#F5ECDB', 'gold-200': '#ECD8B1',
  'gold-300': '#E2C283', 'gold-400': '#D9AE59', 'gold-500': '#D19B2F',
  'gold-600': '#B48322', 'gold-700': '#936B1A', 'gold-800': '#6F5115',
  'gold-900': '#4C3810',

  'grey-50': '#FBFBFC', 'grey-100': '#F6F5F7', 'grey-200': '#E8E6EA',
  'grey-300': '#D3D1D7', 'grey-400': '#A4A0AB', 'grey-500': '#7D7887',
  'grey-600': '#5F5A68', 'grey-700': '#433F4A', 'grey-800': '#2A272F',
  'grey-900': '#19171C', 'grey-950': '#0F0D11',

  'danger-light': '#F7DCD9', danger: '#BD3728', 'danger-dark': '#74241B',
  'warning-light': '#F8E7D8', warning: '#DF7920', 'warning-dark': '#8C4E17',
  'success-light': '#DAF1E6', success: '#358D64', 'success-dark': '#205B3F',
  'info-light': '#E1EAF4', info: '#4377B1', 'info-dark': '#2A4A6F',

  white: '#FFFFFF',
};

const AA_TEXT = 4.5;
const AA_LARGE = 3.0; // large text (>=18.66px bold / 24px) and non-text UI

const toRgb = (token) => {
  const hex = (RAMPS[token] ?? token).replace('#', '');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
};
const toHex = (rgb) =>
  '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

/** Composite `fg` over `bg` at alpha `a` — mirrors color-mix(in oklab, X n%, Y). */
const over = (fg, bg, a) => {
  const [f, b] = [toRgb(fg), toRgb(bg)];
  return toHex([0, 1, 2].map((i) => a * f[i] + (1 - a) * b[i]));
};

const linear = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (token) => {
  const [r, g, b] = toRgb(token).map((v) => v / 255);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};
const contrast = (a, b) => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// The 18% risk-surface composites used by the .dark block, over the dark card
// (purple-800 — dark mode is purple, not neutral).
const dark = (family) => over(family, 'purple-800', 0.18);

// The lifted `-accent` steps used by the .dark block:
// color-mix(in oklab, X 70%, X-light).
const lift = (family) => over(`${family}-light`, family, 0.30);

// The `-text` steps (standalone severity text on a card) lift further, 55/45,
// because the `-fg` tints are ~90% lightness and collapse into one off-white.
const textOf = (family) => over(`${family}-light`, family, 0.45);

/** [description, foreground, background, minimum ratio] */
const PAIRS = [
  // ── Light mode ────────────────────────────────────────────────────────────
  ['L  body text', 'grey-900', 'white', AA_TEXT],
  ['L  muted text', 'grey-600', 'white', AA_TEXT],
  ['L  muted text on grey-50', 'grey-600', 'grey-50', AA_TEXT],
  ['L  primary button label', 'grey-50', 'purple-600', AA_TEXT],
  ['L  primary vs canvas', 'purple-600', 'white', AA_LARGE],
  ['L  link / interactive text', 'purple-600', 'white', AA_TEXT],
  ['L  gold CTA label', 'purple-900', 'gold-500', AA_TEXT],
  ['L  gold CTA border (--brand-accent-border)', 'gold-600', 'white', AA_LARGE],
  ['L  gold text (--brand-accent-text)', 'gold-700', 'white', AA_TEXT],
  ['D  primary text on card', 'purple-200', 'purple-800', AA_TEXT],
  ['D  primary button label', 'purple-900', 'purple-200', AA_TEXT],
  ['L  hover (--accent) label', 'purple-900', 'purple-200', AA_TEXT],
  ['D  hover (--accent) label', 'purple-50', 'purple-500', AA_TEXT],
  ['L  switch off-track vs card', over('grey-600', 'white', 0.70), 'white', AA_LARGE],
  ['D  switch off-track vs card', over('purple-300', 'purple-800', 0.70), 'purple-800', AA_LARGE],
  // The switch KNOB is a filled disc on the track, so it needs 3:1 in BOTH
  // states and BOTH modes. It must come from role tokens: a fixed white knob
  // is 1.49:1 on the dark on-track (--primary is purple-200 there).
  ['L  switch knob, on', 'grey-50', 'purple-600', AA_LARGE],
  ['D  switch knob, on', 'purple-900', 'purple-200', AA_LARGE],
  ['L  switch knob, off', 'grey-600', 'purple-50', AA_LARGE],
  ['D  switch knob, off', 'purple-300', 'purple-700', AA_LARGE],
  ['L  destructive button label', 'white', 'danger', AA_TEXT],

  // ── Light mode: risk badges ───────────────────────────────────────────────
  ['L  critical badge text', 'danger-dark', 'danger-light', AA_TEXT],
  ['L  elevated badge text', 'warning-dark', 'warning-light', AA_TEXT],
  ['L  low badge text', 'success-dark', 'success-light', AA_TEXT],
  ['L  monitoring badge text', 'info-dark', 'info-light', AA_TEXT],
  ['L  critical icon on white', 'danger', 'white', AA_LARGE],
  ['L  elevated icon on white', 'warning', 'white', AA_LARGE],
  ['L  low icon on white', 'success', 'white', AA_LARGE],
  ['L  monitoring icon on white', 'info', 'white', AA_LARGE],

  // ── Brand shell, LIGHT (purple-100) ──────────────────────────────────────
  ['SL sidebar label', 'purple-900', 'purple-100', AA_TEXT],
  ['SL sidebar muted label', 'purple-600', 'purple-100', AA_TEXT],
  ['SL gold fillet / accent', 'gold-800', 'purple-100', AA_TEXT],
  ['SL wordmark', 'purple-900', 'purple-100', AA_TEXT],
  ['SL avatar disc vs shell', 'purple-600', 'purple-100', AA_LARGE],
  ['SL avatar initials', 'grey-50', 'purple-600', AA_TEXT],

  // ── Brand shell, DARK (purple-600) ───────────────────────────────────────
  ['SD sidebar label', 'grey-50', 'purple-600', AA_TEXT],
  ['SD sidebar muted label', 'purple-200', 'purple-600', AA_TEXT],
  ['SD gold fillet / accent', 'gold-300', 'purple-600', AA_TEXT],
  ['SD active-item label on fill', 'grey-50', 'purple-800', AA_TEXT],
  ['SD avatar disc vs shell', 'purple-300', 'purple-600', AA_LARGE],
  ['SD avatar initials', 'purple-900', 'purple-300', AA_TEXT],

  // ── Dark mode — PURPLE canvas (purple-900) / card (purple-800) ───────────
  ['D  body text on canvas', 'purple-50', 'purple-900', AA_TEXT],
  ['D  body text on card', 'purple-50', 'purple-800', AA_TEXT],
  ['D  muted text on canvas', 'purple-300', 'purple-900', AA_TEXT],
  ['D  muted text on card', 'purple-300', 'purple-800', AA_TEXT],
  ['D  primary text on card', 'purple-300', 'purple-800', AA_TEXT],
  ['D  primary button label', 'purple-900', 'purple-300', AA_TEXT],
  ['D  gold accent on card', 'gold-400', 'purple-800', AA_TEXT],
  ['D  gold CTA label', 'gold-900', 'gold-400', AA_TEXT],
  ['D  content fillet on canvas', 'gold-400', 'purple-900', AA_LARGE],
  ['D  critical TEXT on card', textOf('danger'), 'purple-800', AA_TEXT],
  ['D  elevated TEXT on card', textOf('warning'), 'purple-800', AA_TEXT],
  ['D  low TEXT on card', textOf('success'), 'purple-800', AA_TEXT],
  ['D  monitoring TEXT on card', textOf('info'), 'purple-800', AA_TEXT],

  // ── Dark mode: risk badges over the 18% composite ─────────────────────────
  ['D  critical badge text', 'danger-light', dark('danger'), AA_TEXT],
  ['D  elevated badge text', 'warning-light', dark('warning'), AA_TEXT],
  ['D  low badge text', 'success-light', dark('success'), AA_TEXT],
  ['D  monitoring badge text', 'info-light', dark('info'), AA_TEXT],
  // Dark `-accent` steps are lifted 30% toward their light tint; the raw base
  // is too dark against the purple-800 card (see KNOWN_TRAPS).
  ['D  critical icon on card', lift('danger'), 'purple-800', AA_LARGE],
  ['D  elevated icon on card', lift('warning'), 'purple-800', AA_LARGE],
  ['D  low icon on card', lift('success'), 'purple-800', AA_LARGE],
  ['D  monitoring icon on card', lift('info'), 'purple-800', AA_LARGE],
];

/**
 * Combinations that FAIL and must stay out of the theme. Each is a mistake
 * that is easy to make and hard to spot; the audit fails if one starts passing
 * (which would mean a ramp value drifted).
 */
const KNOWN_TRAPS = [
  ['gold-500 as a boundary on white — use gold-600', 'gold-500', 'white', AA_LARGE],
  ['gold-500 as a boundary on grey-100 — use gold-600', 'gold-500', 'grey-100', AA_LARGE],
  ['warning base as body text on white — use warning-dark', 'warning', 'white', AA_TEXT],
  ['low/success base as body text on white — use success-dark', 'success', 'white', AA_TEXT],
  ['grey-500 as dark muted text on the purple card', 'grey-500', 'purple-800', AA_TEXT],
  ['purple-400 as dark primary text — floor is purple-300', 'purple-400', 'purple-800', AA_TEXT],
  ['danger base as dark body text — use danger-light', 'danger', 'purple-800', AA_TEXT],
  ['UNLIFTED danger accent on the purple-800 card — must be lifted 30%', 'danger', 'purple-800', AA_LARGE],
  ['white label on the LIFTED danger accent — use --destructive instead', 'white', lift('danger'), AA_TEXT],
  ['switch off-track as bare --muted (light) — invisible', 'purple-50', 'white', AA_LARGE],
  ['fixed white switch knob on the dark on-track — use --primary-foreground',
    'white', 'purple-200', AA_LARGE],
  ['a risk -text token ON its own tinted dark surface — use -fg',
    textOf('danger'), dark('danger'), AA_TEXT],
  ['dark --primary == --muted-foreground (purple-300) — links look like muted text',
    'purple-300', 'purple-300', AA_LARGE],
  ['dark map land == water — no coastlines', 'purple-900', 'grey-900', AA_LARGE],
  ['dark -fg tints as standalone text — all four collapse to one off-white',
    'danger-light', 'warning-light', 1.35],
  ['light-mode supplier pin on any dark map — purple-600 cannot reach 3:1',
    'purple-600', 'grey-950', AA_LARGE],
  ['purple-600 fill on the purple-900 shell — use the gold fillet', 'purple-600', 'purple-900', AA_LARGE],
  ['gold-400 as text on the purple-600 dark shell — use gold-300', 'gold-400', 'purple-600', AA_TEXT],
  ['gold-700 as text on the purple-100 light shell — use gold-800', 'gold-700', 'purple-100', AA_TEXT],
  ['purple-200 active fill vs the purple-100 light shell — the gold rule carries it', 'purple-200', 'purple-100', AA_LARGE],
  ['purple-800 active fill vs the purple-600 shell — the gold rule carries the state',
    'purple-800', 'purple-600', AA_LARGE],
];

let failures = 0;

console.log('Pericles contrast audit — WCAG 2.1 AA\n');
console.log('REQUIRED PAIRS');
for (const [label, fg, bg, min] of PAIRS) {
  const ratio = contrast(fg, bg);
  const ok = ratio >= min;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${ratio.toFixed(2).padStart(6)}:1  (min ${min.toFixed(1)})  ${label}`,
  );
}

console.log('\nKNOWN TRAPS (must remain below the threshold)');
for (const [label, fg, bg, min] of KNOWN_TRAPS) {
  const ratio = contrast(fg, bg);
  const stillFails = ratio < min;
  if (!stillFails) failures += 1;
  console.log(
    `  ${stillFails ? 'OK  ' : 'DRIFT'}  ${ratio.toFixed(2).padStart(6)}:1  (< ${min.toFixed(1)})  ${label}`,
  );
}

console.log(
  failures === 0
    ? `\n✓ ${PAIRS.length} pairs pass, ${KNOWN_TRAPS.length} traps still fail as expected.`
    : `\n✗ ${failures} problem(s). Fix the token or the ramp — do not lower the threshold.`,
);

// ── Atlas map palette: categorical colours must not collide with semantic or
// brand ones. Not a contrast check — an identity check — but it belongs here
// because it is the same class of bug and equally invisible in a diff.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const atlasBrand = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../frontend/src/lib/atlas-brand.ts',
);

console.log('\nATLAS PALETTE (categorical vs semantic/brand, per mode)');
try {
  const src = readFileSync(atlasBrand, 'utf8');
  const grab = (re) => (src.match(re)?.[1] ?? '').match(/#[0-9A-Fa-f]{6}/g)?.map((c) => c.toUpperCase()) ?? [];
  const reserved = new Set([
    ...grab(/export const SEVERITY = \{([\s\S]*?)\} as const/),
    ...grab(/export const PERICLES = \{([\s\S]*?)\} as const/),
  ]);
  // The land each palette is drawn on. A single palette CANNOT serve both:
  // 3:1 on grey-100 needs luminance <= 0.175, 3:1 on purple-700 needs >= 0.238.
  const MODES = [
    { name: 'light', re: /SUBSIDIARY_PALETTE_LIGHT = \[([\s\S]*?)\] as const/, land: 'grey-100' },
    { name: 'dark', re: /SUBSIDIARY_PALETTE_DARK = \[([\s\S]*?)\] as const/, land: 'purple-700' },
  ];
  for (const { name, re, land } of MODES) {
    const subs = grab(re);
    if (!subs.length) {
      failures += 1;
      console.log(`  FAIL  no ${name} subsidiary palette found — did it get renamed?`);
      continue;
    }
    const clash = subs.filter((c) => reserved.has(c));
    const dupes = subs.filter((c, i) => subs.indexOf(c) !== i);
    if (clash.length) { failures += 1; console.log(`  FAIL  ${name} subsidiary colours collide with severity/brand: ${clash.join(', ')}`); }
    if (dupes.length) { failures += 1; console.log(`  FAIL  duplicate ${name} subsidiary colours: ${dupes.join(', ')}`); }
    // Every dot/route must clear the 3:1 non-text floor on ITS OWN land. The
    // light set measured 2.03–2.42:1 on the dark land, i.e. invisible.
    const dim = subs.filter((c) => contrast(c, land) < AA_LARGE);
    if (dim.length) {
      failures += 1;
      console.log(`  FAIL  ${name} subsidiary colours under 3:1 on ${land}: ` +
        dim.map((c) => `${c} ${contrast(c, land).toFixed(2)}:1`).join(', '));
    } else if (!clash.length && !dupes.length) {
      const lo = Math.min(...subs.map((c) => contrast(c, land)));
      console.log(`  OK    ${name}: ${subs.length} colours, none reserved, min ${lo.toFixed(2)}:1 on ${land}`);
    }
  }
} catch (err) {
  console.log(`  SKIP  could not read atlas-brand.ts (${err.code ?? err.message})`);
}

// ── Font tokens must live in `@theme inline`. next/font declares its
// --font-* vars on <body>, so a plain @theme resolves them at :root where they
// don't exist — the token becomes guaranteed-invalid and every heading
// silently falls back to system sans. This emits valid CSS and passes a build,
// so only an explicit check catches it.
const globalsCss = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../frontend/src/app/globals.css',
);

console.log('\nFONT TOKENS (must be inside @theme inline)');
try {
  const css = readFileSync(globalsCss, 'utf8');
  const inlineBlock = css.match(/@theme inline \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const plainBlock = css.match(/@theme \{([\s\S]*?)\n\}/)?.[1] ?? '';
  for (const token of ['--font-sans', '--font-display', '--font-mono']) {
    const inInline = inlineBlock.includes(token);
    const inPlain = new RegExp(`^\\s*${token}\\s*:`, 'm').test(plainBlock);
    if (inInline && !inPlain) console.log(`  OK    ${token} is in @theme inline`);
    else { failures += 1; console.log(`  FAIL  ${token} ${inPlain ? 'is in plain @theme — it will resolve to nothing' : 'is missing'}`); }
  }
} catch (err) {
  console.log(`  SKIP  could not read globals.css (${err.code ?? err.message})`);
}

console.log(
  failures === 0 ? '\n\u2713 all checks pass.' : `\n\u2717 ${failures} problem(s).`,
);
process.exit(failures === 0 ? 0 : 1);
