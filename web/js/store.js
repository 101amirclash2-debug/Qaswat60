/* ==========================================================================
   تجارة — التخزين المحلي: الإعدادات، السجل، الإنجازات، الأصدقاء
   (localStorage فقط → يعمل دون إنترنت داخل WebView)
   ========================================================================== */
(function (root) {
  'use strict';
  const K = {
    settings: 'tijara.settings.v1',
    profile: 'tijara.profile.v1',
    history: 'tijara.history.v1',
    achievements: 'tijara.achievements.v1',
    friends: 'tijara.friends.v1',
    game: 'tijara.game.v1'
  };
  const T = root.TijaraEngine;

  const DEFAULT_SETTINGS = {
    myName: 'أنت',
    startBalance: 50000,
    negotiationSec: 15,          // 10 / 15 / 20 / 30 / 0 (مفتوح)
    players: 4,
    difficulty: 'normal',
    maxRounds: 20,
    fillWithBots: true,
    seats: null,
    sound: true, music: true, sfxVolume: 0.7, musicVolume: 0.22,
    vibration: true, effects: true,
    serverUrl: '',
    tableView: 'table'
  };

  const ZERO_PROFILE = {
    matches: 0, rounds: 0, wins: 0, losses: 0,
    biggestWin: 0, biggestLoss: 0, whaleTakedowns: 0,
    mercy: 0, suspensions: 0, fixWins: 0, negotiatedWins: 0,
    streakBest: 0, chatMessages: 0, emojis: 0, onlineRooms: 0,
    tenPlayerMatches: 0, zeroWins: 0, bluffWins: 0, fastResponses: 0,
    balance100k: 0, totalRounds: 0, totalProfit: 0
  };

  const ACHIEVEMENTS = [
    { id: 'whale', name: 'قاطع رؤوس الهوامير', cat: 'شجاعة', icon: '⚔️', desc: 'أطِح بلاعب رصيده يزيد عن ضعف رصيدك 3 مرات', key: 'whaleTakedowns', goal: 3 },
    { id: 'negotiator', name: 'ملك المفاوضات', cat: 'مهارة', icon: '🤝', desc: 'اربح 5 جولات عبر عرض الانسحاب والتفاوض', key: 'negotiatedWins', goal: 5 },
    { id: 'mercy', name: 'ناجي الرحمة', cat: 'صمود', icon: '🕊️', desc: 'احصل على الرحمة ثم اربح جولة لاحقاً', key: 'mercyComeback', goal: 1 },
    { id: 'fearless', name: 'ثبات بلا تردد', cat: 'شجاعة', icon: '🛡️', desc: 'اختر «الكل مثبت» واربح 4 جولات', key: 'fixWins', goal: 4 },
    { id: 'boss', name: 'زعيم الطاولة', cat: 'مهارة', icon: '👑', desc: 'اربح 3 جولات متتالية في مباراة واحدة', key: 'streakBest', goal: 3 },
    { id: 'bluff', name: 'تمويه متقن', cat: 'مهارة', icon: '🎭', desc: 'اربح بيد متفرقة بعد دخول كبير', key: 'bluffWins', goal: 2 },
    { id: 'zero', name: 'صفر مجيد', cat: 'شجاعة', icon: '🌀', desc: 'اربح جولة وأنت داخل السوق بصفر', key: 'zeroWins', goal: 1 },
    { id: 'bigwin', name: 'الإطاحة الكبرى', cat: 'شجاعة', icon: '💰', desc: 'اربح 25,000 في جولة واحدة', key: 'biggestWin', goal: 25000 },
    { id: 'table10', name: 'طاولة العشرة', cat: 'اجتماعية', icon: '🪑', desc: 'العب مباراة كاملة بـ 10 لاعبين', key: 'tenPlayerMatches', goal: 1 },
    { id: 'millionaire', name: 'صاحب الخزينة', cat: 'صمود', icon: '🤑', desc: 'اجعل رصيدك 100,000', key: 'balance100k', goal: 1 },
    { id: 'fast', name: 'سريع البديهة', cat: 'مهارة', icon: '⚡', desc: 'رد على التفاوض في أقل من 3 ثوانٍ 5 مرات', key: 'fastResponses', goal: 5 },
    { id: 'social', name: 'حديث الطاولة', cat: 'اجتماعية', icon: '💬', desc: 'أرسل 25 رسالة أو إيموجي', key: 'social', goal: 25 },
    { id: 'veteran', name: 'مخضرم السوق', cat: 'صمود', icon: '🏅', desc: 'العب 100 جولة', key: 'totalRounds', goal: 100 },
    { id: 'online', name: 'عابر الشبكات', cat: 'اجتماعية', icon: '📡', desc: 'انضم إلى 3 غرف أونلاين', key: 'onlineRooms', goal: 3 }
  ];

  function read(key, fallback) {
    try {
      const raw = root.localStorage && root.localStorage.getItem(key);
      if (!raw) return JSON.parse(JSON.stringify(fallback));
      return JSON.parse(raw);
    } catch (e) { return JSON.parse(JSON.stringify(fallback)); }
  }
  function write(key, val) {
    try { if (root.localStorage) root.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* مساحة ممتلئة */ }
    return val;
  }

  function settings() { return Object.assign({}, DEFAULT_SETTINGS, read(K.settings, DEFAULT_SETTINGS)); }
  function saveSettings(patch) { const s = Object.assign(settings(), patch); return write(K.settings, s); }
  function profile() { return Object.assign({}, ZERO_PROFILE, read(K.profile, ZERO_PROFILE)); }
  function saveProfile(p) { return write(K.profile, Object.assign({}, ZERO_PROFILE, p)); }
  function bumpProfile(patch) {
    const p = profile();
    for (const k in patch) p[k] = (p[k] || 0) + patch[k];
    return saveProfile(p);
  }
  function unlocked() { return read(K.achievements, {}); }
  function achievements() {
    const p = profile(), u = unlocked();
    return ACHIEVEMENTS.map(a => {
      const val = p[a.key] || 0;
      return Object.assign({}, a, {
        value: Math.min(val, a.goal),
        percent: Math.min(100, Math.round(val / a.goal * 100)),
        done: !!u[a.id] || val >= a.goal,
        at: u[a.id] || null
      });
    });
  }
  function checkAchievements() {
    const p = profile(), u = unlocked(), fresh = [];
    for (const a of ACHIEVEMENTS) {
      if (!u[a.id] && (p[a.key] || 0) >= a.goal) {
        u[a.id] = Date.now(); fresh.push(a);
      }
    }
    if (fresh.length) write(K.achievements, u);
    return fresh;
  }

  function history() { return read(K.history, []); }
  function addHistory(summary) {
    const list = history();
    list.unshift(summary);
    return write(K.history, list.slice(0, 60));
  }
  function saveGame(state) { return write(K.game, state); }
  function loadGame() { return read(K.game, null); }
  function clearGame() { try { root.localStorage && root.localStorage.removeItem(K.game); } catch (e) {} }
  function clearData() {
    for (const k of Object.values(K)) { try { root.localStorage && root.localStorage.removeItem(k); } catch (e) {} }
  }

  function friends() {
    return read(K.friends, { list: [], incoming: [], outgoing: [] });
  }
  function saveFriends(f) { return write(K.friends, f); }
  function addFriend(name, code) {
    const f = friends();
    const item = { id: 'f' + Date.now().toString(36), name: name, code: code || '', status: code ? 'pending' : 'friend', avatar: '🧑' };
    if (code) f.outgoing.push(item); else f.list.push(item);
    saveFriends(f); return item;
  }
  function acceptFriend(id) {
    const f = friends();
    const idx = f.incoming.findIndex(x => x.id === id);
    if (idx >= 0) { const it = f.incoming.splice(idx, 1)[0]; it.status = 'friend'; f.list.push(it); saveFriends(f); return it; }
    return null;
  }
  function removeFriend(id) {
    const f = friends();
    f.list = f.list.filter(x => x.id !== id);
    f.incoming = f.incoming.filter(x => x.id !== id);
    f.outgoing = f.outgoing.filter(x => x.id !== id);
    return saveFriends(f);
  }
  function demoRequests() {
    const f = friends();
    if (!f.incoming.length) {
      f.incoming = [
        { id: 'demo1', name: 'أبو تركي', code: 'TRK-77', status: 'pending', avatar: '🧔' },
        { id: 'demo2', name: 'سلطان', code: 'SLN-12', status: 'pending', avatar: '👳' }
      ];
      saveFriends(f);
    }
    return f;
  }

  /** تحديث الإحصاءات من أحداث الجولة؛ يُعيد الأوسمة المفتوحة حديثاً */
  function applyRound(state, events, mySeat, opts) {
    opts = opts || {};
    const p = profile();
    const r = state.result;
    p.rounds += 1; p.totalRounds += 1;
    if (r && !r.void) {
      const me = state.players[mySeat];
      if (me) {
        p.biggestWin = Math.max(p.biggestWin, me.stats.biggestWin || 0);
        p.biggestLoss = Math.max(p.biggestLoss, me.stats.biggestLoss || 0);
        p.streakBest = Math.max(p.streakBest, me.stats.streak || 0);
        if (me.balance >= 100000) p.balance100k = 1;
      }
      if (r.winnerId === mySeat) {
        p.wins += 1;
        p.totalProfit += r.winnerGain || 0;
        p.whaleTakedowns += r.whaleTakedowns || 0;
        if (r.supWon && state.negotiationThisRound) p.negotiatedWins += 1;
        if (!state.negotiationThisRound && r.supervisorId === mySeat) p.fixWins += 1;
        if ((state.players[mySeat].entry || 0) === 0) p.zeroWins += 1;
        const ev = r.evaluations && r.evaluations[mySeat];
        if (ev && ev.category <= 1 && (state.players[mySeat].entry || 0) >= 5000) p.bluffWins += 1;
        if (opts.mercyComeback) p.mercyComeback = (p.mercyComeback || 0) + 1;
      } else if (r.contenders && r.contenders.includes(mySeat)) {
        p.losses += 1;
      }
      p.mercy += (r.mercySeats || []).includes(mySeat) ? 1 : 0;
      p.suspensions += (r.suspendedSeats || []).includes(mySeat) ? 1 : 0;
    }
    // الرسائل والإيموجيات تُحتسب عند الإرسال مباشرة (sendChat / sendEmoji)
    p.social = (p.chatMessages || 0) + (p.emojis || 0);
    saveProfile(p);
    return checkAchievements();
  }

  function homeStats() {
    const p = profile(), a = achievements(), h = history();
    return {
      matches: p.matches, wins: p.wins, biggestWin: p.biggestWin,
      badges: a.filter(x => x.done).length, totalBadges: a.length,
      history: h.length, rounds: p.totalRounds
    };
  }

  root.TijaraStore = {
    K: K, DEFAULT_SETTINGS: DEFAULT_SETTINGS, ACHIEVEMENTS: ACHIEVEMENTS,
    settings: settings, saveSettings: saveSettings,
    profile: profile, saveProfile: saveProfile, bumpProfile: bumpProfile,
    achievements: achievements, checkAchievements: checkAchievements,
    history: history, addHistory: addHistory, homeStats: homeStats,
    saveGame: saveGame, loadGame: loadGame, clearGame: clearGame, clearData: clearData,
    friends: friends, saveFriends: saveFriends, addFriend: addFriend,
    acceptFriend: acceptFriend, removeFriend: removeFriend, demoRequests: demoRequests,
    applyRound: applyRound, read: read, write: write
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
