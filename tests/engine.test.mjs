/* اختبارات محرك «تجارة» — node --test tests/engine.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require('../web/js/engine.js');

const RI = { J: 0, Q: 1, K: 2, B: 3 };
function h(str) {
  return str.split('').map((ch, i) => ({
    id: 'c' + i + ch, rank: ch, rankIdx: RI[ch], suit: '♠', deck: 0
  }));
}
function seats(n, type = 'human') {
  return Array.from({ length: n }, (_, i) => ({
    seat: i, name: 'لاعب' + (i + 1), type,
    difficulty: 'normal', personality: 'calm', avatar: '🧔'
  }));
}
function setOrder(g, order) {
  g.state.auction.order = order.slice();
  g.state.auction.turnPos = 0;
  return g;
}
function newGame(n = 3, overrides = {}) {
  const g = new T.Game({ seed: 12345 });
  g.start(Object.assign({
    seats: seats(n), startBalance: 50000,
    negotiationSec: 15, maxRounds: 20
  }, overrides));
  setOrder(g, Array.from({ length: n }, (_, i) => i));
  for (const p of g.state.players) {
    if (p.type === 'human') g.dispatch({ type: 'privacy:ready', seat: p.seat });
  }
  return g;
}
function setHands(g, list) {
  list.forEach((cards, i) => { g.state.players[i].hand = h(cards); });
}
function enterAll(g, amounts, { fold = [] } = {}) {
  const order = g.state.auction.order.slice();
  for (const seat of order) {
    if (g.state.phase !== 'auction') break;
    if (fold.includes(seat)) g.dispatch({ type: 'bid', seat, kind: 'fold' });
    else g.dispatch({ type: 'bid', seat, kind: 'enter', amount: amounts[seat] || 0 });
  }
  return g;
}
/** ترتيب دخول تصاعدي يضع المشرّف (أعلى مبلغ) في آخر الدور */
function ordered(g, amounts, order) {
  setOrder(g, order);
  return enterAll(g, amounts);
}

/* --------------------------- الرزم والتوزيع --------------------------- */
test('عدد الرزم يتسع لكل اللاعبين 2–10 دون نقص', () => {
  assert.equal(T.deckCountFor(2), 1);
  assert.equal(T.deckCountFor(4), 1);
  assert.equal(T.deckCountFor(5), 2);
  assert.equal(T.deckCountFor(8), 2);
  assert.equal(T.deckCountFor(9), 3);
  assert.equal(T.deckCountFor(10), 3);
  for (let n = 2; n <= 10; n++) {
    const g = new T.Game({ seed: n });
    g.start({ seats: seats(n, 'bot'), startBalance: 50000, maxRounds: 5 });
    assert.equal(g.state.deckCount, T.deckCountFor(n));
    for (const p of g.state.players) assert.equal(p.hand.length, 4, `لاعب ${p.seat} عند ${n} لاعبين`);
    assert.ok(g.state.deckCount * 16 >= n * 4);
  }
});

/* ----------------------------- قوة اليد ------------------------------- */
test('ترتيب البطاقات J < Q < K < البنط', () => {
  assert.equal(T.RANKS.join(''), 'JQKB');
  assert.ok(T.compareEval(T.evalHand(h('JJJJ')), T.evalHand(h('QQQQ'))) < 0);
  assert.ok(T.compareEval(T.evalHand(h('KKKK')), T.evalHand(h('BBBB'))) < 0);
});

test('الكثرة والتكرار أهم من أعلى ورقة: 4J أقوى من بنطين + Qين', () => {
  const fourJ = T.evalHand(h('JJJJ'));
  const twoBtwoQ = T.evalHand(h('BBQQ'));
  assert.equal(fourJ.category, 5);
  assert.equal(twoBtwoQ.category, 3);
  assert.ok(T.compareEval(fourJ, twoBtwoQ) > 0, '4J يجب أن تهزم زوجي بنط وQ');
});

test('سلّم القوة: رباعية > ثلاثية > زوجان > زوج > متفرقة', () => {
  const e = s => T.evalHand(h(s));
  const chain = ['JJJJ', 'JJJK', 'JJQQ', 'JJQK', 'JQKB'];
  for (let i = 0; i < chain.length - 1; i++) {
    assert.ok(e(chain[i]).category > e(chain[i + 1]).category, chain[i] + ' > ' + chain[i + 1]);
    assert.ok(T.compareEval(e(chain[i]), e(chain[i + 1])) > 0);
  }
});

