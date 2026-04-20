/**
 * Generates placeholder PNG icons for the extension. We embed a
 * stylised "S" on a solid green background at 16/48/128. No external
 * deps — pure node zlib + handrolled PNG chunks.
 *
 * Run with: node scripts/generate-icons.mjs
 * (from inside browser-extension/)
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function crc32Table() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}
const TABLE = crc32Table();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

// Crude bitmap "S" — 7x7 glyph we upscale per size.
// 1 = foreground (white), 0 = background.
const S_GLYPH = [
  [0, 1, 1, 1, 1, 1, 0],
  [1, 1, 0, 0, 0, 0, 0],
  [1, 1, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 0, 0],
  [0, 0, 0, 0, 1, 1, 0],
  [0, 0, 0, 0, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 0],
];

function makePng(size) {
  // Colors
  const bgR = 11,
    bgG = 61,
    bgB = 46; // #0b3d2e
  const fgR = 255,
    fgG = 255,
    fgB = 255;

  // Calculate glyph scale + offset so the S is centered.
  const glyphPixels = 7;
  const pad = Math.max(1, Math.floor(size * 0.18));
  const drawable = size - pad * 2;
  const scale = Math.max(1, Math.floor(drawable / glyphPixels));
  const glyphSize = scale * glyphPixels;
  const ox = Math.floor((size - glyphSize) / 2);
  const oy = Math.floor((size - glyphSize) / 2);

  const rowBytes = size * 3 + 1; // filter byte + RGB
  const raw = Buffer.alloc(rowBytes * size);

  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0; // filter = None
    for (let x = 0; x < size; x++) {
      const off = y * rowBytes + 1 + x * 3;
      let r = bgR,
        g = bgG,
        b = bgB;
      const gx = x - ox;
      const gy = y - oy;
      if (gx >= 0 && gx < glyphSize && gy >= 0 && gy < glyphSize) {
        const px = Math.floor(gx / scale);
        const py = Math.floor(gy / scale);
        if (S_GLYPH[py] && S_GLYPH[py][px]) {
          r = fgR;
          g = fgG;
          b = fgB;
        }
      }
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = deflateSync(raw);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = resolve(__dirname, "..", "icons");
mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  const bytes = makePng(size);
  writeFileSync(resolve(outDir, `icon${size}.png`), bytes);
  console.log(`wrote icon${size}.png (${bytes.length} bytes)`);
}
