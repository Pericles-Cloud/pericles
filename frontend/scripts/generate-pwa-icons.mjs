#!/usr/bin/env node
/**
 * Generates placeholder PWA install icons: a purple-600 square with a
 * geometric gold "P" monogram, at the two sizes iOS and Android require for
 * an install prompt (#30). No brand logomark exists in the repo yet — the
 * sidebar wordmark is styled text (`Pericles` + a gold Fillet), not a
 * graphic mark — so this is intentionally a stopgap, not final brand art.
 *
 * Pure Node, no dependencies: hand-writes PNG chunks (zlib from the
 * standard library is the only thing this needs) so it can run without
 * installing an image library for a one-time asset generation task. Renders
 * at 4x supersample and box-filters down for anti-aliased edges.
 *
 * Re-run after real icon art exists to replace these, or delete this script
 * and the two PNGs under public/ once that happens:
 *
 *   node scripts/generate-pwa-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PURPLE_600 = [0x52, 0x47, 0x65]; // brand ramp, matches globals.css
const GOLD_500 = [0xd1, 0x9b, 0x2f];

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const SUPERSAMPLE = 4;

// ── Minimal PNG encoder (RGB, no alpha — icons are opaque) ─────────────────

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** pixels: Uint8Array of length w*h*3 (RGB, row-major). */
function encodePng(w, h, pixels) {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * 3);
    raw[rowStart] = 0; // filter: None
    pixels.copy(raw, rowStart + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Shape rendering, at supersample resolution ──────────────────────────────

/** Point-in-shape test for a simple geometric "P": a vertical stem + a bowl
 * (rounded rect) attached top-right, built from a handful of rects/circles
 * rather than real type, since no font-rendering is available here. */
function isInsideP(x, y, size) {
  // Normalize to a 0-100 glyph box, roughly centered with margin.
  const nx = ((x - size * 0.30) / (size * 0.40)) * 100;
  const ny = ((y - size * 0.20) / (size * 0.60)) * 100;
  if (nx < 0 || nx > 100 || ny < 0 || ny > 100) return false;

  // Stem: a vertical bar, full height, left third.
  const inStem = nx >= 0 && nx <= 28;

  // Bowl: a rounded rectangle occupying the top ~58%, right of the stem,
  // with a circular hole to make it read as a "P" and not a solid block.
  const bowlTop = 0, bowlBottom = 58, bowlLeft = 0, bowlRight = 92;
  const bowlRadius = 22;
  const inBowlBox = nx >= bowlLeft && nx <= bowlRight && ny >= bowlTop && ny <= bowlBottom;
  const cx = (bowlLeft + bowlRight) / 2;
  const cy = (bowlTop + bowlBottom) / 2;
  const holeRx = (bowlRight - bowlLeft) / 2 - bowlRadius * 0.55;
  const holeRy = (bowlBottom - bowlTop) / 2 - bowlRadius * 0.55;
  const inHole =
    ((nx - cx) / holeRx) ** 2 + ((ny - cy) / holeRy) ** 2 <= 1 && holeRx > 0 && holeRy > 0;
  const inBowl = inBowlBox && !inHole;

  return inStem || inBowl;
}

function renderIcon(size) {
  const ss = size * SUPERSAMPLE;
  const big = Buffer.alloc(ss * ss * 3);
  for (let y = 0; y < ss; y++) {
    for (let x = 0; x < ss; x++) {
      const [r, g, b] = isInsideP(x, y, ss) ? GOLD_500 : PURPLE_600;
      const i = (y * ss + x) * 3;
      big[i] = r;
      big[i + 1] = g;
      big[i + 2] = b;
    }
  }
  // Box-filter downsample ss -> size for anti-aliased edges.
  const out = Buffer.alloc(size * size * 3);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SUPERSAMPLE; dy++) {
        for (let dx = 0; dx < SUPERSAMPLE; dx++) {
          const i = ((y * SUPERSAMPLE + dy) * ss + (x * SUPERSAMPLE + dx)) * 3;
          r += big[i];
          g += big[i + 1];
          b += big[i + 2];
        }
      }
      const o = (y * size + x) * 3;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

for (const size of [192, 512]) {
  const pixels = renderIcon(size);
  const png = encodePng(size, size, pixels);
  const path = resolve(PUBLIC_DIR, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`wrote ${path} (${png.length} bytes)`);
}