test('حسم التعادل داخل الفئة بالرتبة ثم الكيكرز', () => {
  const e = s => T.evalHand(h(s));
  assert.ok(T.compareEval(e('BBBB'), e('KKKK')) > 0);
  assert.ok(T.compareEval(e('QQQJ'), e('QQQB')) < 0, 'الكيكر بنط يرفع الثلاثية');
  assert.ok(T.compareEval(e('BBQQ'), e('BBJJ')) > 0, 'الزوج الثاني يحسم الزوجان');
  assert.ok(T.compareEval(e('QQBK'), e('QQBJ')) > 0, 'الكيكر يحسم الزوج');
  assert.equal(T.compareEval(e('JQKB'), e('BQKJ')), 0, 'نفس الأوراق = تعادل تام');
});

/* ===================== السوق: دخول واحد + حد أدنى ==================== */
test('كل لاعب يدخل السوق مرة واحدة فقط في الجولة (بلا دورات مزايدة)', () => {
  const g = newGame(3);
  const a = g.state.auction;
  assert.equal(a.passNo, 1);
  assert.equal(a.maxPasses, 1);
  g.dispatch({ type: 'bid', seat: 0, kind: 'enter', amount: 1000 });
  // محاولة ثانية من نفس اللاعب تُرفض: دوره انتهى
  g.dispatch({ type: 'bid', seat: 0, kind: 'enter', amount: 9000 });
  assert.equal(a.history.length, 1, 'لا يُسجّل دخول ثانٍ');
  g.dispatch({ type: 'bid', seat: 1, kind: 'enter', amount: 2000 });
  g.dispatch({ type: 'bid', seat: 2, kind: 'enter', amount: 3000 });
  assert.equal(a.history.length, 3, 'ثلاثة أدوار فقط');
  assert.equal(a.passNo, 1, 'لا دورة رفع جديدة');
  assert.deepEqual(Object.keys(a.acted).map(Number).sort((x, y) => x - y), [0, 1, 2]);
  assert.equal(g.state.phase, 'supervisor', 'يُغلق السوق فوراً بعد آخر لاعب');
  assert.equal(g.state.supervisorId, 2);
});

test('الحد الأدنى = أعلى دخول سابق: لا يصح الدخول بأقل منه', () => {
  const g = newGame(3);
  g.dispatch({ type: 'bid', seat: 0, kind: 'enter', amount: 5000 });
  g.dispatch({ type: 'bid', seat: 1, kind: 'enter', amount: 100 });   // يُرفع للحد
  g.dispatch({ type: 'bid', seat: 2, kind: 'enter', amount: 6000 });
  assert.deepEqual(g.state.players.map(p => p.entry), [5000, 5000, 6000]);
  assert.equal(g.state.auction.highest, 6000);
  assert.equal(g.state.supervisorId, 2);
  assert.equal(g.state.phase, 'supervisor');
  // الدخول بمساواة الحد مسموح
  const g2 = newGame(2);
  g2.dispatch({ type: 'bid', seat: 0, kind: 'enter', amount: 7000 });
  g2.dispatch({ type: 'bid', seat: 1, kind: 'enter', amount: 7000 });
  assert.deepEqual(g2.state.players.map(p => p.entry), [7000, 7000]);
  assert.equal(g2.state.supervisorId, 0, 'التعادل يُحسم للأسبق في ترتيب الدور');
});

test('الاستثناء: من لا يملك الحد الأدنى يدخل بكامل رصيده', () => {
  const g = newGame(3);
  g.state.players[1].balance = 3000;
  g.dispatch({ type: 'bid', seat: 0, kind: 'enter', amount: 10000 });
  g.dispatch({ type: 'bid', seat: 1, kind: 'enter', amount: 10000 }); // كل الرصيد
  g.dispatch({ type: 'bid', seat: 2, kind: 'enter', amount: 100 });   // يُرفع للحد
  assert.deepEqual(g.state.players.map(p => p.entry), [10000, 3000, 10000]);
  assert.equal(g.state.auction.history[1].allIn, true);
  assert.ok(g.state.players[1].entry < g.state.auction.highest, 'الاستثناء الوحيد المسموح');
  assert.equal(g.state.phase, 'supervisor');
});

