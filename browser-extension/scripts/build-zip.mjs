/**
 * Packages the extension into a zip so the StockPilot web app can
 * serve it from /downloads/stockpilot-extension.zip. Pure Node,
 * no external deps — rolls its own minimal ZIP writer.
 *
 * Runs from inside browser-extension/ (any cwd is fine — paths are
 * resolved off __dirname).
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const extensionDir = resolve(__dirname, "..");
const outDir = resolve(extensionDir, "..", "public", "downloads");
const outPath = resolve(outDir, "stockpilot-extension.zip");

// Files to include. Explicit allowlist so we don't accidentally
// ship the zip inside the zip, the build script itself, or any
// stray editor cruft.
// Files to ship inside the zip. INSTALL.md is what the user opens
// after unzipping — it's the first thing they see and reads as a 90-
// second install guide. README.md stays in the repo for developers
// and is NOT shipped in the zip (it's too technical for an end user).
const INCLUDE = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "popup-helpers.js",
  "INSTALL.md",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

// --- minimal ZIP writer (store or deflate per file) ----------------

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
const CRC_TABLE = crc32Table();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(d = new Date()) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

function buildZip(files) {
  const { time, date } = dosTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(data);
    const useDeflate = deflated.length < data.length;
    const stored = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(stored.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len
    localParts.push(localHeader, nameBuf, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk #
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += localHeader.length + nameBuf.length + stored.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const centralOffset = offset;
  const centralSize = centralBuf.length;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disk
  end.writeUInt16LE(0, 6); // central dir start disk
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, end]);
}

// --- go ------------------------------------------------------------

const missing = INCLUDE.filter((n) => !existsSync(resolve(extensionDir, n)));
if (missing.length > 0) {
  console.error(`Missing files, can't build zip: ${missing.join(", ")}`);
  process.exit(1);
}

const files = INCLUDE.map((name) => ({
  name,
  data: readFileSync(resolve(extensionDir, name)),
}));

const zipBytes = buildZip(files);
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, zipBytes);
console.log(
  `wrote ${relative(extensionDir, outPath)} (${zipBytes.length} bytes, ${files.length} files)`
);
