/**
 * تجارة — خادم الغرف (صفر تبعيات)
 *
 *   node server/server.mjs            → http://0.0.0.0:5173
 *
 * يقدّم واجهة الويب + WebSocket على /ws لنفس المنفذ:
 *   • غرف برمز، مضيف authoritative، بثّ حالة مخفية لكل لاعب (maskFor)
 *   • دردشة / إيموجيات / عبارات سريعة
 *   • تمرير إشارات WebRTC للمحادثة الصوتية (المايك)
 *   • /Tijara.apk و /Tijara.html للتنزيل من الشبكة المحلية
 *
 * ملاحظة: الصوت الفعلي يسري عبر WebRTC بين الأجهزة (peer-to-peer)؛
 * الخادم يمرّر فقط رسائل العرض/الإجابة/ICE ولا يستقبل أي صوت.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.apk': 'application/vnd.android.package-archive',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

/* ============================ خادم الملفات ============================== */
function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, decodeURIComponent(rel)));
  return p.startsWith(base) ? p : null;
}
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { pathname = '/'; }
  if (pathname === '/health' || pathname === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      app: 'تجارة — Tijara rooms', ok: true, rooms: rooms.size,
      peers: [...rooms.values()].reduce((n, r) => n + r.peers.size, 0),
      ws: '/ws', apk: fs.existsSync(path.join(ROOT, 'Tijara.apk'))
    }));
    return;
  }
  let file = null;
  if (pathname === '/Tijara.apk' || pathname === '/تجارة.apk') file = path.join(ROOT, 'Tijara.apk');
  else if (pathname === '/Tijara.html' || pathname === '/تجارة.html') file = path.join(ROOT, 'Tijara.html');
  else {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    file = safeJoin(WEB, rel);
  }
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(WEB, 'index.html');
  const ext = path.extname(file).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  };
  if (ext === '.apk') headers['Content-Disposition'] = 'attachment; filename="Tijara.apk"';
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
});

/* ========================= إطارات WebSocket ============================ */
const rooms = new Map();
let peerSeq = 0;

function frame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.allocUnsafe(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.allocUnsafe(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.allocUnsafe(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, payload]);
}
function send(peer, obj) {
  if (!peer || !peer.ws || peer.ws.destroyed) return false;
  try { peer.ws.write(frame(0x1, Buffer.from(JSON.stringify(obj)))); return true; }
  catch { return false; }
}
function sendRoom(room, obj, except) {
  for (const p of room.peers.values()) if (p !== except) send(p, obj);
}
function peerList(room) {
  return [...room.peers.values()].map(p => ({ peerId: p.id, name: p.name, isHost: p === room.host }));
}
function codeGen() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do {
    c = Array.from({ length: 5 }, () => abc[crypto.randomInt(abc.length)]).join('');
  } while (rooms.has(c));
  return c;
}

function parseFrames(peer, chunk) {
  peer.buf = Buffer.concat([peer.buf, chunk]);
  for (;;) {
    if (peer.buf.length < 2) return;
    const b0 = peer.buf[0], b1 = peer.buf[1];
    const fin = !!(b0 & 0x80), opcode = b0 & 0x0f;
    const masked = !!(b1 & 0x80);
    let len = b1 & 0x7f, off = 2;
    if (len === 126) { if (peer.buf.length < 4) return; len = peer.buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (peer.buf.length < 10) return; len = Number(peer.buf.readBigUInt64BE(2)); off = 10; }
    if (len > 8 * 1024 * 1024) { peer.ws.destroy(); return; }
    let mask = null;
    if (masked) { if (peer.buf.length < off + 4) return; mask = peer.buf.subarray(off, off + 4); off += 4; }
    if (peer.buf.length < off + len) return;
    let payload = Buffer.from(peer.buf.subarray(off, off + len));
    if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i % 4];
    peer.buf = peer.buf.subarray(off + len);
    handleFrame(peer, fin, opcode, payload);
  }
}
function handleFrame(peer, fin, opcode, payload) {
  if (opcode === 0x8) { peer.ws.end(); return; }
  if (opcode === 0x9) { try { peer.ws.write(frame(0xA, payload)); } catch {} return; }
  if (opcode === 0xA) return;
  if (opcode === 0x0 || opcode === 0x1) {
    peer.frag = Buffer.concat([peer.frag || Buffer.alloc(0), payload]);
    if (opcode === 0x1) peer.fragOpcode = 1;
    if (!fin) return;
    const text = peer.frag.toString('utf8');
    peer.frag = Buffer.alloc(0);
    if (peer.fragOpcode === 1) {
      let msg; try { msg = JSON.parse(text); } catch { return; }
      handleMessage(peer, msg);
    }
    peer.fragOpcode = 0;
  }
}