test('لا يمكن الدخول بأكثر من الرصيد، والدخول بصفر مسموح قبل أي مبلغ', () => {
  const g = newGame(2);
  g.dispatch({ type: 'bid', seat: 0, kind: 'enter', amount: 999999999 });
  assert.equal(g.state.players[0].entry, 50000);
  g.dispatch({ type: 'bid', seat: 1, kind: 'enter', amount: 0 });
  assert.equal(g.state.players[1].entry, 50000, 'الحد الأدنى 50,000 يُطبّق');
  assert.equal(g.state.phase, 'supervisor');

  const g2 = newGame(2);
  g2.dispatch({ type: 'bid', seat: 0, kind: 'enter', amount: 0 });
  g2.dispatch({ type: 'bid', seat: 1, kind: 'enter', amount: 0 });
  assert.deepEqual(g2.state.players.map(p => p.entry), [0, 0]);
  assert.equal(g2.state.supervisorId, 0);
});

/* ---------------------- التسوية: المثال العملي ------------------------ */
test('التسوية الدقيقة: صالح 5,000 يفوز → 55,000 / علي 30,000 / أحمد 40,000', () => {
  const g = newGame(3);
  g.state.players[0].name = 'صالح';
  g.state.players[1].name = 'علي';
  g.state.players[2].name = 'أحمد';
  setHands(g, ['JJJJ', 'QQQK', 'BBQQ']);
  // دخول غير متناقص: صالح 5,000 ← أحمد 10,000 ← علي 20,000
  ordered(g, [5000, 20000, 10000], [0, 2, 1]);
  assert.equal(g.state.phase, 'supervisor');
  assert.equal(g.state.supervisorId, 1, 'أعلى مبلغ دخول هو المشرّف');
  g.dispatch({ type: 'supervisor:choose', seat: 1, mode: 'fix' });
  const r = g.state.result;
  assert.equal(r.winnerId, 0, 'الفائز صاحب اليد الأقوى لا صاحب أعلى مبلغ');
  assert.equal(g.state.players[0].balance, 55000);
  assert.equal(g.state.players[1].balance, 30000);
  assert.equal(g.state.players[2].balance, 40000);
  assert.equal(r.winnerGain, 5000, 'الفائز يربح مبلغ دخوله فقط لا مجموع الخاسرين');
});

test('«الكل مثبت» يكشف أوراق الجميع ويفوز الأقوى', () => {
  const g = newGame(4);
  setHands(g, ['JQKB', 'QQQK', 'BBBB', 'JJJJ']);
  enterAll(g, [1000, 2000, 3000, 4000]);
  const sup = g.state.supervisorId;
  g.dispatch({ type: 'supervisor:choose', seat: sup, mode: 'fix' });
  assert.equal(g.state.result.winnerId, 2);
  assert.equal(g.state.result.byReveal, true);
  assert.deepEqual(g.state.result.contenders.sort(), [0, 1, 2, 3]);
});

/* ------------------------- الانسحاب والتفاوض -------------------------- */
test('قبول العرض: يُدفع فقط إذا فاز المشرّف ويُخصم منه', () => {
  const g = newGame(3);
  setHands(g, ['BBBB', 'JJJJ', 'QQQQ']);
  ordered(g, [20000, 10000, 5000], [2, 1, 0]);
  assert.equal(g.state.supervisorId, 0);
  g.dispatch({ type: 'supervisor:choose', seat: 0, mode: 'negotiate' });
  g.dispatch({ type: 'offers:submit', seat: 0, offers: { 1: 3000, 2: 0 } });
  g.dispatch({ type: 'negotiate:respond', seat: 1, choice: 'accept' });
  g.dispatch({ type: 'negotiate:respond', seat: 2, choice: 'insist' });
  assert.equal(g.state.phase, 'counters', 'المشرّف يقرّر بعد الردود');
  g.dispatch({ type: 'negotiation:reveal', seat: 0 });
  const r = g.state.result;
  assert.equal(r.winnerId, 0);
  assert.equal(r.supWon, true);
  assert.equal(g.state.players[1].balance, 53000, 'المنسحب يأخذ عرضه ولا يخسر دخوله');
  assert.equal(g.state.players[2].balance, 45000, 'الرافض يخسر مبلغ دخوله');
  assert.equal(g.state.players[0].balance, 67000, '+20,000 ربح − 3,000 عرض');
  assert.equal(r.offersPaid, 3000);
  assert.ok(!r.contenders.includes(1), 'المنسحب لا يُكشف ورقه');
});

