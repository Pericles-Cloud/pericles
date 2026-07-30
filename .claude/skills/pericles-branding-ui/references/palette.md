# Pericles Palette — values & rationale

Source: GitHub issue **#17**, attachments `pericles-color-system.html` (Color System v1)
and `pericles-theme.css` (Tailwind v4 `@theme` block). Mirrored here so the skill is
self-contained; the issue attachments remain the design-side source of truth.

## Founding colors

| | Hex | Role |
|---|---|---|
| **Pericles Purple** | `#524765` (purple-600) | Primary. Leadership, gravity, trust. Core brand surface and dominant UI color. |
| **Athenian Gold** | `#D19B2F` (gold-500) | Accent. Distinction, signal, ceremony. Used sparingly — CTAs, highlights, key data points. |
| **White** | `#FFFFFF` | Base canvas. Pairs with grey-50 for a warmer off-white where pure white feels stark. |

## Purple scale — base 600

Tints and shades from the primary. 50–200 for tinted backgrounds and hover states,
700–900 for text and dark UI surfaces.

| Step | Hex | | Step | Hex |
|---|---|---|---|---|
| 50 | `#F7F6F9` | | 500 | `#6B5D84` |
| 100 | `#ECE9F1` | | **600** | **`#524765`** |
| 200 | `#D7D1E0` | | 700 | `#423851` |
| 300 | `#B4AAC5` | | 800 | `#2E273A` |
| 400 | `#8778A1` | | 900 | `#1D1825` |

## Gold scale — base 500

Reserve 400–600 for accents and emphasis rather than large fills — gold used broadly
loses its signal value.

| Step | Hex | | Step | Hex |
|---|---|---|---|---|
| 50 | `#FAF7EF` | | **500** | **`#D19B2F`** |
| 100 | `#F5ECDB` | | 600 | `#B48322` |
| 200 | `#ECD8B1` | | 700 | `#936B1A` |
| 300 | `#E2C283` | | 800 | `#6F5115` |
| 400 | `#D9AE59` | | 900 | `#4C3810` |

## Neutral grey

A **warm** neutral carrying a faint trace of the purple hue, so greys sit naturally
alongside the brand colors instead of reading as a generic UI kit. This is the workhorse
scale — body text, borders, backgrounds, disabled states.

| Step | Hex | | Step | Hex |
|---|---|---|---|---|
| 50 | `#FBFBFC` | | 500 | `#7D7887` |
| 100 | `#F6F5F7` | | 600 | `#5F5A68` |
| 200 | `#E8E6EA` | | 700 | `#433F4A` |
| 300 | `#D3D1D7` | | 800 | `#2A272F` |
| 400 | `#A4A0AB` | | 900 | `#19171C` |
| | | | 950 | `#0F0D11` |

## Semantic / risk signal colors

Light tint (backgrounds) · base (icons, badges, borders) · dark shade (text on light
tints). Deliberately built on different hues from brand gold.

| Risk state | Family | Light | Base | Dark |
|---|---|---|---|---|
| Critical | danger | `#F7DCD9` | `#BD3728` | `#74241B` |
| Elevated | warning | `#F8E7D8` | `#DF7920` | `#8C4E17` |
| Low | success | `#DAF1E6` | `#358D64` | `#205B3F` |
| Monitoring | info | `#E1EAF4` | `#4377B1` | `#2A4A6F` |

## Design notes (from the source doc)

**On the gold collision.** Brand gold sits at hue 40° (warm yellow-gold). The Warning
color is built at hue 28° — a more orange amber — specifically so a "medium risk" badge
is never visually confusable with a purely decorative gold accent elsewhere on the same
screen. In an alerting product, that distinction matters more than it would in a typical
SaaS brand.

**Platform UI vs. slides.** For product UI: neutral for ~90% of surfaces, purple 600–900
for primary actions and navigation, gold only for the single most important element per
screen, and the semantic scale exclusively for risk states — never for decoration. For
slides and marketing: purple and gold can carry more weight (title slides, dividers,
hero stats), with grey-50/900 as the two background choices and white reserved for
content-dense slides.

**Contrast.** White or grey-50 text on purple 500–900 and on gold 700–900. Purple-900 or
grey-900 text on gold 50–600 and on all light tints in the semantic scale — gold and the
light semantic tints are too light for white text to pass accessibility contrast.

## Typography (from the source doc's own styling)

- **Cormorant Garamond** 500/600, incl. italic — wordmark, display, section heads.
- **Inter** 400/500/600 — UI and body. (`frontend/` uses Geist, an equivalent
  neo-grotesque; see SKILL.md open questions.)
- **IBM Plex Mono** 400/500 — eyebrows (11px, `0.18em` tracking, uppercase), hex codes,
  metrics, timestamps.

## The fillet

A 2px `gold-500` rule above a 1px `gold-500 @ 50%` rule, 64px wide under the wordmark and
full-width under section heads. The brand's signature divider — see
`templates/fillet.tsx`.

## Measured contrast

Every ratio quoted in SKILL.md comes from `contrast-audit.mjs` in this directory. Run it
after any token change:

```bash
node .claude/skills/pericles-branding-ui/references/contrast-audit.mjs
```