/* ============================== البروتوكول ============================= */
function handleMessage(peer, m) {
  if (!m || typeof m.t !== 'string') return;
  switch (m.t) {
    case 'hello':
      if (m.name) peer.name = String(m.name).slice(0, 24);
      send(peer, { t: 'welcome', peerId: peer.id, name: peer.name });
      break;
    case 'room:create': {
      if (peer.room) leaveRoom(peer);
      const code = codeGen();
      const room = { code, host: peer, peers: new Map(), createdAt: Date.now(), settings: m.settings || {} };
      room.peers.set(peer.id, peer);
      peer.room = room; peer.isHost = true;
      rooms.set(code, room);
      send(peer, { t: 'room:created', code, peerId: peer.id });
      sendRoom(room, { t: 'peer:list', peers: peerList(room) });
      break;
    }
    case 'room:join': {
      const code = String(m.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) { send(peer, { t: 'error', message: 'الغرفة غير موجودة' }); return; }
      if (room.peers.size >= 10) { send(peer, { t: 'error', message: 'الغرفة ممتلئة (10 لاعبين)' }); return; }
      if (peer.room) leaveRoom(peer);
      if (m.name) peer.name = String(m.name).slice(0, 24);
      peer.room = room; peer.isHost = false;
      room.peers.set(peer.id, peer);
      send(peer, { t: 'room:joined', code, hostId: room.host.id, peerId: peer.id });
      send(room.host, { t: 'peer:join', peerId: peer.id, name: peer.name });
      sendRoom(room, { t: 'peer:list', peers: peerList(room) });
      break;
    }
    case 'room:leave': leaveRoom(peer); break;
    /* المضيف يرسل نسخة مخفية لكل لاعب: { views: { peerId: state } } */
    case 'state': {
      const room = peer.room;
      if (!room || room.host !== peer) return;
      const views = m.views || {};
      for (const [pid, p] of room.peers) {
        if (p === peer) continue;              // المضيف يعرض حالته محلياً
        const view = views[pid] || views.default;
        if (view) send(p, { t: 'state', state: view });
      }
      break;
    }
    case 'action': {
      const room = peer.room;
      if (!room || room.host === peer) return;
      send(room.host, { t: 'action', from: peer.id, name: peer.name, action: m.action });
      break;
    }
    case 'chat':
      if (peer.room) sendRoom(peer.room, { t: 'chat', from: peer.id, name: peer.name, seat: m.seat, text: String(m.text || '').slice(0, 220), avatar: m.avatar });
      break;
    case 'emoji':
      if (peer.room) sendRoom(peer.room, { t: 'emoji', from: peer.id, name: peer.name, seat: m.seat, emoji: m.emoji });
      break;
    case 'signal': {
      const room = peer.room;
      if (!room) return;
      const target = room.peers.get(m.to);
      if (target) send(target, { t: 'signal', from: peer.id, data: m.data });
      break;
    }
    case 'voice:state':
      if (peer.room) sendRoom(peer.room, { t: 'voice:state', peerId: peer.id, on: !!m.on }, peer);
      break;
    case 'ping': send(peer, { t: 'pong' }); break;
  }
}
function leaveRoom(peer) {
  const room = peer.room;
  if (!room) return;
  room.peers.delete(peer.id);
  peer.room = null;
  sendRoom(room, { t: 'peer:left', peerId: peer.id, name: peer.name });
  sendRoom(room, { t: 'peer:list', peers: peerList(room) });
  if (room.host === peer) {
    // نقل المضيفية أو إغلاق الغرفة
    const next = room.peers.values().next().value;
    if (next) {
      room.host = next; next.isHost = true;
      send(next, { t: 'room:created', code: room.code, peerId: next.id });
      sendRoom(room, { t: 'peer:list', peers: peerList(room) });
    } else rooms.delete(room.code);
  } else if (!room.peers.size) rooms.delete(room.code);
  peer.isHost = false;
}

/* =============================== الارتقاء ============================== */
server.on('upgrade', (req, socket) => {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch {}
  if (!/^\/ws\/?$/.test(pathname) || req.headers.upgrade !== 'websocket') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const peer = {
    id: 'peer-' + (++peerSeq) + '-' + crypto.randomBytes(2).toString('hex'),
    name: 'ضيف', ws: socket, buf: Buffer.alloc(0), frag: Buffer.alloc(0),
    fragOpcode: 0, room: null, isHost: false
  };
  socket.on('data', chunk => { try { parseFrames(peer, chunk); } catch { socket.destroy(); } });
  socket.on('close', () => leaveRoom(peer));
  socket.on('error', () => leaveRoom(peer));
  send(peer, { t: 'welcome', peerId: peer.id, name: peer.name });
});

server.listen(PORT, HOST, () => {
  console.log(`✓ تجارة — الخادم يعمل على http://${HOST}:${PORT}`);
  console.log(`  WebSocket: ws://<IP>:${PORT}/ws   ·   الصحة: /health`);
});