test('خسارة المشرّف: المنسحب لا يربح ولا يخسر', () => {
  const g = newGame(3);
  setHands(g, ['JJJJ', 'BBBB', 'QQQQ']);
  ordered(g, [20000, 10000, 5000], [2, 1, 0]);
  g.dispatch({ type: 'supervisor:choose', seat: 0, mode: 'negotiate' });
  g.dispatch({ type: 'offers:submit', seat: 0, offers: { 1: 0, 2: 4000 } });
  g.dispatch({ type: 'negotiate:respond', seat: 2, choice: 'accept' });
  g.dispatch({ type: 'negotiate:respond', seat: 1, choice: 'insist' });
  g.dispatch({ type: 'negotiation:reveal', seat: 0 });
  const r = g.state.result;
  assert.equal(r.winnerId, 1);
  assert.equal(r.supWon, false);
  assert.equal(g.state.players[2].balance, 50000, 'لا ربح ولا خسارة للمنسحب');
  assert.equal(g.state.players[0].balance, 30000, 'المشرّف الخاسر يخسر دخوله');
  assert.equal(g.state.players[1].balance, 60000, 'الفائز يربح مبلغ دخوله فقط');
});

test('مجموع العروض لا يتجاوز ما دخل به المشرّف (ويعمل مع 0)', () => {
  const g = newGame(3);
  setHands(g, ['BBBB', 'JJJJ', 'QQQQ']);
  enterAll(g, [0, 1000, 1000]);
  const sup = g.state.supervisorId;
  assert.ok([1, 2].includes(sup), 'أعلى دخول 1,000 (التعادل يُحسب بالترتيب)');
  assert.equal(g.state.players[sup].entry, 1000);
  g.dispatch({ type: 'supervisor:choose', seat: sup, mode: 'negotiate' });
  g.dispatch({ type: 'offers:submit', seat: sup, offers: { 0: 9000, 1: 9000, 2: 9000 } });
  const total = Object.values(g.state.offers).reduce((a, b) => a + b, 0);
  assert.ok(total <= g.state.players[sup].entry);

  const g2 = newGame(2);
  setHands(g2, ['BBBB', 'JJJJ']);
  enterAll(g2, [0, 0]);
  g2.dispatch({ type: 'supervisor:choose', seat: g2.state.supervisorId, mode: 'negotiate' });
  g2.dispatch({ type: 'offers:submit', seat: g2.state.supervisorId, offers: { 0: 5000, 1: 5000 } });
  assert.equal(Object.values(g2.state.offers).reduce((a, b) => a + b, 0), 0, 'المشرّف الداخل بصفر يعرض صفراً');
});

test('التفاوض المضاد: قبول المشرّف يُنسحب اللاعب بالمبلغ الجديد', () => {
  const g = newGame(3);
  setHands(g, ['BBBB', 'JJJJ', 'QQQQ']);
  ordered(g, [20000, 10000, 5000], [2, 1, 0]);
  g.dispatch({ type: 'supervisor:choose', seat: 0, mode: 'negotiate' });
  g.dispatch({ type: 'offers:submit', seat: 0, offers: { 1: 1000, 2: 1000 } });
  g.dispatch({ type: 'negotiate:respond', seat: 1, choice: 'counter', amount: 4000 });
  g.dispatch({ type: 'negotiate:respond', seat: 2, choice: 'accept' });
  assert.equal(g.state.phase, 'counters');
  g.dispatch({ type: 'counter:decide', seat: 0, target: 1, accept: true });
  assert.equal(g.state.phase, 'counters', 'القبول لا يُنهي الجولة تلقائياً');
  g.dispatch({ type: 'negotiation:reveal', seat: 0 });
  assert.equal(g.state.phase, 'result');
  assert.equal(g.state.players[1].balance, 54000);
});

