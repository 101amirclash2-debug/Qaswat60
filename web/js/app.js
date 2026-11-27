/* ==========================================================================
   تجارة — المتحكّم الرئيسي (التدفق، البوتات، المؤقتات، الشبكة، الحفظ)
   ========================================================================== */
(function (root) {
  'use strict';
  const doc = root.document;
  const T = root.TijaraEngine, S = root.TijaraStore, AU = root.TijaraAudio, FX = root.TijaraFX;
  const $ = id => doc.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const App = {
    /* --------------------------- الحالة العامة -------------------------- */
    settings: null, setupSeats: [], state: null, game: null, reader: null,
    screen: 'home', mode: 'local', mySeat: 0, visibleSeat: 0,
    localHumanSeats: [0], remoteSeats: new Set(), peerSeats: {},
    netChat: [], net: null, room: null, defaultServerUrl: '',
    privacy: { queue: [], current: null, shown: false },
    handoffSeat: null, lastViewer: -1, lastRemotePhase: '', lastCountedRound: -1,
    botTimer: null, offerStart: 0, forceActionRender: true,
    hadMercy: false, tickTimer: null,

    /* ------------------------------ التهيئة ---------------------------- */
    init() {
      this.settings = S.settings();
      this.net = TijaraNet.instance;
      this.defaultServerUrl = TijaraNet.defaultUrl() || 'ws://192.168.1.10:5173/ws';
      this.reader = new T.Game({ seed: 1 });
      this.setupSeats = this.buildSetupSeats(this.settings.players);
      AU.configure(this.settings);
      this.bindStatic();
      this.bindNetwork();
      TijaraUI.init(this);
      this.tickTimer = setInterval(() => this.tick(), 250);
      // المتصفح يعيد تشغيل الصوت بعد أول لمسة
      doc.addEventListener('pointerdown', () => AU.unlock(), { once: true });
    },
    bindStatic() {
      $('btn-start').addEventListener('click', () => this.startMatch(false));
      $('resume-bar').addEventListener('click', () => this.resume());
      $('btn-exit').addEventListener('click', () =>
        TijaraUI.openConfirm('الخروج من الطاولة؟ ستبقى المباراة محفوظة ويمكن متابعتها من الشاشة الرئيسية.', 'confirm:exit'));
      $('btn-table-view').addEventListener('click', () => {
        this.setSetting('tableView', this.settings.tableView === 'table' ? 'list' : 'table');
        TijaraUI.render(); AU.play('tap');
      });
      $('btn-chat-toggle').addEventListener('click', () => $('side-panel').classList.toggle('open'));
      $('btn-side-close').addEventListener('click', () => $('side-panel').classList.remove('open'));
      $('btn-send').addEventListener('click', () => this.sendChat());
      $('btn-mic').addEventListener('click', () => this.toggleMic());
      $('btn-clear-history').addEventListener('click', () =>
        TijaraUI.openConfirm('مسح تاريخ المباريات والأوسمة؟', 'confirm:clearhistory'));
    },

    /* --------------------------- الإعدادات والمقاعد -------------------- */
    buildSetupSeats(n) {
      n = T.clamp(Number(n) || 4, 2, 10);
      const saved = this.settings.seats;
      const base = T.buildSeats(n, { myName: this.settings.myName, difficulty: this.settings.difficulty });
      const out = [];
      for (let i = 0; i < n; i++) {
        const old = saved && saved[i];
        out.push(Object.assign({}, base[i], old || {}, {
          seat: i,
          name: old ? old.name : (i === 0 ? this.settings.myName : base[i].name),
          type: i === 0 ? 'human' : (old ? old.type : (this.settings.fillWithBots ? 'bot' : 'human')),
          difficulty: (old && old.difficulty) || this.settings.difficulty,
          peer: null
        }));
      }
      return out;
    },
    setSetting(key, val) {
      this.settings = S.saveSettings(Object.assign({}, this.settings, { [key]: val }));
      if (key === 'myName' && this.setupSeats[0]) this.setupSeats[0].name = val;
      if (key === 'fillWithBots') this.setupSeats = this.buildSetupSeats(this.settings.players);
      this.saveSetupSeats();
      if (key === 'sound' || key === 'music' || key === 'sfxVolume' || key === 'musicVolume') this.applyAudioSettings();
    },
    setPlayers(n) {
      n = T.clamp(Number(n) || 4, 2, 10);
      const old = this.setupSeats.slice();
      this.setSetting('players', n);
      const seats = [];
      for (let i = 0; i < n; i++) {
        seats.push(Object.assign({}, T.buildSeats(n, { myName: this.settings.myName, difficulty: this.settings.difficulty })[i], old[i] || {}, {
          seat: i,
          type: i === 0 ? 'human' : (old[i] ? old[i].type : (this.settings.fillWithBots ? 'bot' : 'human')),
          name: old[i] ? old[i].name : (i === 0 ? this.settings.myName : 'لاعب ' + (i + 1)),
          difficulty: (old[i] && old[i].difficulty) || this.settings.difficulty,
          peer: null
        }));
      }
      this.setupSeats = seats;
      this.saveSetupSeats();
    },
    setSeat(i, patch) {
      if (!this.setupSeats[i]) return;
      Object.assign(this.setupSeats[i], patch);
      this.saveSetupSeats();
    },
    toggleSeatType(i) {
      if (i === 0 || !this.setupSeats[i]) return;   // المقعد الأول دائماً للاعب
      const p = this.setupSeats[i];
      p.type = p.type === 'human' ? 'bot' : 'human';
      if (p.type === 'human') p.name = 'لاعب ' + (i + 1);
      this.saveSetupSeats();
    },
    applyDifficultyToSeats(d) {
      this.setupSeats.forEach(p => { if (p.type === 'bot') p.difficulty = d; });
      this.saveSetupSeats();
    },
    saveSetupSeats() {
      // ندمج الحالة الذاكرة كاملةً كي لا تُستبدل الإعدادات بنسخة قديمة من التخزين
      this.settings = S.saveSettings(Object.assign({}, this.settings, { seats: this.setupSeats }));
    },
    applyAudioSettings() {
      AU.configure(this.settings);
      if (this.settings.music) AU.startMusic(); else AU.stopMusic();
    },

    /* ----------------------------- بدء المباراة ----------------------- */
    quickStart() {
      this.setPlayers(4);
      this.setupSeats.forEach((p, i) => { if (i > 0) { p.type = 'bot'; p.difficulty = this.settings.difficulty; } });
      this.saveSetupSeats();
      this.startMatch(true);
    },
    startMatch(quick, opts) {
      opts = opts || {};
      const c = this.settings;
      let seats = opts.seats || this.setupSeats.slice(0, c.players);
      seats = seats.slice(0, 10).map((p, i) => Object.assign({}, p, {
        seat: i,
        type: i === 0 ? 'human' : p.type,
        name: p.name || ('لاعب ' + (i + 1)),
        difficulty: p.difficulty || c.difficulty,
        personality: p.personality || T.PERSONALITIES[i % T.PERSONALITIES.length].id,
        peer: p.peer || null
      }));
      if (seats.length < 2) seats.push(Object.assign({}, T.buildSeats(2)[1], { seat: 1, type: 'bot' }));

      this.netChat = [];
      this.mode = opts.hostMode ? 'host' : 'local';
      this.remoteSeats = opts.remoteSeats || new Set();
      this.peerSeats = opts.peerSeats || {};
      this.mySeat = 0; this.visibleSeat = 0; this.lastViewer = -1;
      this.handoffSeat = null; this.hadMercy = false;
      this.lastRemotePhase = ''; this.lastCountedRound = -1;
      this.localHumanSeats = seats.filter(p => p.type === 'human' && !this.remoteSeats.has(p.seat)).map(p => p.seat);
      if (!this.localHumanSeats.includes(0)) this.localHumanSeats.unshift(0);

      this.game = new T.Game({ seed: (Math.random() * 1e9) | 0 });
      this.game.start({
        seats: seats, startBalance: c.startBalance,
        negotiationSec: c.negotiationSec, maxRounds: c.maxRounds,
        sound: c.sound, music: c.music, vibration: c.vibration, effects: c.effects
      });
      this.state = this.game.state;
      this.flushEvents();
      S.bumpProfile({ matches: 1 });
      if (seats.length === 10) { S.bumpProfile({ tenPlayerMatches: 1 }); S.checkAchievements(); }
      this.persist();
      AU.play('start'); FX.confetti(40);
      TijaraUI.resetActionSig();
      TijaraUI.go('game');
      this.afterDispatch(true);
      if (quick) FX.toast('⚡ لعب سريع: 4 لاعبين · 3 بوتات', 'good');
    },
    resume() {
      const saved = S.loadGame();
      if (!saved || !saved.players) { TijaraUI.toast('لا توجد مباراة محفوظة', 'bad'); return; }
      this.game = new T.Game({ seed: 7 });
      this.game.state = saved; this.game.events = [];
      this.state = saved;
      this.mode = 'local'; this.mySeat = 0; this.visibleSeat = 0;
      this.remoteSeats = new Set(); this.peerSeats = {};
      this.localHumanSeats = saved.players.filter(p => p.type === 'human').map(p => p.seat);
      this.handoffSeat = null; this.lastViewer = -1; this.netChat = [];
      this.lastRemotePhase = ''; this.lastCountedRound = saved.round;
      this.hadMercy = !!saved.players[0] && saved.players[0].mercyUsed;
      this.persist();
      TijaraUI.resetActionSig();
      this.afterDispatch(true);
    },
    persist() {
      if (this.mode !== 'client' && this.state && this.state.phase !== 'matchEnd') {
        try { S.saveGame(this.state); } catch (e) { /* تجاهل */ }
      }
    },

    /* ---------------------- التدفق بعد كل إجراء ----------------------- */
    act(action) {
      if (!action) return;
      if (this.mode === 'client') { this.net.sendAction(action); return; }
      if (!this.game || !this.state) return;
      this.game.dispatch(action);
      this.afterDispatch();
    },
    afterDispatch(initial) {
      this.flushEvents();
      this.botChatter();
      this.persist();
      TijaraUI.render();
      if (initial) this.startPrivacyIfNeeded();
      this.maybeHandoff();
      this.scheduleBots();
      if (this.mode === 'host') this.broadcast();
    },
    flushEvents() {
      const events = this.game ? this.game.drainEvents() : [];
      this.handleEvents(events);
    },
    handleEvents(events) {
      const st = this.state;
      if (!st) return;
      if (!st.log) st.log = [];
      for (const e of events) {
        switch (e.kind) {
          case 'start': AU.play('start'); break;
          case 'deal': AU.play('deal'); break;
          case 'phase':
            if (e.phase === 'auction') { AU.play('chip'); FX.toast('🤑 افتُتح السوق'); }
            if (e.phase === 'supervisor') AU.play('supervisor');
            if (e.phase === 'counters') AU.play('offer');
            if (e.phase === 'negotiation') {
              this.offerStart = Date.now(); AU.play('offer');
              if (e.round > 1) FX.toast('🔁 جولة تفاوض ' + e.round + ' · عروض جديدة');
            }
            if (e.phase === 'result') AU.play('reveal');
            break;
          case 'log': st.log.push({ text: e.text, tone: e.tone, at: e.at }); if (st.log.length > 80) st.log.shift(); break;
          case 'bid':
            st.log.push({ text: e.text, tone: 'gold', at: e.at });
            AU.play(e.kind === 'fold' ? 'fold' : e.kind === 'pass' ? 'pass' : e.amount > (st.auction.highest || 0) ? 'raise' : 'bid');
            if (e.kind === 'enter' && e.amount >= 10000) FX.emojiAtSeat('🤑', e.seat);
            break;
          case 'supervisor': st.log.push({ text: e.text, tone: 'red', at: e.at }); FX.toast('👑 ' + e.text); FX.emojiAtSeat('👑', e.seat, true); break;
          case 'offers': st.log.push({ text: e.text, tone: 'cyan', at: e.at }); break;
          case 'reveal': FX.toast('🃏 فُرشت الأوراق وثُبّت المعاندون'); FX.shake(); break;
          case 'respond': st.log.push({ text: e.text, tone: 'cyan', at: e.at }); AU.play('tap'); break;
          case 'void': st.log.push({ text: e.text, tone: 'muted', at: e.at }); FX.toast(e.text); break;
          case 'chat': AU.play('chat'); break;
          case 'emoji': FX.emojiAtSeat(e.emoji, e.seat); AU.play('emoji'); break;
          case 'mercy': FX.toast('🕊️ ' + e.text, 'good'); AU.play('mercy'); this.hadMercy = true; break;
          case 'suspend': FX.toast('⛔ ' + e.text, 'bad'); AU.play('suspend'); FX.shake(); break;
          case 'winner':
            if (e.seat === this.mySeat) { AU.play('win'); FX.goldRain(); FX.flash(); }
            else AU.play('lose');
            break;
          case 'roundEnd': {
            const fresh = S.applyRound(st, events, this.mySeat, { mercyComeback: this.hadMercy && e.result && e.result.winnerId === this.mySeat });
            if (fresh.length) {
              FX.confetti(80); AU.play('achievement');
              fresh.forEach(a => FX.toast('🏅 فتحت وسام: ' + a.name, 'good'));
            }
            if (e.result && e.result.whaleTakedowns) { AU.play('whale'); FX.shake(); FX.toast('⚔️ إطاحة بالهوامير!', 'good'); }
            setTimeout(() => { if (this.screen === 'game' && this.state && this.state.phase === 'result') TijaraUI.openResult(); }, 420);
            break;
          }
          case 'matchEnd': {
            const m = e.summary;
            S.addHistory(m);
            const fresh = S.checkAchievements();
            FX.goldRain(); AU.play('achievement');
            setTimeout(() => { if (this.state && this.state.phase === 'matchEnd') { if (fresh.length) TijaraUI.openAchievements(fresh); else TijaraUI.openMatchEnd(); } }, 500);
            S.clearGame();
            break;
          }
        }
      }
      TijaraUI.renderChat();
    },
    botChatter() {
      const st = this.state;
      if (!st || this.mode === 'client' || !this.game) return;
      const events = this.game.events || [];
      // تُقرأ الأحداث قبل التفريغ: نعتمد على آخر حدث مسجّل في السجل
      const last = (this.lastBotEvent = this.lastBotEvent || null);
      const recent = st.log && st.log[st.log.length - 1];
      if (!recent || Math.random() > 0.28) return;
      const bot = st.players.find(p => p.type === 'bot' && p.balance > 0 && recent.text && recent.text.indexOf(p.name) === 0);
      if (!bot || bot.seat === this.lastChatterSeat) return;
      this.lastChatterSeat = bot.seat;
      const lines = T.QUICK_PHRASES;
      const text = lines[Math.floor(Math.random() * lines.length)];
      st.chat = st.chat || [];
      st.chat.push({ id: 'bc' + Date.now(), seat: bot.seat, name: bot.name, avatar: bot.avatar, text: text, at: Date.now(), bot: true });
      if (st.chat.length > 120) st.chat.shift();
    },

    /* ------------------------------ البوتات --------------------------- */
    scheduleBots() {
      clearTimeout(this.botTimer);
      if (this.mode === 'client' || !this.game || !this.state) return;
      const st = this.state;
      if (this.handoffSeat !== null) return;
      if (['privacy', 'result', 'matchEnd'].includes(st.phase)) return;
      const actor = this.game.currentActor();
      if (!actor || actor.type !== 'bot') return;
      const delay = 520 + Math.random() * 620;
      this.botTimer = setTimeout(() => {
        if (!this.game || this.mode === 'client' || this.handoffSeat !== null) return;
        const a = this.game.currentActor();
        if (!a || a.type !== 'bot') return;
        const action = this.game.botAction(a.seat);
        if (action) { this.game.dispatch(action); this.afterDispatch(); }
      }, delay);
    },
    skipBot() {
      clearTimeout(this.botTimer);
      if (!this.game || this.mode === 'client') return;
      let guard = 0;
      while (guard++ < 40) {
        const st = this.state;
        if (['result', 'matchEnd', 'privacy'].includes(st.phase)) break;
        const a = this.game.currentActor();
        if (!a || a.type !== 'bot') break;
        const action = this.game.botAction(a.seat);
        if (!action) break;
        this.game.dispatch(action);
        this.flushEvents();
      }
      this.afterDispatch();
    },

    /* --------------------------- خصوصية الأوراق ---------------------- */
    startPrivacyIfNeeded() {
      const st = this.state;
      if (!st || st.phase !== 'privacy') return;
      const queue = this.localHumanSeats.filter(s => st.players[s] && st.players[s].type === 'human' &&
        st.players[s].suspendedFor === 0 && !st.privacySeen.includes(s));
      this.privacy = { queue: queue, current: null, shown: false };
      this.nextPrivacy();
    },
    nextPrivacy() {
      if (!this.privacy.queue.length) { TijaraUI.closeModal(); return; }
      this.privacy.current = this.privacy.queue.shift();
      this.privacy.shown = false;
      this.visibleSeat = this.privacy.current;
      TijaraUI.openPrivacy(this.privacy.current, false);
    },
    privacyStart() { this.startPrivacyIfNeeded(); },
    privacyShow() {
      this.privacy.shown = true;
      AU.play('flip');
      TijaraUI.openPrivacy(this.privacy.current, true);
    },
    privacyHide() {
      const seat = this.privacy.current;
      this.privacy.shown = false;
      this.act({ type: 'privacy:ready', seat: seat });
      if (this.state.phase === 'privacy') this.nextPrivacy();
      else TijaraUI.closeModal();
    },
    maybeHandoff() {
      if (this.mode !== 'local' || this.localHumanSeats.length < 2) return;
      const st = this.state;
      if (!['auction', 'negotiation', 'offers', 'supervisor', 'counters'].includes(st.phase)) return;
      const seat = this.currentActorSeat();
      if (seat === null || seat === undefined) return;
      const p = st.players[seat];
      if (!p || p.type !== 'human' || !this.localHumanSeats.includes(seat)) return;
      if (this.lastViewer === seat) return;
      this.handoffSeat = seat;
      TijaraUI.openHandoff(seat);
    },
    handoffDone() {
      const seat = this.handoffSeat;
      this.handoffSeat = null;
      this.lastViewer = seat;
      this.visibleSeat = seat === null ? this.mySeat : seat;
      TijaraUI.closeModal();
      TijaraUI.render();
      this.scheduleBots();
    },
    handoffNeeded() { return this.handoffSeat !== null; },

    /* -------------------------- استعلامات العرض ----------------------- */
    currentActorSeat() {
      if (!this.state) return null;
      const g = (this.mode === 'client') ? this.reader : this.game;
      if (!g) return null;
      if (this.mode === 'client') g.state = this.state;
      const a = g.currentActor();
      return a ? a.seat : null;
    },
    isLocalSeat(seat) {
      if (!this.state || seat === null || seat === undefined) return false;
      const p = this.state.players[seat];
      if (!p || p.type !== 'human') return false;
      if (this.mode === 'client') return seat === this.mySeat;
      if (this.mode === 'host') return !this.remoteSeats.has(seat);
      return this.localHumanSeats.includes(seat);
    },
    canSeeHand(seat) {
      const st = this.state;
      if (!st) return false;
      if (this.mode === 'client') return seat === this.mySeat;
      if (st.phase === 'result' && (st.revealedSeats || []).includes(seat)) return true;
      if (st.phase === 'privacy') return this.privacy.shown && this.privacy.current === seat;
      if (this.handoffSeat !== null) return false;
      return this.visibleSeat === seat;
    },
    setViewer(seat) { this.visibleSeat = seat; },

    /* --------------------------- الإجراءات الخاصة --------------------- */
    respond(seat, choice, amount) {
      const fast = Date.now() - this.offerStart < 3000;
      if (fast && seat === this.mySeat) { S.bumpProfile({ fastResponses: 1 }); S.checkAchievements(); }
      this.act({ type: 'negotiate:respond', seat: seat, choice: choice, amount: amount || 0 });
    },
    forceTimeout() { this.act({ type: 'negotiation:timeout' }); },
    tick() {
      if (!this.state) return;
      if (this.screen === 'game') TijaraUI.updateTimer();
      const st = this.state;
      if (st.phase === 'negotiation' && st.negotiationEndsAt > 0 && Date.now() > st.negotiationEndsAt && this.mode !== 'client') {
        st.negotiationEndsAt = 0;   // يمنع التكرار
        this.act({ type: 'negotiation:timeout' });
      }
    },

    /* ---------------------- الدردشة والإيموجي والمايك ----------------- */
    sendChat(text) {
      const input = $('chat-text');
      const t = (text || (input && input.value) || '').trim().slice(0, 220);
      if (!t || !this.state) return;
      if (input && !text) input.value = '';
      const p = this.state.players[this.mySeat] || { name: this.settings.myName, avatar: '🧔' };
      AU.play('chat');
      if (this.mode !== 'local') this.net.sendChat(t, this.mySeat, p.name, p.avatar);
      else {
        this.game.dispatch({ type: 'chat', seat: this.mySeat, text: t });
        this.flushEvents();
      }
      S.bumpProfile({ chatMessages: 1 }); S.checkAchievements();
      TijaraUI.renderChat();
    },
    sendEmoji(emoji) {
      if (!emoji || !this.state) return;
      const p = this.state.players[this.mySeat] || { name: this.settings.myName };
      AU.play('emoji');
      FX.emojiAtSeat(emoji, this.mySeat, true);
      // فقاعة إيموجي متحركة داخل سجل الدردشة أيضاً (في الوضع المحلي يتولاها المحرّك)
      if (this.mode !== 'local' && this.state.chat) {
        this.state.chat.push({ id: 'e' + Date.now(), seat: this.mySeat, name: p.name || '',
          avatar: p.avatar || '👤', text: emoji, emoji: true, at: Date.now(), bot: false });
        if (this.state.chat.length > 120) this.state.chat.shift();
        TijaraUI.renderChat();
      }
      if (this.mode !== 'local') this.net.sendEmoji(emoji, this.mySeat, p.name);
      else { this.game.dispatch({ type: 'emoji', seat: this.mySeat, emoji: emoji }); this.flushEvents(); }
      S.bumpProfile({ emojis: 1 }); S.checkAchievements();
    },
    async toggleMic() {
      const btn = $('btn-mic'), status = $('voice-status');
      if (this.net.voice.enabled) {
        this.net.disableMic();
        btn.classList.remove('on'); status.textContent = 'المايك مغلق';
        FX.toast('🎙 أغلقت المايك'); return;
      }
      if (this.net.status !== 'online' || !this.room) {
        FX.toast('اتصل بغرفة أولاً لتفعيل المحادثة الصوتية', 'bad'); AU.play('error'); return;
      }
      try {
        await this.net.enableMic();
        btn.classList.add('on'); status.textContent = '🎙 المايك مفتوح · تتحدث مع الغرفة';
        FX.toast('🎙 المايك مفتوح', 'good');
      } catch (e) {
        AU.play('error');
        FX.toast('تعذّر فتح المايك: ' + (e && e.message ? e.message : 'تحقق من الإذن'), 'bad');
      }
    },

    /* ------------------------------- الشبكة --------------------------- */
    bindNetwork() {
      const net = this.net;
      net.on('status', s => {
        if (this.screen === 'friends') TijaraUI.renderFriends();
        if (s === 'online') FX.toast('🌐 متصل بالخادم', 'good');
      });
      net.on('room', m => {
        this.room = { code: m.code, isHost: m.t === 'room:created' || net.isHost };
        if (net.isHost) { /* المضيف يبدأ المنافسة عندما يجهز */ }
        S.bumpProfile({ onlineRooms: net.isHost ? 0 : 1 }); S.checkAchievements();
        if (this.screen === 'friends') TijaraUI.renderFriends();
        FX.toast(net.isHost ? '🏠 غرفة ' + m.code + ' جاهزة' : '✅ انضممت للغرفة ' + m.code, 'good');
      });
      net.on('peers', () => { if (this.screen === 'friends') TijaraUI.renderFriends(); });
      net.on('peer:join', m => FX.toast('👋 انضم ' + (m.name || 'لاعب')));
      net.on('peer:left', () => { if (this.screen === 'friends') TijaraUI.renderFriends(); });
      net.on('error', m => FX.toast('⚠️ ' + (m.message || 'خطأ في الغرفة'), 'bad'));
      net.on('action', m => {
        if (this.mode !== 'host' || !this.game) return;
        const a = m.action;
        const allowedSeat = this.peerSeats[m.from];
        if (!a || allowedSeat === undefined) return;
        if (a.type === 'chat' || a.type === 'emoji') return;
        if (a.seat !== undefined && a.seat !== null && Number(a.seat) !== allowedSeat) return; // حماية
        if (a.seat === undefined || a.seat === null) a.seat = allowedSeat;
        this.game.dispatch(a);
        this.afterDispatch();
      });
      net.on('state', st => this.onRemoteState(st));
      net.on('chat', m => {
        this.netChat.push({ at: Date.now(), name: m.name || 'ضيف', text: m.text || '' });
        if (this.netChat.length > 120) this.netChat.shift();
        AU.play('chat'); TijaraUI.renderChat();
      });
      net.on('emoji', m => {
        const e = m.emoji || '🔥';
        FX.emojiAtSeat(e, m.seat === undefined ? 0 : m.seat, true);
        this.netChat.push({ at: Date.now(), name: m.name || 'ضيف', text: e, emoji: true });
        if (this.netChat.length > 120) this.netChat.shift();
        AU.play('emoji'); TijaraUI.renderChat();
      });
    },
    onRemoteState(st) {
      if (!st || !st.players) return;
      const prev = this.lastRemotePhase;
      this.state = st;
      this.mode = 'client';
      this.mySeat = st.youAre === undefined ? 0 : st.youAre;
      this.visibleSeat = this.mySeat;
      this.game = null;
      this.localHumanSeats = [this.mySeat];
      this.remoteSeats = new Set();
      this.handoffSeat = null;
      if (prev !== st.phase) {
        if (st.phase === 'result' && st.round !== this.lastCountedRound) {
          this.lastCountedRound = st.round;
          S.applyRound(st, [], this.mySeat, {});
          if (st.result && st.result.winnerId === this.mySeat) { FX.goldRain(); AU.play('win'); }
          else AU.play('lose');
          setTimeout(() => { if (this.state && this.state.phase === 'result' && this.screen === 'game') TijaraUI.openResult(); }, 420);
        }
        if (st.phase === 'matchEnd') { FX.goldRain(); setTimeout(() => TijaraUI.openMatchEnd(), 400); }
        if (st.phase === 'negotiation') { this.offerStart = Date.now(); AU.play('offer'); }
      }
      this.lastRemotePhase = st.phase;
      if (this.screen !== 'game') { TijaraUI.resetActionSig(); TijaraUI.go('game'); }
      TijaraUI.render();
    },
    broadcast() {
      if (this.mode !== 'host' || !this.net.isHost || !this.state) return;
      const views = {};
      for (const peerId in this.peerSeats) {
        views[peerId] = T.maskFor(this.state, this.peerSeats[peerId], this.peerSeats[peerId]);
      }
      this.net.broadcastState(views);
    },
    connect(url) {
      const u = (url || this.defaultServerUrl || '').trim();
      if (!u) { FX.toast('أدخل عنوان الخادم', 'bad'); return; }
      this.setSetting('serverUrl', u);
      FX.toast('⏳ جارٍ الاتصال…');
      this.net.connect(u, this.settings.myName)
        .then(() => { TijaraUI.renderFriends(); })
        .catch(e => { FX.toast('تعذّر الاتصال: ' + (e.message || e), 'bad'); TijaraUI.renderFriends(); });
    },
    disconnect() { this.net.disableMic(); this.net.disconnect(); this.room = null; },
    createRoom() {
      if (this.net.status !== 'online') { FX.toast('اتصل بالخادم أولاً', 'bad'); return; }
      this.net.createRoom({ players: this.settings.players, startBalance: this.settings.startBalance, negotiationSec: this.settings.negotiationSec });
    },
    joinRoom(code) {
      if (!code) { FX.toast('أدخل رمز الغرفة', 'bad'); return; }
      if (this.net.status !== 'online') { FX.toast('اتصل بالخادم أولاً', 'bad'); return; }
      this.net.joinRoom(code, this.settings.myName);
    },
    leaveRoom() { this.net.disableMic(); this.net.leaveRoom(); this.room = null; },
    startRoomMatch() {
      if (!this.net.isHost || !this.room) return;
      const peers = (this.net.peers || []).filter(p => p.peerId !== this.net.peerId);
      const total = T.clamp(Math.max(2, Math.min(10, this.settings.players, 1 + peers.length)), 2, 10);
      const seats = [];
      const peerSeats = {}, remoteSeats = new Set();
      seats.push({ seat: 0, name: this.settings.myName, type: 'human', avatar: '🧔', difficulty: this.settings.difficulty, personality: 'calm', peer: null });
      peers.slice(0, total - 1).forEach((p, i) => {
        const seat = i + 1;
        seats.push({ seat: seat, name: p.name || ('ضيف ' + seat), type: 'human', avatar: '🧑', difficulty: 'normal', personality: 'calm', peer: p.peerId });
        peerSeats[p.peerId] = seat; remoteSeats.add(seat);
      });
      for (let i = seats.length; i < total; i++) {
        seats.push(Object.assign({}, T.buildSeats(total)[i], { seat: i, type: 'bot', difficulty: this.settings.difficulty }));
      }
      this.startMatch(false, { hostMode: true, seats: seats, peerSeats: peerSeats, remoteSeats: remoteSeats });
      this.broadcast();
      FX.toast('🚀 بدأت المنافسة مع ' + seats.length + ' لاعبين', 'good');
    },
    invite(id, n) {
      const f = S.friends();
      const fr = f.list.find(x => x.id === id);
      if (!fr) return;
      this.setPlayers(n);
      if (this.setupSeats[1]) { this.setupSeats[1].name = fr.name; this.setupSeats[1].type = 'human'; }
      this.saveSetupSeats();
      if (this.net.status === 'online' && !this.room) this.createRoom();
      FX.toast('📨 دعوة ' + (n === 2 ? 'فردية 1 ضد 1' : 'جماعية') + ' إلى ' + fr.name + ' جاهزة', 'good');
      TijaraUI.go('setup');
    },

    /* ------------------------------- البيانات ------------------------- */
    clearData() {
      S.clearData();
      this.settings = S.settings();
      this.setupSeats = this.buildSetupSeats(this.settings.players);
      this.state = null; this.game = null; this.room = null;
      this.netChat = [];
      TijaraUI.renderHome(); TijaraUI.renderSetup(); TijaraUI.renderSettings();
    },
    clearHistory() {
      S.write(S.K.history, []); S.write(S.K.achievements, {}); S.write(S.K.profile, {});
      TijaraUI.renderHistory(); TijaraUI.renderHome();
    }
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => App.init());
  else App.init();
  root.TijaraApp = App;
})(typeof globalThis !== 'undefined' ? globalThis : this);
