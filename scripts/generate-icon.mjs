import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const DIST_ELECTRON_DIR = path.join(ROOT_DIR, 'dist-electron');

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function blendPixel(buf, idx, r, g, b, alpha) {
  const a = clamp01(alpha);
  if (a <= 0) return;
  const inv = 1 - a;
  buf[idx] = Math.round(buf[idx] * inv + r * a);
  buf[idx + 1] = Math.round(buf[idx + 1] * inv + g * a);
  buf[idx + 2] = Math.round(buf[idx + 2] * inv + b * a);
  buf[idx + 3] = Math.round(Math.min(255, buf[idx + 3] + 255 * a * (1 - buf[idx + 3] / 255)));
}

function sdRoundedBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay || 1));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

/**
 * Renders an anti-aliased RGBA buffer for the Folio Notes app icon at `size x size`.
 */
function renderIconRgba(size) {
  const rgba = Buffer.alloc(size * size * 4, 0);

  const cx = size * 0.5;
  const cy = size * 0.5;
  const outerHalf = size * 0.43;
  const outerRadius = size * 0.105;

  // Notebook card interior bounds (inset on right slightly to show crisp paper edge)
  const coverHalfW = size * 0.36;
  const coverHalfH = size * 0.39;
  const coverRadius = size * 0.065;
  const coverCenterX = cx - size * 0.015;
  const spineRight = coverCenterX - coverHalfW + size * 0.105;

  const aa = 1.25;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const idx = (y * size + x) * 4;

      // Subtle soft drop shadow below outer tile
      const shadowDist = sdRoundedBox(px, py - size * 0.02, cx, cy, outerHalf, outerHalf, outerRadius);
      if (shadowDist < size * 0.04) {
        const sAlpha = clamp01(1 - shadowDist / (size * 0.04)) * 0.22;
        blendPixel(rgba, idx, 15, 23, 42, sAlpha);
      }

      // Outer rounded squircle backdrop (deep slate-navy gradient)
      const bgDist = sdRoundedBox(px, py, cx, cy, outerHalf, outerHalf, outerRadius);
      if (bgDist < aa) {
        const bgAlpha = clamp01(0.5 - bgDist / aa);
        const t = clamp01(py / size);
        const r = Math.round(lerp(30, 15, t));
        const g = Math.round(lerp(58, 35, t));
        const b = Math.round(lerp(95, 66, t));
        blendPixel(rgba, idx, r, g, b, bgAlpha);
      }

      // Visible ivory page stack sticking out on right edge of folio notebook
      const paperDist = sdRoundedBox(
        px,
        py,
        coverCenterX + size * 0.045,
        cy,
        coverHalfW,
        coverHalfH - size * 0.018,
        coverRadius,
      );
      if (paperDist < aa && bgDist < aa) {
        const pAlpha = clamp01(0.5 - paperDist / aa) * clamp01(0.5 - bgDist / aa);
        blendPixel(rgba, idx, 248, 250, 252, pAlpha);
      }

      // Front notebook cover (royal azure / slate navy)
      const coverDist = sdRoundedBox(px, py, coverCenterX, cy, coverHalfW, coverHalfH, coverRadius);
      if (coverDist < aa) {
        const cAlpha = clamp01(0.5 - coverDist / aa);
        const t = clamp01((py - (cy - coverHalfH)) / (coverHalfH * 2));
        let cr = lerp(37, 29, t);
        let cg = lerp(99, 78, t);
        let cb = lerp(235, 178, t);

        // Darker spine band on the left edge of the cover
        if (px < spineRight) {
          const sMix = clamp01((spineRight - px) / (size * 0.015));
          cr = lerp(cr, 15, sMix * 0.72);
          cg = lerp(cg, 30, sMix * 0.72);
          cb = lerp(cb, 62, sMix * 0.72);
        }

        blendPixel(rgba, idx, cr, cg, cb, cAlpha);

        // Crisp vertical spine crease highlight
        const creaseDist = Math.abs(px - spineRight);
        if (creaseDist < aa * 1.4 && cAlpha > 0.2) {
          blendPixel(rgba, idx, 191, 219, 254, cAlpha * 0.35 * (1 - creaseDist / (aa * 1.4)));
        }
      }

      // Inner white title card on the notebook cover
      const cardX = coverCenterX + size * 0.055;
      const cardY = cy - size * 0.06;
      const cardDist = sdRoundedBox(px, py, cardX, cardY, size * 0.16, size * 0.115, size * 0.026);
      if (cardDist < aa) {
        const cardAlpha = clamp01(0.5 - cardDist / aa);
        blendPixel(rgba, idx, 255, 255, 255, cardAlpha * 0.96);

        // Ruled sky-blue accent lines inside title card
        const line1 = sdSegment(px, py, cardX - size * 0.1, cardY - size * 0.038, cardX + size * 0.1, cardY - size * 0.038);
        const line2 = sdSegment(px, py, cardX - size * 0.1, cardY + size * 0.008, cardX + size * 0.075, cardY + size * 0.008);
        const line3 = sdSegment(px, py, cardX - size * 0.1, cardY + size * 0.054, cardX + size * 0.04, cardY + size * 0.054);
        const strokeHalf = Math.max(1.2, size * 0.012);
        if (line1 < strokeHalf) {
          blendPixel(rgba, idx, 37, 99, 235, clamp01((strokeHalf - line1) / aa) * 0.9);
        }
        if (line2 < strokeHalf) {
          blendPixel(rgba, idx, 148, 163, 184, clamp01((strokeHalf - line2) / aa) * 0.85);
        }
        if (line3 < strokeHalf) {
          blendPixel(rgba, idx, 148, 163, 184, clamp01((strokeHalf - line3) / aa) * 0.85);
        }
      }

      // Golden-amber bookmark ribbon & diagonal stylus accent
      const ribbonLeft = coverCenterX + size * 0.19;
      const ribbonRight = coverCenterX + size * 0.255;
      const ribbonTop = cy + coverHalfH - size * 0.01;
      const ribbonBottom = cy + coverHalfH + size * 0.055;
      if (px >= ribbonLeft && px <= ribbonRight && py >= ribbonTop - size * 0.11 && py <= ribbonBottom) {
        const notchY = ribbonBottom - Math.abs(px - (ribbonLeft + ribbonRight) * 0.5) * 0.6;
        if (py <= notchY) {
          blendPixel(rgba, idx, 245, 158, 11, 1);
        }
      }

      // Diagonal white stylus stroke near bottom-right of cover
      const penDist = sdSegment(
        px,
        py,
        cardX - size * 0.04,
        cy + size * 0.19,
        cardX + size * 0.11,
        cy + size * 0.05,
      );
      const penThickness = Math.max(1.8, size * 0.028);
      if (penDist < penThickness) {
        const pAlpha = clamp01((penThickness - penDist) / aa);
        blendPixel(rgba, idx, 255, 255, 255, pAlpha * 0.95);
      }
    }
  }

  return rgba;
}

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcPayload = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcPayload), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(rgba, width, height) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    scanlines[rowStart] = 0;
    rgba.copy(scanlines, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: ICO
  header.writeUInt16LE(frames.length, 4);

  const dirEntries = [];
  let offset = 6 + frames.length * 16;
  for (const frame of frames) {
    const entry = Buffer.alloc(16);
    entry[0] = frame.size >= 256 ? 0 : frame.size;
    entry[1] = frame.size >= 256 ? 0 : frame.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(frame.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += frame.png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...frames.map((f) => f.png)]);
}

fs.mkdirSync(BUILD_DIR, { recursive: true });

const sizes = [32, 48, 256];
const frames = sizes.map((size) => ({
  size,
  png: encodePng(renderIconRgba(size), size, size),
}));

const png256 = frames.find((f) => f.size === 256).png;
fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), png256);
fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), encodeIco(frames));

if (process.argv.includes('--prepare-electron')) {
  fs.mkdirSync(DIST_ELECTRON_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DIST_ELECTRON_DIR, 'package.json'),
    JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
  );
}

console.log('Generated build/icon.png (256x256) and build/icon.ico (32, 48, 256)');
