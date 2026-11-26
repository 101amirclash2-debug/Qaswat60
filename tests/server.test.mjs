/* اختبار بروتوكول غرف «تجارة»: إنشاء/انضمام، إجراءات، حالة مخفاة، دردشة */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 5199;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:' + PORT;

function track(ws) {
  ws.msgs = [];
  ws.onmessage = ev => { try { ws.msgs.push(JSON.parse(ev.data)); } catch {} };
  return ws;
}
async function next(ws, pred, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = ws.msgs.find(pred);
    if (m) return m;
    await sleep(15);
  }
  throw new Error('لم تصل الرسالة المتوقعة: ' + JSON.stringify(ws.msgs));
}
function open(url) {
  return new Promise((resolve, reject) => {
    const ws = track(new WebSocket(url));
    ws.onopen = () => resolve(ws);
    ws.onerror = e => reject(new Error('ws error'));
    setTimeout(() => reject(new Error('ws timeout')), 4000);
  });
}
const send = (ws, obj) => ws.send(JSON.stringify(obj));

test('الخادم: صفحات + غرف WebSocket + بثّ حالة لكل لاعب', async () => {
  const child = spawn(process.execPath, ['server/server.mjs'], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', d => log += d.toString());
  child.stderr.on('data', d => log += d.toString());
  const close = () => { try { child.kill('SIGTERM'); } catch {} };
  try {
    // انتظار جاهزية الخادم
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      try { const r = await fetch(BASE + '/health'); if (r.ok) ready = true; } catch {}
      if (!ready) await sleep(60);
    }
    assert.ok(ready, 'الخادم لم يبدأ: ' + log);
    const health = await (await fetch(BASE + '/health')).json();
    assert.equal(health.ok, true);
    assert.equal(health.ws, '/ws');
    const index = await (await fetch(BASE + '/')).text();
    assert.match(index, /تجارة/);

    const host = await open('ws://127.0.0.1:' + PORT + '/ws');
    const hostWelcome = await next(host, m => m.t === 'welcome');
    const hostId = hostWelcome.peerId;
    send(host, { t: 'room:create', name: 'المضيف', settings: { players: 4 } });
    const created = await next(host, m => m.t === 'room:created');
    assert.match(created.code, /^[A-Z2-9]{5}$/);

    const guest = await open('ws://127.0.0.1:' + PORT + '/ws');
    const guestWelcome = await next(guest, m => m.t === 'welcome');
    const guestId = guestWelcome.peerId;
    send(guest, { t: 'room:join', code: created.code, name: 'ضيف' });
    const joined = await next(guest, m => m.t === 'room:joined');
    assert.equal(joined.code, created.code);
    const pj = await next(host, m => m.t === 'peer:join' && m.peerId === guestId);
    assert.equal(pj.name, 'ضيف');
    const list = await next(guest, m => m.t === 'peer:list' && m.peers.length === 2);
    assert.ok(list.peers.some(p => p.isHost));

    // إجراء من الضيف → المضيف فقط
    send(guest, { t: 'action', action: { type: 'bid', seat: 1, kind: 'enter', amount: 5000 } });
    const act = await next(host, m => m.t === 'action' && m.from === guestId);
    assert.equal(act.action.amount, 5000);
    assert.equal(host.msgs.filter(m => m.t === 'action').length, 1);

    // حالة مخفاة لكل لاعب
    send(host, { t: 'state', views: { [guestId]: { youAre: 1, players: [{ hand: [{ hidden: true }] }] } } });
    const st = await next(guest, m => m.t === 'state');
    assert.equal(st.state.youAre, 1);
    assert.deepEqual(st.state.players[0].hand, [{ hidden: true }]);

    // دردشة للجميع بما فيهم المُرسِل
    send(guest, { t: 'chat', text: 'ثبت', seat: 1 });
    const c1 = await next(host, m => m.t === 'chat' && m.text === 'ثبت');
    const c2 = await next(guest, m => m.t === 'chat' && m.text === 'ثبت');
    assert.equal(c1.text, c2.text);

    // إشارة صوت WebRTC
    send(guest, { t: 'signal', to: hostId, data: { kind: 'offer', sdp: 'x' } });
    const sig = await next(host, m => m.t === 'signal' && m.from === guestId);
    assert.equal(sig.data.kind, 'offer');

    // مغادرة
    guest.close();
    const left = await next(host, m => m.t === 'peer:left' && m.peerId === guestId);
    assert.ok(left);
    host.close();
  } finally { close(); }
});