test('رفض التفاوض المضاد يُبقي باب التفاوض مفتوحاً', () => {
  const g = newGame(3);
  setHands(g, ['BBBB', 'JJJJ', 'QQQQ']);
  ordered(g, [20000, 10000, 5000], [2, 1, 0]);
  g.dispatch({ type: 'supervisor:choose', seat: 0, mode: 'negotiate' });
  g.dispatch({ type: 'offers:submit', seat: 0, offers: { 1: 1000, 2: 1000 } });
  g.dispatch({ type: 'negotiate:respond', seat: 1, choice: 'counter', amount: 4000 });
  g.dispatch({ type: 'negotiate:respond', seat: 2, choice: 'reject' });
  assert.equal(g.state.phase, 'counters');
  g.dispatch({ type: 'counter:decide', seat: 0, target: 1, accept: false });
  assert.equal(g.state.phase, 'counters', 'الرفض لا يعني كشف الأوراق فوراً');
  assert.equal(g.state.players[1].response, 'reject');
  assert.equal(g.state.counterPending.length, 0);
  g.dispatch({ type: 'negotiation:reveal', seat: 0 });
  assert.equal(g.state.phase, 'result');
});

test('التفاوض يتكرر أكثر من جولة حتى القناعة والرضى', () => {
  const g = newGame(3);
  setHands(g, ['BBBB', 'JJJJ', 'QQQQ']);
  ordered(g, [20000, 10000, 5000], [2, 1, 0]);
  g.dispatch({ type: 'supervisor:choose', seat: 0, mode: 'negotiate' });
  g.dispatch({ type: 'offers:submit', seat: 0, offers: { 1: 1000, 2: 1000 } });
  assert.equal(g.state.offersRound, 1);

  // الجولة 1: أحدهما يفاوض والآخر يرفض
  g.dispatch({ type: 'negotiate:respond', seat: 1, choice: 'counter', amount: 4000 });
  g.dispatch({ type: 'negotiate:respond', seat: 2, choice: 'reject' });
  assert.equal(g.state.phase, 'counters');
  assert.equal(g.state.offersHistory.length, 1);

  // الجولة 2: يعيد المشرّف العرض
  g.dispatch({ type: 'offers:submit', seat: 0, offers: { 1: 3000, 2: 1500 } });
  assert.equal(g.state.phase, 'negotiation');
  assert.equal(g.state.offersRound, 2);
  assert.equal(g.state.players[1].response, null, 'أُعيد فتح الرد');
  assert.equal(g.state.players[2].response, null);
  g.dispatch({ type: 'negotiate:respond', seat: 1, choice: 'counter', amount: 5000 });
  g.dispatch({ type: 'negotiate:respond', seat: 2, choice: 'accept' });
  assert.equal(g.state.phase, 'counters');
  assert.equal(g.state.offersHistory.length, 2);

  // الجولة 3: العرض الحاسم، والمنسحب السابق لا يُزعج مجدداً
  g.dispatch({ type: 'offers:submit', seat: 0, offers: { 1: 5000 } });
  assert.equal(g.state.offersRound, 3);
  assert.equal(g.state.phase, 'negotiation');
  assert.equal(g.state.players[2].response, 'accept');
  g.dispatch({ type: 'negotiate:respond', seat: 1, choice: 'accept' });
  assert.equal(g.state.phase, 'result', 'الرضى التام يُنهي التفاوض');
  assert.equal(g.state.result.negotiationRounds, 3);
  assert.equal(g.state.offersHistory.length, 3);
  assert.equal(g.state.players[1].balance, 55000, 'أخذ مبلغ الجولة الأخيرة');
  assert.equal(g.state.players[2].balance, 51500, 'أخذ عرض جولته');
  assert.equal(g.state.result.offersPaid, 6500);
});

