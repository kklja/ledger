'use strict';
// iPhone -> PC image bridge on your local network. No App Store app needed:
//  - Open the page in Safari (scan the QR code in Settings) and pick screenshots, or
//  - Use an iOS Shortcut ("Get Contents of URL", POST, Request Body: File) from the share sheet.
// Every request must carry the secret key from the QR code.

const http = require('http');
const os = require('os');
const crypto = require('crypto');

function lanAddress() {
  const nets = os.networkInterfaces();
  const found = [];
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|Tailscale|ZeroTier/i.test(name)) continue;
      const score = /^192\.168\./.test(a.address) ? 3 : /^10\./.test(a.address) ? 2 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 1 : 0;
      found.push({ address: a.address, score: score + (/wi-?fi|wlan|wireless/i.test(name) ? 1 : 0) });
    }
  }
  found.sort((a, b) => b.score - a.score);
  return found[0] ? found[0].address : '127.0.0.1';
}

const PAGE = (key) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes"><title>Ledger Upload</title>
<style>
*{box-sizing:border-box;border-radius:0}body{margin:0;font:16px -apple-system,Segoe UI,sans-serif;background:#f4f5f7;color:#16202c}
header{background:#16202c;color:#fff;padding:14px 16px;font-weight:600;letter-spacing:.02em}
main{padding:16px}label.btn{display:block;background:#1d4e89;color:#fff;text-align:center;padding:18px;font-weight:600;border:1px solid #163d6b}
input{display:none}p{color:#5b6573;font-size:14px}ul{list-style:none;padding:0;margin:16px 0}
li{background:#fff;border:1px solid #d5d9e0;padding:10px 12px;margin-bottom:6px;display:flex;justify-content:space-between;font-size:14px}
.ok{color:#1c7c3c}.err{color:#b42318}
</style></head><body><header>LEDGER &nbsp;·&nbsp; Send to PC</header><main>
<label class="btn">Choose screenshots / photos<input id="f" type="file" accept="image/*" multiple></label>
<p>Images appear in Ledger right away (inserted into the open note, or in the phone inbox). Tip: Share → Add to Home Screen.</p>
<ul id="list"></ul></main>
<script>
const key=${JSON.stringify(key)};
document.getElementById('f').addEventListener('change', async (e) => {
  for (const file of e.target.files) {
    const li = document.createElement('li'); li.textContent = file.name || 'image'; const s = document.createElement('span'); s.textContent = 'sending…'; li.appendChild(s);
    document.getElementById('list').prepend(li);
    try {
      const r = await fetch('/upload?k=' + encodeURIComponent(key), { method: 'POST', headers: { 'Content-Type': file.type || 'image/jpeg' }, body: file });
      s.textContent = r.ok ? 'sent' : 'failed (' + r.status + ')'; s.className = r.ok ? 'ok' : 'err';
    } catch (err) { s.textContent = 'failed'; s.className = 'err'; }
  }
  e.target.value = '';
});
</script></body></html>`;

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic' };

function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.slice(0, 3).toString() === 'GIF') return 'gif';
  if (buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (/ftyp(heic|heix|mif1|hevc)/.test(buf.slice(4, 12).toString())) return 'heic';
  return null;
}

// Minimal multipart/form-data reader (for Shortcuts set to "Form").
function fromMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) return null;
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  let start = buf.indexOf(boundary);
  while (start >= 0) {
    const headEnd = buf.indexOf('\r\n\r\n', start);
    if (headEnd < 0) break;
    const next = buf.indexOf(boundary, headEnd);
    if (next < 0) break;
    const head = buf.slice(start, headEnd).toString();
    if (/filename=|Content-Type:\s*image/i.test(head)) return buf.slice(headEnd + 4, next - 2);
    start = next;
  }
  return null;
}

function createPhoneServer({ port, key, onImage }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const ok = url.searchParams.get('k') === key && key;
    if (!ok) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('Forbidden: open the link from Ledger\'s QR code.'); }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGE(key));
    }
    if (req.method === 'POST' && url.pathname === '/upload') {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 40 * 1024 * 1024) { res.writeHead(413); res.end('Too large'); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (res.writableEnded) return;
        let buf = Buffer.concat(chunks);
        const ct = req.headers['content-type'] || '';
        if (/multipart\/form-data/i.test(ct)) buf = fromMultipart(buf, ct) || Buffer.alloc(0);
        const ext = sniff(buf) || EXT[ct.split(';')[0].trim().toLowerCase()];
        if (!buf.length || !ext) { res.writeHead(415, { 'Content-Type': 'text/plain' }); return res.end('Not an image'); }
        try {
          onImage(buf, ext);
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Sent to Ledger');
        } catch (e) {
          res.writeHead(500); res.end(e.message);
        }
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

const newKey = () => crypto.randomBytes(9).toString('base64url');

module.exports = { createPhoneServer, lanAddress, newKey };
