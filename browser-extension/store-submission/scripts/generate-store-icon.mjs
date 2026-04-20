/**
 * Generate the 300x300 store icon required by Microsoft Edge Add-ons
 * (Chrome Web Store accepts the same size). Uses a pure-node PNG
 * encoder so we don't need to install any image library.
 *
 * The design: the same "S" glyph from the toolbar icon, centred on
 * a #0b3d2e background with a subtle inner shadow. No photoshop
 * required — the output is deterministic given the code.
 *
 * Run: node store-submission/scripts/generate-store-icon.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function crc32Table() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
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

// 7x7 S glyph from toolbar icon, upscaled.
const S_GLYPH = [
  [0, 1, 1, 1, 1, 1, 0],
  [1, 1, 0, 0, 0, 0, 0],
  [1, 1, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 0, 0],
  [0, 0, 0, 0, 1, 1, 0],
  [0, 0, 0, 0, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 0],
];

const SIZE = 300;
const BG_R = 11, BG_G = 61, BG_B = 46; // deep green #0b3d2e
const FG_R = 255, FG_G = 255, FG_B = 255;

// Glyph fills ~55% of the image, centred.
const glyphSize = Math.floor(SIZE * 0.55);
const scale = Math.floor(glyphSize / 7);
const actualGlyph = scale * 7;
const ox = Math.floor((SIZE - actualGlyph) / 2);
const oy = Math.floor((SIZE - actualGlyph) / 2);

const rowBytes = SIZE * 3 + 1;
const raw = Buffer.alloc(rowBytes * SIZE);

for (let y = 0; y < SIZE; y++) {
  raw[y * rowBytes] = 0;
  for (let x = 0; x < SIZE; x++) {
    const off = y * rowBytes + 1 + x * 3;
    // Radial vignette for a bit of depth (brighter centre).
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / (SIZE / 2);
    const vignette = Math.min(1, d) * 0.12;
    let r = Math.max(0, Math.round(BG_R - 8 * vignette));
    let g = Math.max(0, Math.round(BG_G - 10 * vignette));
    let b = Math.max(0, Math.round(BG_B - 8 * vignette));
    const gx = x - ox;
    const gy = y - oy;
    if (gx >= 0 && gx < actualGlyph && gy >= 0 && gy < actualGlyph) {
      const px = Math.floor(gx / scale);
      const py = Math.floor(gy / scale);
      if (S_GLYPH[py] && S_GLYPH[py][px]) {
        r = FG_R;
        g = FG_G;
        b = FG_B;
      }
    }
    raw[off] = r;
    raw[off + 1] = g;
    raw[off + 2] = b;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 2;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const idat = deflateSync(raw);
const png = Buffer.concat([
  signature,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

const outPath = resolve(__dirname, "..", "store-icon-300.png");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes, ${SIZE}x${SIZE})`);