test('«فرش الأوراق وتثبيت المعاندين» بقرار المشرّف', () => {
  const g = newGame(3);
  setHands(g, ['BBBB', 'JJJJ', 'QQQQ']);
  ordered(g, [20000, 10000, 5000], [2, 1, 0]);
  g.dispatch({ type: 'supervisor:choose', seat: 0, mode: 'negotiate' });
  g.dispatch({ type: 'offers:submit', seat: 0, offers: { 1: 1000, 2: 1000 } });
  g.dispatch({ type: 'negotiate:respond', seat: 1, choice: 'insist' });
  g.dispatch({ type: 'negotiate:respond', seat: 2, choice: 'reject' });
  assert.equal(g.state.phase, 'counters');
  g.dispatch({ type: 'negotiation:reveal', seat: 0 });
  assert.equal(g.state.phase, 'result');
  assert.equal(g.state.result.byReveal, true);
  assert.deepEqual(g.state.result.contenders.slice().sort(), [0, 1, 2]);
  assert.equal(g.state.result.negotiationRounds, 1);
  assert.ok(g.events.some(e => e.kind === 'log' && e.text.indexOf('فرش الأوراق') !== -1), 'يُسجّل حدث الفرش');
});

test('انتهاء وقت التفاوض يُعتبر إصراراً ويترك القرار للمشرّف', () => {
  let clock = 1000;
  const g = new T.Game({ seed: 7, now: () => clock });
  g.start({ seats: seats(3), startBalance: 50000, negotiationSec: 10, maxRounds: 4 });
  for (const p of g.state.players) g.dispatch({ type: 'privacy:ready', seat: p.seat });
  setHands(g, ['BBBB', 'JJJJ', 'QQQQ']);
  ordered(g, [20000, 10000, 5000], [2, 1, 0]);
  g.dispatch({ type: 'supervisor:choose', seat: 0, mode: 'negotiate' });
  g.dispatch({ type: 'offers:submit', seat: 0, offers: { 1: 1000, 2: 1000 } });
  assert.equal(g.state.negotiationEndsAt, 11000);
  clock = 12000;
  g.dispatch({ type: 'negotiation:timeout' });
  assert.equal(g.state.phase, 'counters', 'لا يُكشف الورق قسراً قبل قرار المشرّف');
  assert.equal(g.state.players[1].response, 'insist');
  assert.equal(g.state.players[2].response, 'insist');
  assert.equal(g.state.offersHistory.length, 1);
  // يمكنه إعادة العرض رغم انتهاء الوقت
  g.dispatch({ type: 'offers:submit', seat: 0, offers: { 1: 2000, 2: 2000 } });
  assert.equal(g.state.offersRound, 2);
  assert.equal(g.state.phase, 'negotiation');
  g.dispatch({ type: 'negotiation:reveal', seat: 0 });
  assert.equal(g.state.phase, 'result');
});

test('الوقت «مفتوح» لا يضع مؤقتاً', () => {
  const g = new T.Game({ seed: 3, now: () => 500 });
  g.start({ seats: seats(2), startBalance: 50000, negotiationSec: 0 });
  for (const p of g.state.players) g.dispatch({ type: 'privacy:ready', seat: p.seat });
  setOrder(g, [0, 1]);
  enterAll(g, [1000, 1000]);
  g.dispatch({ type: 'supervisor:choose', seat: 0, mode: 'negotiate' });
  g.dispatch({ type: 'offers:submit', seat: 0, offers: { 1: 0 } });
  assert.equal(g.state.negotiationEndsAt, 0);
});

