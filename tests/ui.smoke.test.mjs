/* اختبار دخان للواجهة الكاملة داخل jsdom: تحميل، تنقل، قوانين، جولة كاملة */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM, VirtualConsole } from 'jsdom';
const require = createRequire(import.meta.url);

const FILE = path.resolve('web/index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = await JSDOM.fromFile(FILE, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    url: 'file://' + FILE,
    virtualConsole: vc,
    beforeParse(win) {
      win.scrollTo = () => {};
      win.HTMLElement.prototype.scrollIntoView = () => {};
      win.HTMLCanvasElement.prototype.getContext = () => null;
      // لا حاجة للمؤقتات الدورية في jsdom؛ تجنّب مقابض تبقي العملية حيّة
      win.setInterval = () => 0;
    }
  });
  await new Promise(res => {
    if (dom.window.document.readyState === 'complete') return res();
    dom.window.addEventListener('load', res);
    setTimeout(res, 4000);
  });
  await sleep(60);
  return { dom, win: dom.window, errors };
}
function click(win, selector) {
  const el = win.document.querySelector(selector);
  assert.ok(el, 'العنصر مفقود: ' + selector);
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  return el;
}
function humanAction(App, st, seat) {
  switch (st.phase) {
    case 'privacy': return { type: 'privacy:ready', seat };
    case 'auction': return { type: 'bid', seat, kind: 'enter', amount: 1000 };
    case 'supervisor': return { type: 'supervisor:choose', seat, mode: 'fix' };
    case 'offers': return { type: 'offers:submit', seat, offers: {} };
    case 'negotiation': return { type: 'negotiate:respond', seat, choice: 'insist' };
    case 'counters': return { type: 'counter:decide', seat: st.supervisorId, target: (st.counterPending || [])[0], accept: false };
    default: return null;
  }
}

test('الواجهة تُحمّل وتُكمل جولة كاملة بـ 6 لاعبين دون أخطاء', async () => {
  const { win, errors, dom } = await boot();
  const App = win.TijaraApp, UI = win.TijaraUI, T = win.TijaraEngine;
  assert.ok(T && T.Game && App && UI, 'كل الوحدات محمّلة');
  assert.equal(errors.length, 0, 'أخطاء تحميل: ' + errors.join(' | '));
  assert.ok(win.document.querySelector('.brand-title'), 'الشاشة الرئيسية ظاهرة');
  assert.equal(win.document.querySelector('#screen-home').classList.contains('active'), true);

  // شاشة الإعدادات + القوانين
  click(win, '[data-nav="setup"]');
  assert.ok(win.document.querySelector('#screen-setup').classList.contains('active'));
  assert.equal(win.document.querySelectorAll('#setup-body [data-act="players"]').length, 9, 'خيارات 2–10 لاعبين');
  assert.equal(win.document.querySelector('#setup-body [data-field="startBalance"]').value, '50000');
  click(win, '#screen-setup [data-modal="rules"]');
  assert.match(win.document.querySelector('.modal-body').textContent, /ما هي «تجارة»/);
  click(win, '[data-act="rules:tab"][data-i="5"]');
  assert.match(win.document.querySelector('.modal-body').textContent, /55,000/);
  click(win, '.modal-foot [data-act="modal:close"]');

  // 6 لاعبين → رزمتان
  click(win, '#setup-body [data-act="players"][data-n="6"]');
  assert.equal(App.setupSeats.length, 6);
  click(win, '#btn-start');
  assert.ok(win.document.querySelector('#screen-game').classList.contains('active'));
  assert.equal(App.state.players.length, 6);
  assert.equal(App.state.deckCount, 2, 'رزمتان لـ 5–8 لاعبين');
  assert.equal(App.state.phase, 'privacy');

  // خصوصية الأوراق
  assert.ok(win.document.querySelector('[data-act="privacy:show"]'));
  click(win, '[data-act="privacy:show"]');
  assert.ok(win.document.querySelector('.privacy-card .pcard'), 'أوراق اللاعب ظهرت');
  click(win, '[data-act="privacy:hide"]');
  assert.equal(App.state.phase, 'auction');

  // جولة كاملة (البوتات تُشغّل يدوياً لتفادي المؤقتات)
  App.state.settings.negotiationSec = 0;
  App.scheduleBots = () => {};
  let guard = 0;
  while (App.state.phase !== 'result' && guard++ < 120) {
    const st = App.state;
    const seat = App.currentActorSeat();
    if (seat === null || seat === undefined) {
      if (st.phase === 'negotiation') { App.act({ type: 'negotiation:timeout' }); continue; }
      break;
    }
    const p = st.players[seat];
    let action = (p && p.type === 'bot') ? App.game.botAction(seat) : humanAction(App, st, seat);
    if (!action) break;
    App.act(action);
  }
  assert.equal(App.state.phase, 'result', 'وصلنا لنتيجة الجولة (guard=' + guard + ')');
  assert.ok(App.state.result, 'كائن النتيجة موجود');
  assert.ok(App.state.players.every(p => p.balance >= 0), 'لا أرصدة سالبة');
  assert.ok(App.state.log.length > 2, 'سجل الأحداث ممتلئ');
  assert.ok(win.document.querySelector('#seats').children.length === 6, 'ستة مقاعد مرسومة');
  assert.ok(win.document.querySelector('#action-panel').textContent.length > 10, 'لوحة الإجراءات معروضة');
  assert.equal(errors.length, 0, 'أخطاء أثناء اللعب: ' + errors.join(' | '));

  // بقية الشاشات تُعرض دون استثناء
  UI.go('history'); assert.match(win.document.querySelector('#history-body').textContent, /أكبر ربح/);
  UI.go('friends'); assert.match(win.document.querySelector('#friends-body').textContent, /غرفة/);
  UI.go('settings'); assert.match(win.document.querySelector('#settings-body').textContent, /المؤثرات الصوتية/);
  assert.equal(errors.length, 0, 'أخطاء في الشاشات: ' + errors.join(' | '));
  dom.window.close();
});

test('المحرك المُحمّل في الصفحة يطابق نسخة Node', async () => {
  const { win, dom } = await boot();
  const T = win.TijaraEngine, NodeT = require('../web/js/engine.js');
  assert.equal(T.evalHand([{ rank: 'J', rankIdx: 0 }, { rank: 'J', rankIdx: 0 }, { rank: 'J', rankIdx: 0 }, { rank: 'J', rankIdx: 0 }]).category, 5);
  assert.equal(T.compareEval.toString().length, NodeT.compareEval.toString().length);
  dom.window.close();
});
