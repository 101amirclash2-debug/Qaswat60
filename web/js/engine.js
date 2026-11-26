/* ==========================================================================
   تجارة — محرك القواعد (pure logic, no DOM)
   يعمل في المتصفح (script عادي) وفي Node للاختبارات.
   ========================================================================== */
(function (root) {
  'use strict';

  /* ----------------------------- ثوابت ---------------------------------- */
  const RANKS = ['J', 'Q', 'K', 'B'];            // من الأضعف إلى الأقوى
  const RANK_NAME = { J: 'J — الولد', Q: 'Q — البنت', K: 'K — الملك', B: 'البنط' };
  const RANK_SHORT = { J: 'J', Q: 'Q', K: 'K', B: 'بنط' };
  const SUITS = ['♠', '♥', '♦', '♣'];
  const SUIT_NAME = { '♠': 'بستوني', '♥': 'قلوب', '♦': 'ديناري', '♣': 'شجر' };
  const CATEGORY_NAME = {
    1: 'أوراق متفرقة', 2: 'زوج واحد', 3: 'زوجان',
    4: 'ثلاثية', 5: 'رباعية'
  };

  const DIFFICULTIES = [
    { id: 'very_easy', name: 'سهل جداً', skill: 0.05, noise: 0.95 },
    { id: 'easy', name: 'سهل', skill: 0.25, noise: 0.70 },
    { id: 'normal', name: 'متوسط', skill: 0.50, noise: 0.45 },
    { id: 'hard', name: 'صعب', skill: 0.72, noise: 0.25 },
    { id: 'very_hard', name: 'صعب جداً', skill: 0.90, noise: 0.12 },
    { id: 'legend', name: 'أسطوري', skill: 1.00, noise: 0.04 }
  ];

  const PERSONALITIES = [
    { id: 'whale', name: 'الهوّامير', emoji: '🤑', aggression: 0.95, bluff: 0.12, greed: 0.85, talk: 0.7 },
    { id: 'trickster', name: 'المراوغ', emoji: '🤪', aggression: 0.65, bluff: 0.80, greed: 0.55, talk: 0.9 },
    { id: 'negotiator', name: 'المفاوض', emoji: '😏', aggression: 0.45, bluff: 0.45, greed: 0.70, talk: 0.8 },
    { id: 'cautious', name: 'المحافظ', emoji: '😑', aggression: 0.22, bluff: 0.15, greed: 0.30, talk: 0.3 },
    { id: 'reckless', name: 'المتهور', emoji: '🤯', aggression: 0.90, bluff: 0.55, greed: 0.60, talk: 0.85 },
    { id: 'sniper', name: 'القنّاص', emoji: '😈', aggression: 0.55, bluff: 0.35, greed: 0.75, talk: 0.35 },
    { id: 'calm', name: 'الهادي', emoji: '😌', aggression: 0.40, bluff: 0.30, greed: 0.45, talk: 0.4 },
    { id: 'lion', name: 'الزعيم', emoji: '😤', aggression: 0.80, bluff: 0.40, greed: 0.80, talk: 0.75 }
  ];

  const BOT_NAMES = [
    'أبو تركي', 'سالم', 'منصور', 'فهد', 'عبدالله', 'مازن', 'راشد', 'ناصر',
    'يوسف', 'خالد', 'بدر', 'عمر', 'سلطان', 'زياد', 'طلال', 'همّام'
  ];

  const DEFAULT_SETTINGS = {
    startBalance: 50000,
    negotiationSec: 15,        // 0 = مفتوح
    seats: [],                 // تُبنى في الواجهة
    maxRounds: 20,
    sound: true, music: true, vibration: true, effects: true
  };

  const QUICK_PHRASES = [
    'ثبت', 'سأثبت', 'أنا الأقوى', 'لست ضعيفاً', 'كم يرضيك',
    'إرضيني', 'إدعموني', 'السوق ليا', 'لا تصدقوه', 'أنا خارج'
  ];
  const EMOJIS = ['🤪', '🤑', '😭', '😱', '😤', '😂', '😅', '🤯', '🥳', '😑', '😏', '😈', '😒',
    '🔥', '💰', '🃏', '👑', '💎', '👀', '🤝', '⚡', '☠️', '🙌', '🫡', '💸', '🎯', '🫵'];

  /* --------------------------- أدوات مساعدة ---------------------------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function intAmount(n) { n = Number(n); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; }
  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
  function roundTo(n, step) { step = step || 500; return Math.max(0, Math.round(n / step) * step); }
  function uid(prefix) { return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9); }

  /* ------------------------- الرزم والتوزيع ---------------------------- */
  function deckCountFor(players) {
    if (players <= 4) return 1;
    if (players <= 8) return 2;
    return 3;                       // 9–10 لاعبين
  }
  function makeDecks(count) {
    const cards = [];
    for (let d = 0; d < count; d++) {
      for (const s of SUITS) {
        for (let r = 0; r < RANKS.length; r++) {
          cards.push({
            id: 'd' + d + '-' + s + '-' + r,
            rank: RANKS[r], rankIdx: r, suit: s, deck: d
          });
        }
      }
    }
    return cards;
  }
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ------------------- تقييم اليد (الكثرة والتكرار) -------------------- */
  /**
   * قوة اليد = نمط التكرار أولاً، ثم رتبة المجموعة، ثم الكيكرز.
   * 4 × J  >  2 × بنط + 2 × Q   (رباعية > زوجان)
   * key: مصفوفة أرقام تُقارن معجمياً (الأكبر أقوى).
   */
  function evalHand(cards) {
    const cs = (cards || []).filter(Boolean);
    const counts = [0, 0, 0, 0];
    for (const c of cs) counts[c.rankIdx]++;
    const groups = [];
    for (let r = 0; r < 4; r++) if (counts[r]) groups.push({ r: r, n: counts[r] });
    groups.sort((a, b) => (b.n - a.n) || (b.r - a.r));

    let category, key, label;
    const g0 = groups[0], g1 = groups[1];
    if (g0 && g0.n === 4) {
      category = 5; key = [g0.r];
      label = 'رباعية ' + RANK_SHORT[RANKS[g0.r]];
    } else if (g0 && g0.n === 3) {
      const kicker = groups[1] ? groups[1].r : 0;
      category = 4; key = [g0.r, kicker];
      label = 'ثلاثية ' + RANK_SHORT[RANKS[g0.r]];
    } else if (g0 && g0.n === 2 && g1 && g1.n === 2) {
      category = 3; key = [Math.max(g0.r, g1.r), Math.min(g0.r, g1.r)];
      label = 'زوجان ' + RANK_SHORT[RANKS[key[0]]] + ' + ' + RANK_SHORT[RANKS[key[1]]];
    } else if (g0 && g0.n === 2) {
      const kickers = groups.slice(1).map(g => g.r).sort((a, b) => b - a);
      category = 2; key = [g0.r].concat(kickers);
      label = 'زوج ' + RANK_SHORT[RANKS[g0.r]];
    } else {
      const all = groups.map(g => g.r).sort((a, b) => b - a);
      category = 1; key = all;
      label = 'أوراق متفرقة · أعلى ' + (all.length ? RANK_SHORT[RANKS[all[0]]] : '—');
    }
    while (key.length < 4) key.push(-1);

    // درجة 0..1 للبوتات فقط
    let score = (category - 1) / 4 * 0.72 + (key[0] + 1) / 4 * 0.18;
    score += (key[1] + 1) / 4 * 0.06 + (key[2] + 1) / 4 * 0.03 + (key[3] + 1) / 4 * 0.01;
    return {
      category: category, categoryName: CATEGORY_NAME[category],
      key: key, label: label, score: clamp(score, 0, 1),
      counts: counts, ranks: cs.map(c => c.rank)
    };
  }
  function compareEval(a, b) {
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    for (let i = 0; i < 4; i++) {
      if (a.key[i] !== b.key[i]) return a.key[i] < b.key[i] ? -1 : 1;
    }
    return 0;
  }
  function handStrengthText(e) {
    return e.categoryName + ' · ' + e.label;
  }

  /* ---------------------- إعداد المقاعد الافتراضي ---------------------- */
  function buildSeats(n, opts) {
    opts = opts || {};
    const seats = [];
    for (let i = 0; i < n; i++) {
      seats.push({
        seat: i,
        name: i === 0 ? (opts.myName || 'أنت') : BOT_NAMES[(i - 1) % BOT_NAMES.length],
        type: i === 0 ? 'human' : 'bot',
        difficulty: opts.difficulty || 'normal',
        personality: PERSONALITIES[i % PERSONALITIES.length].id,
        avatar: ['🧔', '👳', '🧑', '👨', '🧕', '👲', '🧙', '🕺', '🤴', '🦸'][i],
        peer: null
      });
    }
    return seats;
  }

  /* ============================ اللعبة ================================= */
  class Game {
    constructor(options) {
      options = options || {};
      this.seed = options.seed || (Math.random() * 1e9) | 0;
      this.rng = options.rng || mulberry32(this.seed);
      this.now = options.now || function () { return Date.now(); };
      this.state = null;
      this.events = [];
      this.onChange = options.onChange || null;
    }
    emit(kind, data) {
      const ev = Object.assign({ kind: kind, at: this.now() }, data || {});
      this.events.push(ev);
      if (this.state) this.state.lastEvent = ev;
      return ev;
    }
    drainEvents() { const e = this.events; this.events = []; return e; }
    changed() { if (this.onChange) this.onChange(this.state, this.drainEvents()); }

    /* --------------------------- بدء المباراة -------------------------- */
    start(settings) {
      const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
      s.startBalance = clamp(intAmount(s.startBalance), 1000, 10000000);
      s.maxRounds = clamp(intAmount(s.maxRounds) || 20, 1, 999);
      s.seats = (s.seats && s.seats.length >= 2) ? s.seats.slice(0, 10) : buildSeats(4);

      const players = s.seats.map((cfg, i) => ({
        id: 'p' + i, seat: i,
        name: cfg.name || ('لاعب ' + (i + 1)),
        type: cfg.type === 'human' ? 'human' : 'bot',
        difficulty: cfg.difficulty || 'normal',
        personality: cfg.personality || PERSONALITIES[i % PERSONALITIES.length].id,
        avatar: cfg.avatar || '🧔',
        peer: cfg.peer || null,
        balance: s.startBalance,
        startBalance: s.startBalance,
        mercyUsed: false, suspendedFor: 0,
        hand: [], entry: null, folded: false, revealed: false,
        withdrawal: null, response: null, counter: null,
        stats: { wins: 0, losses: 0, biggestWin: 0, biggestLoss: 0, mercy: 0, suspensions: 0, whaleTakedowns: 0, negotiatedWins: 0, fixWins: 0, streak: 0 }
      }));

      this.state = {
        id: uid('match'), createdAt: this.now(),
        settings: s, players: players, round: 0,
        startIdx: Math.floor(this.rng() * players.length),  // عشوائي في الجولة الأولى
        phase: 'setup', privacySeen: [], auction: null,
        supervisorId: null, offers: {}, negotiationEndsAt: 0,
        result: null, matchSummary: null,
        chat: [], log: [], deckCount: deckCountFor(players.length),
        stats: { rounds: 0, biggestWin: 0, biggestLoss: 0, whaleTakedowns: 0, mercy: 0, suspensions: 0, negotiations: 0 },
        bustOrder: []
      };
      this.emit('start', { players: players.length, balance: s.startBalance });
      this.newRound();
      return this.state;
    }

    /* ----------------------------- جولة جديدة ------------------------- */
    newRound() {
      const st = this.state;
      st.round += 1;
      st.stats.rounds = st.round;
      st.result = null;
      st.supervisorId = null;
      st.offers = {};
      st.negotiationEndsAt = 0;
      st.negotiationThisRound = false;
      st.counterPending = [];
      st.revealedSeats = [];
      // اللاعبون البعيدون يرون أوراقهم على أجهزتهم؛ لا يحتاجون تسليم جهاز
      st.privacySeen = st.players.filter(p => p.peer).map(p => p.seat);
      st.phase = 'deal';

      for (const p of st.players) {
        p.hand = []; p.entry = null; p.folded = false; p.revealed = false;
        p.withdrawal = null; p.response = null; p.counter = null;
      }

      const active = st.players.filter(p => p.suspendedFor === 0);
      st.deckCount = deckCountFor(st.players.length);
      const deck = shuffle(makeDecks(st.deckCount), this.rng);
      let k = 0;
      for (const p of active) {
        p.hand = deck.slice(k, k + 4); k += 4;
      }
      st.remainingDeck = deck.slice(k);

      const order = [];
      for (let i = 0; i < st.players.length; i++) {
        const idx = (st.startIdx + i) % st.players.length;
        if (st.players[idx].suspendedFor === 0) order.push(idx);
      }
      st.auction = {
        order: order, turnPos: 0, passNo: 1, maxPasses: 3,
        highest: 0, leaderId: null, raisedInPass: false, acted: {},
        history: []
      };
      this.emit('deal', { round: st.round, decks: st.deckCount, start: st.startIdx });

      const needsPrivacy = st.players.some(p => p.type === 'human' && p.suspendedFor === 0 && !p.peer && !st.privacySeen.includes(p.seat));
      st.phase = needsPrivacy ? 'privacy' : 'auction';
      this.emit('phase', { phase: st.phase });
      return st;
    }

    /* ------------------------- المشغّل / الدور ------------------------- */
    currentActor() {
      const st = this.state;
      if (!st) return null;
      if (st.phase === 'auction') {
        const a = st.auction;
        for (let i = 0; i < a.order.length; i++) {
          const pos = (a.turnPos + i) % a.order.length;
          const seat = a.order[pos];
          const p = st.players[seat];
          if (!p.folded && !a.acted[seat]) return p;
        }
        return null;
      }
      if (st.phase === 'supervisor' || st.phase === 'offers' || st.phase === 'counters') return st.players[st.supervisorId];
      if (st.phase === 'negotiation') {
        const pending = this.pendingResponses();
        return pending.length ? st.players[pending[0]] : null;
      }
      if (st.phase === 'privacy') {
        const unseen = st.players.filter(p => p.type === 'human' && p.suspendedFor === 0 && !st.privacySeen.includes(p.seat));
        return unseen.length ? unseen[0] : null;
      }
      return null;
    }
    pendingResponses() {
      const st = this.state;
      return st.players
        .filter(p => p.entry !== null && !p.folded && p.seat !== st.supervisorId && p.response === null)
        .map(p => p.seat);
    }
    entrants() {
      return this.state.players.filter(p => p.entry !== null && !p.folded);
    }
    humanSeats() {
      return this.state.players.filter(p => p.type === 'human').map(p => p.seat);
    }

    /* ----------------------------- الإرسال ---------------------------- */
    dispatch(action) {
      const st = this.state;
      if (!st || !action) return st;
      switch (action.type) {
        case 'privacy:ready': return this._privacy(action);
        case 'bid': return this._bid(action);
        case 'supervisor:choose': return this._supervisorChoose(action);
        case 'offers:submit': return this._offers(action);
        case 'negotiate:respond': return this._respond(action);
        case 'counter:decide': return this._counter(action);
        case 'negotiation:timeout': return this._timeout();
        case 'chat': return this._chat(action);
        case 'emoji': return this._emoji(action);
        case 'next': return this._next();
        case 'endMatch': return this._endMatch();
        default: return st;
      }
    }

    _privacy(action) {
      const st = this.state;
      if (st.phase !== 'privacy') return st;
      const seat = intAmount(action.seat);
      if (!st.privacySeen.includes(seat)) st.privacySeen.push(seat);
      const remaining = st.players.filter(p => p.type === 'human' && p.suspendedFor === 0 && !st.privacySeen.includes(p.seat));
      if (!remaining.length) {
        st.phase = 'auction';
        this.emit('phase', { phase: 'auction' });
        this.emit('log', { text: 'بدأ السوق! من يجرؤ على الدخول؟', tone: 'gold' });
      }
      return st;
    }

    _bid(action) {
      const st = this.state, a = st.auction;
      if (st.phase !== 'auction') return st;
      const actor = this.currentActor();
      if (!actor || actor.seat !== intAmount(action.seat)) return st;
      const p = actor;
      const kind = action.kind || 'enter';

      if (kind === 'fold') {
        p.folded = true; p.entry = null;
        a.acted[p.seat] = true;
        a.history.push({ seat: p.seat, kind: 'fold', amount: 0 });
        this.emit('bid', { seat: p.seat, kind: 'fold', amount: 0, text: p.name + ' انسحب من السوق' });
      } else if (kind === 'pass') {
        a.acted[p.seat] = true;
        a.history.push({ seat: p.seat, kind: 'pass', amount: p.entry || 0 });
        this.emit('bid', { seat: p.seat, kind: 'pass', amount: p.entry || 0, text: p.name + ' ثبّت على مكانه' });
      } else {
        let amount = intAmount(action.amount);
        amount = Math.min(amount, p.balance);            // لا يجوز الدخول بأكثر من الرصيد
        p.entry = amount;
        p.folded = false;
        a.acted[p.seat] = true;
        if (amount > a.highest || (a.leaderId === null && amount >= 0 && a.history.length === 0)) {
          a.highest = amount; a.leaderId = p.seat; a.raisedInPass = true;
        }
        a.history.push({ seat: p.seat, kind: 'enter', amount: amount });
        this.emit('bid', {
          seat: p.seat, kind: 'enter', amount: amount,
          text: p.name + ' دخل السوق بـ ' + fmt(amount)
        });
      }
      this._advanceAuction();
      return st;
    }

    _advanceAuction() {
      const st = this.state, a = st.auction;
      let found = -1;
      for (let i = 1; i <= a.order.length; i++) {
        const pos = (a.turnPos + i) % a.order.length;
        const seat = a.order[pos];
        const p = st.players[seat];
        if (!p.folded && !a.acted[seat]) { found = pos; break; }
      }
      // البحث يبدأ من التالي، لكن إن كان كل من بعده قد لعب نعود للأول
      if (found === -1) {
        for (let pos = 0; pos < a.order.length; pos++) {
          const seat = a.order[pos];
          if (!st.players[seat].folded && !a.acted[seat]) { found = pos; break; }
        }
      }
      if (found !== -1) { a.turnPos = found; return; }

      // انتهت الدورة
      if (a.raisedInPass && a.passNo < a.maxPasses) {
        a.passNo += 1; a.acted = {}; a.raisedInPass = false; a.turnPos = 0;
        this.emit('log', { text: 'دورة مزايدة جديدة: من يرفع؟', tone: 'cyan' });
        return;
      }
      this._closeAuction();
    }

    _closeAuction() {
      const st = this.state, a = st.auction;
      const ent = this.entrants();
      if (!ent.length) {
        st.result = { void: true, title: 'جولة فارغة', lines: [], winnerId: null, settlements: [] };
        st.phase = 'result';
        this.emit('phase', { phase: 'result' });
        this.emit('void', { text: 'لم يدخل أحد السوق.. تُعاد الجولة دون خسائر' });
        return;
      }
      // أعلى مبلغ دخول = المشرّف (التعادل يُحسم للأسبق في ترتيب الدور)
      let sup = ent.slice().sort((x, y) =>
        (y.entry - x.entry) || (a.order.indexOf(x.seat) - a.order.indexOf(y.seat)))[0];
      st.supervisorId = sup.seat;
      st.phase = 'supervisor';
      this.emit('phase', { phase: 'supervisor' });
      this.emit('supervisor', { seat: sup.seat, amount: sup.entry, text: sup.name + ' أصبح المشرّف بـ ' + fmt(sup.entry) });
    }

    _supervisorChoose(action) {
      const st = this.state;
      if (st.phase !== 'supervisor' || action.seat !== st.supervisorId) return st;
      const sup = st.players[st.supervisorId];
      if (action.mode === 'fix') {
        this.emit('log', { text: sup.name + ' اختار «الكل مثبت» — كشف الأوراق!', tone: 'red' });
        this._resolve([]);
      } else {
        st.phase = 'offers';
        this.emit('phase', { phase: 'offers' });
        this.emit('log', { text: sup.name + ' فتح باب الانسحاب والتفاوض', tone: 'cyan' });
      }
      return st;
    }

    _offers(action) {
      const st = this.state;
      if (st.phase !== 'offers' || action.seat !== st.supervisorId) return st;
      const sup = st.players[st.supervisorId];
      const budget = Math.max(0, sup.entry || 0);   // من إجمالي ما دخل به (قد يكون 0)
      const offers = {};
      let total = 0;
      for (const p of this.entrants()) {
        if (p.seat === st.supervisorId) continue;
        let v = intAmount((action.offers || {})[p.seat]);
        if (total + v > budget) v = Math.max(0, budget - total);
        offers[p.seat] = v; total += v;
      }
      st.offers = offers;
      st.phase = 'negotiation';
      const sec = intAmount(st.settings.negotiationSec);
      st.negotiationEndsAt = sec > 0 ? this.now() + sec * 1000 : 0;   // 0 = مفتوح
      st.stats.negotiations += 1;
      st.negotiationThisRound = true;
      this.emit('phase', { phase: 'negotiation', endsAt: st.negotiationEndsAt });
      this.emit('offers', { offers: offers, total: total, text: 'عروض الانسحاب: ' + fmt(total) + ' من أصل ' + fmt(budget) });
      return st;
    }

    _respond(action) {
      const st = this.state;
      if (st.phase !== 'negotiation') return st;
      const seat = intAmount(action.seat);
      const p = st.players[seat];
      if (!p || p.entry === null || p.folded || seat === st.supervisorId || p.response !== null) return st;
      const choice = action.choice || 'reject';
      p.response = choice;
      p.counter = choice === 'counter' ? intAmount(action.amount) : null;
      if (choice === 'accept') {
        p.withdrawal = { accepted: true, amount: intAmount(st.offers[seat]) };
      } else if (choice === 'counter') {
        p.withdrawal = null;
      } else {
        p.withdrawal = null;  // رفض / إصرار على الكشف
      }
      const words = { accept: 'قبل العرض وانسحب', reject: 'رفض العرض', counter: 'فاوض على ' + fmt(p.counter || 0), insist: 'أصرّ على الرفض وطلب كشف الأوراق' };
      this.emit('respond', { seat: seat, choice: choice, amount: p.counter || 0, text: p.name + ' ' + words[choice] });
      this._afterResponses();
      return st;
    }

    _afterResponses() {
      const st = this.state;
      if (this.pendingResponses().length) return;
      const counters = this.entrants().filter(p => p.response === 'counter');
      if (counters.length) {
        st.phase = 'counters';
        st.counterPending = counters.map(p => p.seat);
        this.emit('phase', { phase: 'counters' });
      } else {
        this._resolve([]);
      }
    }

    _counter(action) {
      const st = this.state;
      if (st.phase !== 'counters') return st;
      const seat = action.target !== undefined ? intAmount(action.target) : intAmount(action.seat);
      if (!st.counterPending || !st.counterPending.includes(seat)) return st;
      const p = st.players[seat];
      if (action.accept) {
        p.withdrawal = { accepted: true, amount: p.counter || 0 };
        p.response = 'accept';
        this.emit('respond', { seat: seat, choice: 'counterAccepted', amount: p.counter || 0, text: p.name + ' قَبِل التفاوض بـ ' + fmt(p.counter || 0) });
      } else {
        this.emit('respond', { seat: seat, choice: 'counterRejected', amount: p.counter || 0, text: 'المشرّف رفض تفاوض ' + p.name });
      }
      st.counterPending = st.counterPending.filter(s => s !== seat);
      if (!st.counterPending.length) this._resolve([]);
      return st;
    }

    _timeout() {
      const st = this.state;
      if (st.phase !== 'negotiation') return st;
      let any = false;
      for (const seat of this.pendingResponses()) {
        const p = st.players[seat];
        p.response = 'insist'; p.withdrawal = null; any = true;
        this.emit('respond', { seat: seat, choice: 'timeout', text: 'انتهى الوقت! ' + p.name + ' يُعتبر مُصرّاً على كشف الأوراق' });
      }
      if (any) this.emit('log', { text: '⏱ انتهى وقت التفاوض', tone: 'red' });
      this._afterResponses();
      return st;
    }

    /* ---------------------- الحسم والتسوية المالية ---------------------- */
    _resolve() {
      const st = this.state;
      const ent = this.entrants();
      const withdrawn = ent.filter(p => p.withdrawal && p.withdrawal.accepted);
      const contenders = ent.filter(p => !(p.withdrawal && p.withdrawal.accepted));
      const evals = {};

      let winner = null, tieInfo = null, byReveal = true;
      if (!contenders.length) {
        winner = st.players[st.supervisorId];
        byReveal = false;
      } else if (contenders.length === 1) {
        winner = contenders[0];
        byReveal = false;
      } else {
        // المفارشة: كشف أوراق الباقين فقط
        for (const p of contenders) evals[p.seat] = evalHand(p.hand);
        const sorted = contenders.slice().sort((a, b) => {
          const c = compareEval(evals[b.seat], evals[a.seat]);
          if (c !== 0) return c;
          // حسم التعادل التام: أعلى مبلغ دخول ثم ترتيب المقعد
          return (b.entry - a.entry) || (a.seat - b.seat);
        });
        winner = sorted[0];
        if (sorted.length > 1 && compareEval(evals[winner.seat], evals[sorted[1].seat]) === 0) {
          tieInfo = 'تعادل تام حُسم لصالح صاحب الدخول الأعلى ثم المقعد الأسبق';
        }
      }
      for (const p of contenders) { p.revealed = byReveal; }
      st.revealedSeats = contenders.map(p => p.seat);

      /* التسوية:
         • كل خاسر (ممن بقي في المفارشة) يخسر المبلغ الذي دخل به فقط.
         • الفائز يربح فقط المبلغ الذي دخل به هو (لا مجموع الخاسرين).
         • المنسحب بعرض: لا يخسر ولا يربح إلا إن فاز المشرّف → يُعطى عرضه ويُخصم من المشرّف.
      */
      const before = {};
      for (const p of st.players) before[p.seat] = p.balance;

      const losers = ent.filter(p => p.seat !== winner.seat && !(p.withdrawal && p.withdrawal.accepted));
      const settlements = [];
      let winnerGain = losers.length ? (winner.entry || 0) : 0;

      for (const p of losers) {
        const loss = Math.min(p.entry || 0, p.balance);
        p.balance -= loss;
        p.stats.losses += 1;
        p.stats.biggestLoss = Math.max(p.stats.biggestLoss, loss);
        p.stats.streak = 0;
        settlements.push({ seat: p.seat, name: p.name, delta: -loss, note: 'خسر مبلغ دخوله' });
      }
      winner.balance += winnerGain;
      if (winnerGain > 0) {
        winner.stats.wins += 1;
        winner.stats.biggestWin = Math.max(winner.stats.biggestWin, winnerGain);
        winner.stats.streak += 1;
        settlements.push({ seat: winner.seat, name: winner.name, delta: winnerGain, note: 'ربح مبلغ دخوله فقط' });
      }

      const supWon = winner.seat === st.supervisorId;
      let offersPaid = 0;
      for (const p of withdrawn) {
        const amount = supWon ? (p.withdrawal.amount || 0) : 0;
        if (supWon && amount > 0) {
          p.balance += amount;
          winner.balance = Math.max(0, winner.balance - amount);
          offersPaid += amount;
          settlements.push({ seat: p.seat, name: p.name, delta: amount, note: 'عرض انسحاب دفعه المشرّف الفائز' });
        } else {
          settlements.push({ seat: p.seat, name: p.name, delta: 0, note: supWon ? 'عرض بلا مقابل (0)' : 'خسر المشرّف → لا ربح ولا خسارة' });
        }
      }

      // إحصاءات «الإطاحة بالهوامير»
      let whaleTakedowns = 0;
      for (const p of losers) {
        const loss = (p.entry || 0);
        if (loss >= 5000 && before[p.seat] >= Math.max(2 * before[winner.seat], 20000)) {
          whaleTakedowns += 1;
          winner.stats.whaleTakedowns += 1;
          st.bustOrder.push({ round: st.round, whale: p.name, by: winner.name, amount: loss });
        }
      }
      st.stats.whaleTakedowns += whaleTakedowns;
      st.stats.biggestWin = Math.max(st.stats.biggestWin, winnerGain);
      st.stats.biggestLoss = Math.max(st.stats.biggestLoss, ...losers.map(p => p.entry || 0), 0);

      if (!st.negotiationThisRound && winner.seat === st.supervisorId) winner.stats.fixWins += 1;
      if (supWon && st.negotiationThisRound) winner.stats.negotiatedWins += 1;

      /* الرحمة (مرة واحدة) ثم الإيقاف 3 جولات */
      const mercySeats = [], suspendedSeats = [];
      for (const p of st.players) {
        if (p.balance > 0) continue;
        if (!p.mercyUsed) {
          p.balance = 5000; p.mercyUsed = true;
          p.stats.mercy += 1; st.stats.mercy += 1;
          mercySeats.push(p.seat);
          settlements.push({ seat: p.seat, name: p.name, delta: 5000, note: 'رحمة (مرة واحدة في المباراة)' });
        } else {
          p.suspendedFor = 3;
          p.suspensionSetRound = st.round;
          p.stats.suspensions += 1; st.stats.suspensions += 1;
          suspendedSeats.push(p.seat);
          settlements.push({ seat: p.seat, name: p.name, delta: 0, note: 'إيقاف 3 جولات' });
        }
      }
      for (const seat of mercySeats) this.emit('mercy', { seat: seat, text: st.players[seat].name + ' حصل على 5,000 رحمة' });
      for (const seat of suspendedSeats) this.emit('suspend', { seat: seat, text: st.players[seat].name + ' موقوف 3 جولات' });

      st.result = {
        void: false,
        winnerId: winner.seat, winnerName: winner.name,
        supervisorId: st.supervisorId, supWon: supWon,
        byReveal: byReveal, tieInfo: tieInfo,
        evaluations: evals, contenders: contenders.map(p => p.seat),
        withdrawn: withdrawn.map(p => p.seat),
        settlements: settlements, winnerGain: winnerGain,
        offersPaid: offersPaid, whaleTakedowns: whaleTakedowns,
        mercySeats: mercySeats, suspendedSeats: suspendedSeats,
        before: before,
        totals: ent.reduce((s, p) => s + (p.entry || 0), 0),
        lines: settlements.map(x => x.name + ' ' + (x.delta >= 0 ? '+' : '−') + fmt(Math.abs(x.delta)) + ' · ' + x.note)
      };
      st.phase = 'result';
      this.emit('phase', { phase: 'result' });
      this.emit('roundEnd', {
        result: st.result, round: st.round,
        text: '🏆 ' + winner.name + ' فاز بالجولة ' + st.round
      });
      this.emit('winner', { seat: winner.seat, amount: winnerGain });
      return st;
    }

    /* ----------------------------- الجولة التالية --------------------- */
    _next() {
      const st = this.state;
      if (st.phase !== 'result') return st;
      if (st.round >= st.settings.maxRounds) return this._endMatch();
      for (const p of st.players) {
        // الجولة التي صدر فيها الإيقاف لا تُحتسب من الثلاث
        if (p.suspendedFor > 0 && p.suspensionSetRound !== st.round) p.suspendedFor -= 1;
      }
      st.startIdx = (st.startIdx + 1) % st.players.length;   // بالترتيب في الجولات التالية
      return this.newRound();
    }

    _endMatch() {
      const st = this.state;
      const ranking = st.players.slice().sort((a, b) => b.balance - a.balance).map((p, i) => ({
        rank: i + 1, seat: p.seat, name: p.name, balance: p.balance,
        wins: p.stats.wins, mercy: p.stats.mercy, suspensions: p.stats.suspensions
      }));
      st.matchSummary = {
        id: st.id, date: this.now(), rounds: st.round, ranking: ranking,
        winner: ranking[0] ? ranking[0].name : '—',
        mySeat: 0,
        biggestWin: st.stats.biggestWin, biggestLoss: st.stats.biggestLoss,
        whaleTakedowns: st.stats.whaleTakedowns,
        mercy: st.stats.mercy, suspensions: st.stats.suspensions,
        players: st.players.length, startBalance: st.settings.startBalance
      };
      st.phase = 'matchEnd';
      this.emit('phase', { phase: 'matchEnd' });
      this.emit('matchEnd', { summary: st.matchSummary });
      return st;
    }

    /* ------------------------- الدردشة والإيموجي ---------------------- */
    _chat(action) {
      const st = this.state;
      const seat = action.seat === undefined || action.seat === null ? 0 : intAmount(action.seat);
      const p = st.players[seat] || { name: action.name || 'ضيف', avatar: '👤' };
      const msg = {
        id: uid('m'), seat: seat, name: action.name || p.name, avatar: action.avatar || p.avatar,
        text: String(action.text || '').slice(0, 220), at: this.now(), bot: !!action.bot
      };
      st.chat.push(msg);
      if (st.chat.length > 120) st.chat.shift();
      this.emit('chat', { message: msg });
      return st;
    }
    _emoji(action) {
      const st = this.state;
      const seat = intAmount(action.seat);
      const p = st.players[seat];
      const emoji = String(action.emoji || '🔥').slice(0, 8);
      this.emit('emoji', { seat: seat, emoji: emoji, name: p ? p.name : '' });
      return st;
    }

    /* ======================= ذكاء البوتات ============================== */
    personalityOf(p) {
      return PERSONALITIES.find(x => x.id === p.personality) || PERSONALITIES[0];
    }
    difficultyOf(p) {
      return DIFFICULTIES.find(x => x.id === p.difficulty) || DIFFICULTIES[2];
    }

    /** تقدير قوة أيدي الخصوم عبر أخذ عينات من الأوراق المتبقية */
    estimateField(p) {
      const st = this.state;
      const diff = this.difficultyOf(p);
      if (diff.skill < 0.6) return 0.5;
      const used = {};
      for (const c of p.hand) used[c.id] = true;
      const pool = (st.remainingDeck || []).filter(c => !used[c.id]);
      if (pool.length < 8) return 0.5;
      let total = 0, n = 0;
      const samples = Math.round(4 + diff.skill * 14);
      for (let i = 0; i < samples; i++) {
        const hand = [];
        const local = pool.slice();
        for (let k = 0; k < 4; k++) {
          const idx = Math.floor(this.rng() * local.length);
          hand.push(local.splice(idx, 1)[0]);
        }
        total += evalHand(hand).score; n++;
      }
      return n ? total / n : 0.5;
    }

    botAction(seat) {
      const st = this.state;
      const p = st.players[seat];
      if (!p || p.type !== 'bot') return null;
      const per = this.personalityOf(p);
      const diff = this.difficultyOf(p);
      const rng = this.rng;
      const hand = evalHand(p.hand);
      const field = this.estimateField(p);
      const strength = clamp(hand.score * diff.skill + field * (1 - diff.skill) * 0.5 + (rng() - 0.5) * diff.noise * 0.6, 0, 1);
      const balance = p.balance;

      if (st.phase === 'privacy') return { type: 'privacy:ready', seat: seat };

      if (st.phase === 'auction') {
        const a = st.auction;
        const bluffing = rng() < per.bluff * (1.15 - hand.score);
        const targetWhale = st.players.some(q => q.seat !== seat && q.entry !== null && q.balance >= balance * 1.8 && q.entry >= 10000);
        let ratio = 0.02 + Math.pow(strength, 1.6) * (0.10 + per.aggression * 0.22);
        if (bluffing) ratio = Math.max(ratio, 0.10 + rng() * 0.22);
        if (targetWhale && rng() < 0.35 + diff.skill * 0.4 && per.aggression > 0.5) ratio = Math.max(ratio, 0.16 + rng() * 0.2);
        ratio *= (0.75 + rng() * 0.5);
        let amount = roundTo(balance * ratio, 500);
        amount = Math.min(amount, balance);

        // لا حد أدنى للرفع: +1 عملة تكفي لانتزاع الصدارة
        if (a.leaderId !== null && a.leaderId !== seat && amount <= a.highest) {
          const wantLead = strength > 0.55 || bluffing || (targetWhale && rng() < 0.5);
          if (wantLead && a.highest + 1 <= balance) {
            amount = Math.min(balance, a.highest + Math.max(1, roundTo(balance * 0.01, 100)));
          }
        }
        if (a.leaderId === seat && a.passNo > 1 && rng() > 0.25) return { type: 'bid', seat: seat, kind: 'pass' };

        const weakFold = hand.score < 0.28 && a.highest > balance * 0.18 && !bluffing && rng() < (0.55 + per.aggression * -0.3);
        if (weakFold && p.entry === null) return { type: 'bid', seat: seat, kind: 'fold' };
        if (p.entry !== null && a.passNo > 1 && strength < 0.4 && rng() < 0.4) return { type: 'bid', seat: seat, kind: 'pass' };
        if (amount === 0 && p.entry === null && rng() < 0.25) return { type: 'bid', seat: seat, kind: 'pass' };
        return { type: 'bid', seat: seat, kind: 'enter', amount: amount };
      }

      if (st.phase === 'supervisor') {
        const strong = hand.score >= (0.55 - diff.skill * 0.12);
        const bluff = rng() < per.bluff * 0.6;
        if (strong || (bluff && strength > 0.45) || this.entrants().length === 1) {
          return { type: 'supervisor:choose', seat: seat, mode: 'fix' };
        }
        return { type: 'supervisor:choose', seat: seat, mode: 'negotiate' };
      }

      if (st.phase === 'offers') {
        const budget = Math.max(0, p.entry || 0);
        const others = this.entrants().filter(q => q.seat !== seat);
        const offers = {};
        // المشرّف الضعيف يشتري الانسحابات، والقوي يحتفظ بالمال
        const generous = clamp(0.25 + (1 - hand.score) * 0.6 + per.greed * 0.15, 0.1, 0.95);
        let left = Math.floor(budget * generous);
        for (let i = 0; i < others.length; i++) {
          const q = others[i];
          const share = Math.floor(left / (others.length - i));
          const v = Math.max(0, Math.min(share, left));
          offers[q.seat] = v; left -= v;
        }
        return { type: 'offers:submit', seat: seat, offers: offers };
      }

      if (st.phase === 'negotiation') {
        const offer = intAmount(st.offers[seat]);
        const fair = balance > 0 ? offer / Math.max(1000, p.entry || 1000) : 0;
        const strong = hand.score >= 0.6;
        if (strong && rng() < 0.65 + diff.skill * 0.3) {
          return { type: 'negotiate:respond', seat: seat, choice: rng() < 0.35 ? 'insist' : 'reject' };
        }
        if (offer >= (p.entry || 0) * 0.5 || (fair > 0.35 && rng() < 0.6)) {
          return { type: 'negotiate:respond', seat: seat, choice: 'accept' };
        }
        if (rng() < 0.45 + diff.skill * 0.2) {
          const counter = Math.min(Math.max(offer * 2, roundTo((p.entry || 0) * 0.4, 500)), Math.max(offer, 1000) * 4);
          return { type: 'negotiate:respond', seat: seat, choice: 'counter', amount: counter };
        }
        return { type: 'negotiate:respond', seat: seat, choice: rng() < 0.5 ? 'reject' : 'insist' };
      }

      if (st.phase === 'counters') {
        const pending = st.counterPending || [];
        if (!pending.length) return null;
        const s = pending[0];
        const q = st.players[s];
        const asked = q.counter || 0;
        const budget = Math.max(0, p.entry || 0);
        const accept = hand.score < 0.5 && asked <= budget * 0.6 && rng() < 0.55 + diff.skill * 0.3;
        return { type: 'counter:decide', seat: seat, target: s, accept: accept };
      }
      return null;
    }

    /** ينفّذ كل أدوار البوتات المتاحة دفعة واحدة (للاختبارات) */
    autoPlayBots(limit) {
      limit = limit || 200;
      let n = 0;
      while (n++ < limit) {
        const st = this.state;
        if (st.phase === 'privacy') {
          const unseen = st.players.filter(p => p.type === 'human' && !st.privacySeen.includes(p.seat));
          if (unseen.length) break;               // يحتاج تسليم الجهاز
        }
        const actor = this.currentActor();
        if (!actor || actor.type !== 'bot') break;
        const act = this.botAction(actor.seat);
        if (!act) break;
        this.dispatch(act);
        if (this.state.phase === 'result' || this.state.phase === 'matchEnd') break;
      }
      return this.state;
    }
  }

  function fmt(n) {
    n = intAmount(n);
    const ar = '٠١٢٣٤٥٦٧٨٩';
    return n.toLocaleString('en-US').replace(/,/g, '٬').replace(/[0-9]/g, d => ar[+d]);
  }

  /* ------------- عرض آمن للاعب بعيد (إخفاء أوراق الآخرين) -------------- */
  /**
   * تُستخدم في اللعب عبر الشبكة: المضيف يرسل لكل لاعب نسخة مخفية
   * لا تحتوي أوراق الخصوم إلا بعد الكشف.
   */
  function maskFor(state, seat, youAre) {
    if (!state) return null;
    const copy = JSON.parse(JSON.stringify(state));
    const revealed = (state.revealedSeats || (state.result ? state.result.contenders : [])) || [];
    const showAll = state.phase === 'result' || state.phase === 'matchEnd';
    for (const p of copy.players) {
      if (p.seat === seat) continue;
      const canSee = showAll && revealed.includes(p.seat);
      if (!canSee) p.hand = p.hand && p.hand.length ? p.hand.map(() => ({ hidden: true })) : [];
    }
    copy.youAre = youAre === undefined ? seat : youAre;
    copy.remainingDeck = undefined;
    return copy;
  }

  /* ------------------------------ التصدير ------------------------------ */
  const API = {
    maskFor: maskFor,
    Game: Game, evalHand: evalHand, compareEval: compareEval, handStrengthText: handStrengthText,
    makeDecks: makeDecks, shuffle: shuffle, deckCountFor: deckCountFor, buildSeats: buildSeats,
    mulberry32: mulberry32, fmt: fmt, intAmount: intAmount, clamp: clamp,
    RANKS: RANKS, RANK_NAME: RANK_NAME, RANK_SHORT: RANK_SHORT, SUITS: SUITS, SUIT_NAME: SUIT_NAME,
    CATEGORY_NAME: CATEGORY_NAME, DIFFICULTIES: DIFFICULTIES, PERSONALITIES: PERSONALITIES,
    BOT_NAMES: BOT_NAMES, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    QUICK_PHRASES: QUICK_PHRASES, EMOJIS: EMOJIS
  };
  root.TijaraEngine = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