/* --------------------------- الرحمة والإيقاف -------------------------- */
test('الرحمة 5,000 مرة واحدة ثم إيقاف 3 جولات كاملة', () => {
  const g = newGame(2, { startBalance: 50000, maxRounds: 12 });
  setHands(g, ['BBBB', 'JJJJ']);
  enterAll(g, [1000, 50000]);
  g.dispatch({ type: 'supervisor:choose', seat: g.state.supervisorId, mode: 'fix' });
  assert.equal(g.state.players[1].balance, 5000);
  assert.equal(g.state.players[1].mercyUsed, true);
  assert.equal(g.state.stats.mercy, 1);
  assert.equal(g.state.players[1].suspendedFor, 0);

  g.dispatch({ type: 'next' });
  setHands(g, ['BBBB', 'JJJJ']);
  setOrder(g, [0, 1]);
  for (const p of g.state.players) if (p.type === 'human') g.dispatch({ type: 'privacy:ready', seat: p.seat });
  enterAll(g, [1000, 5000]);
  g.dispatch({ type: 'supervisor:choose', seat: g.state.supervisorId, mode: 'fix' });
  assert.equal(g.state.players[1].balance, 0);
  assert.equal(g.state.players[1].suspendedFor, 3);
  assert.equal(g.state.stats.suspensions, 1);
  const startRound = g.state.round;

  for (let i = 1; i <= 3; i++) {
    g.dispatch({ type: 'next' });
    assert.equal(g.state.players[1].hand.length, 0, 'الموقوف لا يستلم أوراقاً في الجولة ' + i);
    assert.equal(g.state.round, startRound + i);
    assert.ok(!g.state.auction.order.includes(1));
    g.dispatch({ type: 'privacy:ready', seat: 0 });
    for (const seat of g.state.auction.order.slice()) g.dispatch({ type: 'bid', seat, kind: 'fold' });
    assert.equal(g.state.phase, 'result');
  }
  g.dispatch({ type: 'next' });
  assert.equal(g.state.players[1].hand.length, 4, 'يعود بعد 3 جولات');
  assert.equal(g.state.players[1].suspendedFor, 0);
});

/* ------------------------------ البوتات ------------------------------- */
test('البوتات تكمل مباراة كاملة بـ 10 لاعبين دون توقف أو أرصدة سالبة', () => {
  const g = new T.Game({ seed: 99 });
  g.start({ seats: seats(10, 'bot'), startBalance: 50000, negotiationSec: 10, maxRounds: 12 });
  let guard = 0;
  while (g.state.phase !== 'matchEnd' && guard++ < 4000) {
    const st = g.state;
    if (st.phase === 'privacy') break;
    if (st.phase === 'result') { g.dispatch({ type: 'next' }); continue; }
    const actor = g.currentActor();
    if (!actor) {
      if (st.phase === 'negotiation') { g.dispatch({ type: 'negotiation:timeout' }); continue; }
      if (st.phase === 'counters') { g.dispatch({ type: 'negotiation:reveal', seat: st.supervisorId }); continue; }
      break;
    }
    const act = g.botAction(actor.seat);
    if (!act) break;
    g.dispatch(act);
    assert.ok(g.state.players.every(p => p.balance >= 0), 'لا أرصدة سالبة');
  }
  assert.equal(g.state.phase, 'matchEnd', 'انتهت المباراة (guard=' + guard + ')');
  assert.equal(g.state.matchSummary.players, 10);
  assert.equal(g.state.matchSummary.rounds, 12);
});

/* -------------------------- إخفاء أوراق الشبكة ----------------------- */
test('maskFor يخفي أوراق الخصوم ويُظهرها بعد الكشف', () => {
  const g = newGame(3);
  setHands(g, ['BBBB', 'JJJJ', 'QQQQ']);
  const hidden = T.maskFor(g.state, 0);
  assert.equal(hidden.players[0].hand.length, 4);
  assert.ok(hidden.players[1].hand.every(c => c.hidden));
  enterAll(g, [1000, 2000, 3000]);
  g.dispatch({ type: 'supervisor:choose', seat: 2, mode: 'fix' });
  const shown = T.maskFor(g.state, 0);
  assert.ok(shown.players[1].hand.every(c => c.rank), 'تظهر الأوراق بعد الكشف');
  assert.equal(shown.youAre, 0);
});

test('جولة بلا داخلين تُعاد دون خسائر', () => {
  const g = newGame(3);
  for (const seat of g.state.auction.order.slice()) g.dispatch({ type: 'bid', seat, kind: 'fold' });
  assert.equal(g.state.phase, 'result');
  assert.equal(g.state.result.void, true);
  assert.ok(g.state.players.every(p => p.balance === 50000));
});

test('الإيموجي يُضاف لسجل الدردشة كفقاعة متحركة', () => {
  const g = newGame(2);
  g.dispatch({ type: 'emoji', seat: 0, emoji: '🤪' });
  const last = g.state.chat[g.state.chat.length - 1];
  assert.equal(last.text, '🤪');
  assert.equal(last.emoji, true);
  assert.equal(g.drainEvents().some(e => e.kind === 'emoji'), true);
});
