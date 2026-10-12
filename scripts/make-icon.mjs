// Draws build/icon.png (256x256): a navy square with a white "L" mark. No dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const S = 256;
const px = Buffer.alloc(S * S * 4);
const fill = (x0, y0, x1, y1, [r, g, b]) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * S + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; }
};
fill(0, 0, S, S, [0x14, 0x1c, 0x27]);
fill(24, 24, 232, 232, [0x1d, 0x4e, 0x89]);
fill(84, 56, 124, 200, [255, 255, 255]);
fill(124, 160, 180, 200, [255, 255, 255]);

const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png);
console.log('build/icon.png written');
