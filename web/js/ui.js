/* ==========================================================================
   تجارة — طبقة العرض (كل الشاشات والنوافذ)
   ========================================================================== */
(function (root) {
  'use strict';
  const doc = root.document;
  const T = root.TijaraEngine, S = root.TijaraStore, FX = root.TijaraFX, AU = root.TijaraAudio;
  const $ = id => doc.getElementById(id);
  const esc = s => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fmt = T.fmt;
  let App = null, el = {}, actionSig = '', rulesTab = 0, lastChatSig = '';

  /* ------------------------------ التهيئة ------------------------------ */
  function init(app) {
    App = app;
    el = {
      screens: Array.from(doc.querySelectorAll('.screen')),
      homeStats: $('home-stats'), resume: $('resume-bar'),
      setup: $('setup-body'), settingsBody: $('settings-body'),
      history: $('history-body'), friends: $('friends-body'),
      seats: $('seats'), seatsList: $('seats-list'), felt: $('table-felt'),
      pot: $('pot-value'), potPhase: $('pot-phase'), deckInfo: $('deck-info'),
      topPhase: $('top-phase'), topRound: $('top-round'),
      hand: $('hand'), handLabel: $('hand-label'), handEval: $('hand-eval'),
      actions: $('action-panel'), chatLog: $('chat-log'),
      timerRing: $('timer-ring'), timerNum: $('timer-num'), trFg: $('tr-fg'),
      side: $('side-panel'), quick: $('quick-phrases'), emojis: $('emoji-picker'),
      modalRoot: $('modal-root'), privacyRoot: $('privacy-root'),
      netPill: $('net-pill'), bottomNav: $('bottom-nav')
    };
    FX.init();
    renderStatic();
    bindEvents();
    go('home');
  }
  function renderStatic() {
    el.quick.innerHTML = T.QUICK_PHRASES.map(p =>
      '<button data-act="phrase" data-text="' + esc(p) + '">' + esc(p) + '</button>').join('');
    el.emojis.innerHTML = T.EMOJIS.map((e, i) =>
      '<button data-act="emoji" data-emoji="' + esc(e) + '" title="' + esc(e) +
      '" style="--i:' + i + '">' + e + '</button>').join('');
  }

  /* --------------------------- التنقل بين الشاشات --------------------- */
  function go(screen) {
    if (!App) return;
    App.screen = screen;
    el.screens.forEach(s => s.classList.toggle('active', s.id === 'screen-' + screen));
    el.bottomNav.style.display = screen === 'game' ? 'none' : '';
    Array.from(el.bottomNav.children).forEach(b => b.classList.toggle('on', b.dataset.nav === screen));
    if (screen === 'home') renderHome();
    if (screen === 'setup') renderSetup();
    if (screen === 'settings') renderSettings();
    if (screen === 'history') renderHistory();
    if (screen === 'friends') renderFriends();
    if (screen === 'game') render();
    if (el.side) el.side.classList.remove('open');
    root.scrollTo && root.scrollTo(0, 0);
  }

  /* ------------------------------- الرئيسية --------------------------- */
  function renderHome() {
    const s = S.homeStats();
    el.homeStats.innerHTML =
      stat(s.matches, 'مباريات') + stat(s.wins, 'انتصارات') +
      stat(fmt(s.biggestWin), 'أكبر ربح') + stat(s.badges + '/' + s.totalBadges, 'أوسمة');
    const saved = S.loadGame();
    el.resume.classList.toggle('hidden', !saved || saved.phase === 'matchEnd');
    if (saved && saved.phase !== 'matchEnd') el.resume.textContent = '◀ متابعة المباراة · جولة ' + (saved.round || 1);
  }
  function stat(v, l) { return '<div class="hstat"><b>' + v + '</b><small>' + l + '</small></div>'; }

  /* --------------------------- إعدادات المباراة ----------------------- */
  function renderSetup() {
    const c = App.settings;
    const seats = App.setupSeats;
    let html = '';
    html += '<div class="card-box"><h3>👥 عدد اللاعبين</h3><p class="muted">من 2 إلى 10 · تُدمج الرزم تلقائياً لتكفي الجميع</p>' +
      '<div class="chip-row" style="margin-top:10px">';
    for (let n = 2; n <= 10; n++) html += '<button class="chip ' + (c.players === n ? 'on' : '') + '" data-act="players" data-n="' + n + '">' + n + '</button>';
    html += '</div><p class="muted" style="margin-top:8px">الرزم المستخدمة: <b style="color:var(--gold-2)">' + T.deckCountFor(c.players) + '</b> رزمة × 16 ورقة تكفي ' + (c.players * 4) + ' أوراق</p></div>';

    html += '<div class="card-box"><h3>💰 المبلغ الافتراضي للبدء</h3><p class="muted">لكل لاعب · القيمة الافتراضية 50,000</p>' +
      '<div class="field" style="margin-top:10px"><input class="input" data-field="startBalance" type="number" min="1000" step="1000" value="' + c.startBalance + '" inputmode="numeric"></div>' +
      '<div class="amount-presets">' + [10000, 25000, 50000, 100000, 250000].map(v =>
        '<button data-act="balance" data-v="' + v + '">' + fmt(v) + '</button>').join('') + '</div></div>';

    html += '<div class="card-box"><h3>⏱ وقت التفاوض</h3><p class="muted">يُحتسب عند عرض الانسحاب؛ «مفتوح» بلا مؤقت</p>' +
      '<div class="chip-row" style="margin-top:10px">' + [[10, '10 ث'], [15, '15 ث'], [20, '20 ث'], [30, '30 ث'], [0, 'مفتوح']].map(x =>
        '<button class="chip ' + (c.negotiationSec === x[0] ? 'on' : '') + '" data-act="neg" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div></div>';

    html += '<div class="card-box"><h3>🎯 مستوى البوتات</h3><div class="chip-row" style="margin-top:8px">' +
      T.DIFFICULTIES.map(d => '<button class="chip ' + (c.difficulty === d.id ? 'on' : '') + '" data-act="difficulty" data-v="' + d.id + '">' + d.name + '</button>').join('') +
      '</div><div class="switch-row" style="margin-top:8px"><span>إكمال العدد بالبوتات تلقائياً</span>' + sw('fillWithBots', c.fillWithBots) + '</div>' +
      '<div class="field" style="margin-top:10px"><label>عدد الجولات الأقصى للمباراة</label><input class="input" data-field="maxRounds" type="number" min="1" max="200" value="' + c.maxRounds + '" inputmode="numeric"></div></div>';

    html += '<div class="section-title">🪑 مقاعد الطاولة</div>';
    html += seats.map((p, i) => {
      const isHuman = p.type === 'human';
      return '<div class="card-box" style="padding:12px">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
        '<span style="font-size:22px">' + esc(p.avatar) + '</span>' +
        '<input class="input" data-seat-name="' + i + '" value="' + esc(p.name) + '" style="flex:1" maxlength="16">' +
        '<button class="chip ' + (isHuman ? 'on' : '') + '" data-act="seat-type" data-i="' + i + '">' + (isHuman ? '👤 إنسان' : '🤖 بوت') + '</button></div>' +
        (isHuman ? '<p class="muted">لاعب على هذا الجهاز (تسليم الجهاز عند دوره)</p>' :
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">' +
          '<select class="input" data-seat-diff="' + i + '" style="flex:1;min-width:110px">' + T.DIFFICULTIES.map(d =>
            '<option value="' + d.id + '" ' + (p.difficulty === d.id ? 'selected' : '') + '>' + d.name + '</option>').join('') + '</select>' +
          '<select class="input" data-seat-person="' + i + '" style="flex:1;min-width:110px">' + T.PERSONALITIES.map(x =>
            '<option value="' + x.id + '" ' + (p.personality === x.id ? 'selected' : '') + '>' + x.emoji + ' ' + x.name + '</option>').join('') + '</select></div>') +
        '</div>';
    }).join('');

    html += '<button class="btn btn-outline btn-block" data-modal="rules">📜 القوانين وطريقة اللعب</button>';
    html += '<p class="muted" style="text-align:center;margin:12px 0">كل الخيارات قابلة للتغيير قبل بدء المنافسة فقط.</p>';
    el.setup.innerHTML = html;
  }

  /* ------------------------------- الإعدادات -------------------------- */
  function renderSettings() {
    const c = App.settings;
    let h = '<div class="card-box"><h3>⚙️ إعدادات اللعب الافتراضية</h3><p class="muted">تُطبّق على كل مباراة جديدة</p>';
    h += '<div class="field" style="margin-top:10px"><label>اسمك على الطاولة</label><input class="input" data-field="myName" value="' + esc(c.myName) + '" maxlength="16"></div>';
    h += '<div class="field"><label>المبلغ الافتراضي للبدء</label><input class="input" data-field="startBalance" type="number" min="1000" step="1000" value="' + c.startBalance + '"></div>';
    h += '<div class="field"><label>وقت التفاوض</label><select class="input" data-field="negotiationSec">' +
      [[10, '10 ثوانٍ'], [15, '15 ثانية'], [20, '20 ثانية'], [30, '30 ثانية'], [0, 'مفتوح (بدون مؤقت)']].map(x =>
        '<option value="' + x[0] + '" ' + (c.negotiationSec === x[0] ? 'selected' : '') + '>' + x[1] + '</option>').join('') + '</select></div>';
    h += '<div class="field"><label>عدد اللاعبين الافتراضي</label><select class="input" data-field="players">' +
      Array.from({ length: 9 }, (_, i) => i + 2).map(n => '<option value="' + n + '" ' + (c.players === n ? 'selected' : '') + '>' + n + ' لاعبين</option>').join('') + '</select></div>';
    h += '<div class="field"><label>مستوى البوتات</label><select class="input" data-field="difficulty">' +
      T.DIFFICULTIES.map(d => '<option value="' + d.id + '" ' + (c.difficulty === d.id ? 'selected' : '') + '>' + d.name + '</option>').join('') + '</select></div>';
    h += '<div class="field"><label>عدد الجولات الأقصى</label><input class="input" data-field="maxRounds" type="number" min="1" max="200" value="' + c.maxRounds + '"></div></div>';

    h += '<div class="card-box"><h3>🔊 الصوت والاهتزاز</h3>' +
      row('المؤثرات الصوتية', 'sound', c.sound) + row('الموسيقى الخلفية', 'music', c.music) +
      row('الاهتزاز', 'vibration', c.vibration) + row('المؤثرات البصرية', 'effects', c.effects) +
      '<div class="field" style="margin-top:8px"><label>مستوى المؤثرات: ' + Math.round(c.sfxVolume * 100) + '%</label><input type="range" min="0" max="1" step="0.05" value="' + c.sfxVolume + '" data-field="sfxVolume"></div>' +
      '<div class="field"><label>مستوى الموسيقى: ' + Math.round(c.musicVolume * 100) + '%</label><input type="range" min="0" max="1" step="0.05" value="' + c.musicVolume + '" data-field="musicVolume"></div></div>';

    h += '<div class="card-box"><h3>🌐 الشبكة والمظهر</h3>' +
      '<div class="field"><label>عنوان خادم الغرف (ws://IP:5173/ws)</label><input class="input" data-field="serverUrl" value="' + esc(c.serverUrl) + '" placeholder="اتركه فارغاً لاستخدام نفس المضيف" dir="ltr" style="text-align:left"></div>' +
      '<div class="field"><label>عرض المقاعد الافتراضي</label><select class="input" data-field="tableView"><option value="table" ' + (c.tableView === 'table' ? 'selected' : '') + '>طاولة دائرية</option><option value="list" ' + (c.tableView === 'list' ? 'selected' : '') + '>قائمة واضحة</option></select></div>' +
      '<p class="muted">اللعب عبر الواي فاي/الإنترنت يحتاج تشغيل الخادم المرفق (راجع دليل التثبيت). تقنية البلوتوث غير مدعومة مباشرة في WebView، لكن يمكن استخدام «نقطة اتصال بلوتوث/واي فاي» بين الأجهزة.</p></div>';

    h += '<div class="card-box"><h3>🧹 البيانات</h3><div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn-sm btn-outline" data-modal="rules">📜 القوانين</button>' +
      '<button class="btn btn-sm btn-outline" data-modal="about">ℹ️ عن اللعبة</button>' +
      '<button class="btn btn-sm btn-red" data-modal="confirm-clear">مسح كل البيانات</button></div></div>';
    el.settingsBody.innerHTML = h;
  }
  function sw(key, on) { return '<button class="switch ' + (on ? 'on' : '') + '" data-act="toggle" data-key="' + key + '" aria-label="تبديل"></button>'; }
  function row(label, key, on) { return '<div class="switch-row"><span>' + label + '</span>' + sw(key, on) + '</div>'; }

  /* --------------------------- السجل والإنجازات ----------------------- */
  function renderHistory() {
    const p = S.profile(), h = S.history(), ach = S.achievements();
    const cats = {};
    ach.forEach(a => { (cats[a.cat] || (cats[a.cat] = [])).push(a); });
    let html = '<div class="section-title">📊 لوحة الأرقام</div><div class="stat-grid">' +
      cell(p.matches, 'مباريات') + cell(p.rounds, 'جولات') + cell(p.wins, 'انتصارات') +
      cell(fmt(p.biggestWin), 'أكبر ربح') + cell(fmt(p.biggestLoss), 'أكبر خسارة') +
      cell(p.whaleTakedowns, 'إطاحة بالهوامير') + cell(p.mercy, 'مرات الرحمة') +
      cell(p.suspensions, 'مرات الإيقاف') + cell(p.negotiatedWins, 'ربح بالتفاوض') + '</div>';

    html += '<div class="section-title">📅 تاريخ المباريات</div>';
    if (!h.length) html += '<div class="card-box"><p class="muted">لا توجد مباريات محفوظة بعد. ابدأ مباراة لتظهر هنا.</p></div>';
    else html += h.map(m => '<div class="match-row"><span class="mi">' + (m.ranking && m.ranking[0] && m.ranking[0].name === App.settings.myName ? '🏆' : '🃏') + '</span>' +
      '<div class="mt"><b>' + esc(m.winner) + ' · ' + m.players + ' لاعبين</b><small>' + new Date(m.date).toLocaleString('ar-YE') +
      ' · ' + m.rounds + ' جولة · أكبر ربح ' + fmt(m.biggestWin) + ' · أكبر خسارة ' + fmt(m.biggestLoss) + '</small></div>' +
      '<div class="mb">إطاحة ' + m.whaleTakedowns + '<br>رحمة ' + m.mercy + ' · إيقاف ' + m.suspensions + '</div></div>').join('');

    for (const cat in cats) {
      html += '<div class="section-title">🎖 ' + esc(cat) + ' <small style="color:var(--muted);font-weight:400">(' + cats[cat].filter(a => a.done).length + '/' + cats[cat].length + ')</small></div><div class="ach-grid">';
      html += cats[cat].map(a => '<div class="ach ' + (a.done ? 'unlocked' : '') + '"><span class="ico">' + a.icon + '</span><div class="txt">' +
        '<b>' + esc(a.name) + (a.done ? ' ✅' : ' 🔒') + '</b><small>' + esc(a.desc) + '</small>' +
        '<div class="bar"><i style="width:' + a.percent + '%"></i></div><span class="pct">' + a.percent + '% · ' + fmt(Math.min(a.value, a.goal)) + ' / ' + fmt(a.goal) + '</span></div></div>').join('');
      html += '</div>';
    }
    el.history.innerHTML = html;
  }
  function cell(v, l) { return '<div class="stat-cell"><b>' + v + '</b><small>' + l + '</small></div>'; }

  /* ------------------------------ الأصدقاء ---------------------------- */
  function renderFriends() {
    const c = App.settings, f = S.friends(), net = App.net;
    const online = net.status === 'online';
    el.netPill.textContent = online ? 'متصل' : (net.status === 'connecting' ? 'جارٍ الاتصال…' : 'غير متصل');
    el.netPill.classList.toggle('on', online);
    let h = '';
    h += '<div class="card-box"><h3>🌐 غرفة اللعب (محلي / إنترنت)</h3>' +
      '<p class="muted">شغّل الخادم المرفق على جهاز أو استخدم عنوان خادم بعيد، ثم أدخل العنوان هنا.</p>' +
      '<div class="field" style="margin-top:10px"><label>عنوان الخادم</label><input class="input" id="net-url" dir="ltr" style="text-align:left" placeholder="ws://192.168.1.10:5173/ws" value="' + esc(c.serverUrl || App.defaultServerUrl) + '"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-sm btn-teal" data-act="net:connect">اتصال</button>' +
      (online ? '<button class="btn btn-sm btn-outline" data-act="net:disconnect">فصل</button>' : '') + '</div>' +
      '<p class="muted" style="margin-top:8px">على الشبكة المحلية: جميع الأجهزة على نفس الواي فاي. عبر الإنترنت: استخدم خادماً عاماً مع WSS. تقنية البلوتوث تُستخدم عبر مشاركة اتصال/نقطة وصول.</p></div>';

    if (online && !App.room) {
      h += '<div class="card-box"><h3>🏠 إنشاء / الانضمام</h3>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-gold btn-sm" data-act="net:create">إنشاء غرفة</button></div>' +
        '<div class="field" style="margin-top:12px"><label>رمز الغرفة</label><input class="input" id="room-code-input" dir="ltr" style="text-align:center;letter-spacing:4px;font-weight:900" placeholder="ABCDE" maxlength="6"></div>' +
        '<button class="btn btn-teal btn-block" data-act="net:join">انضمام للغرفة</button></div>';
    }
    if (App.room) {
      h += '<div class="card-box"><h3>🎪 غرفة ' + esc(App.room.code) + '</h3><div class="room-code">' + esc(App.room.code) + '</div>' +
        '<p class="qr-note">شارك هذا الرمز مع أصدقائك · ' + (App.mode === 'host' ? 'أنت المضيف' : 'أنت ضيف') + '</p>' +
        '<div class="section-title">👥 في الغرفة (' + (net.peers.length || 1) + ')</div>' +
        (net.peers.length ? net.peers.map(p => '<div class="friend-row"><span class="fa">🧑</span><div class="fn"><b>' + esc(p.name) + '</b><small>' + (p.isHost ? 'المضيف' : 'ضيف') + '</small></div></div>').join('') : '<p class="muted">في انتظار انضمام الأصدقاء…</p>') +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
        (App.mode === 'host' ? '<button class="btn btn-gold btn-sm" data-act="net:start">🚀 بدء المنافسة</button>' : '<p class="muted">بانتظار المضيف لبدء المنافسة…</p>') +
        '<button class="btn btn-sm btn-outline" data-act="net:leave">مغادرة</button></div></div>';
    }

    h += '<div class="section-title">➕ إضافة صديق</div><div class="card-box">' +
      '<div style="display:flex;gap:8px"><input class="input" id="friend-name" placeholder="اسم الصديق" maxlength="18"><input class="input" id="friend-code" placeholder="رمز (اختياري)" maxlength="12" style="max-width:120px"></div>' +
      '<button class="btn btn-sm btn-gold btn-block" style="margin-top:8px" data-act="friend:add">إرسال طلب صداقة / إضافة</button></div>';

    if (f.incoming.length) {
      h += '<div class="section-title">📨 طلبات واردة</div>' + f.incoming.map(x => '<div class="friend-row"><span class="fa">' + esc(x.avatar) + '</span><div class="fn"><b>' + esc(x.name) + '</b><small>طلب صداقة · ' + esc(x.code || '') + '</small></div>' +
        '<button class="btn btn-sm btn-teal" data-act="friend:accept" data-id="' + x.id + '">قبول</button>' +
        '<button class="btn btn-sm btn-outline" data-act="friend:remove" data-id="' + x.id + '">رفض</button></div>').join('');
    }
    h += '<div class="section-title">🤝 الأصدقاء (' + f.list.length + ')</div>';
    if (!f.list.length) h += '<div class="card-box"><p class="muted">لا يوجد أصدقاء بعد. أضف صديقاً أو اقبل طلباً وارداً.</p></div>';
    else h += f.list.map(x => '<div class="friend-row"><span class="fa">' + esc(x.avatar) + '</span><div class="fn"><b>' + esc(x.name) + '</b><small>' + (x.status === 'pending' ? 'طلب مرسل' : 'متصل') + ' · ' + esc(x.code || '') + '</small></div>' +
      '<button class="btn btn-sm btn-gold" data-act="friend:invite1" data-id="' + x.id + '">1 ضد 1</button>' +
      '<button class="btn btn-sm btn-outline" data-act="friend:inviteGroup" data-id="' + x.id + '">جماعية</button>' +
      '<button class="icon-btn" data-act="friend:remove" data-id="' + x.id + '">✕</button></div>').join('');
    if (f.outgoing.length) h += '<div class="section-title">📤 طلبات مرسلة</div>' + f.outgoing.map(x => '<div class="friend-row"><span class="fa">⏳</span><div class="fn"><b>' + esc(x.name) + '</b><small>بانتظار القبول</small></div></div>').join('');
    h += '<p class="muted" style="text-align:center;margin:16px 0">الدردشة النصية والإيموجيات والمايك متاحة داخل الطاولة أثناء اللعب.</p>';
    el.friends.innerHTML = h;
  }

  /* ============================== الطاولة ============================== */
  function render() {
    if (!App.state) return;
    renderTop();
    renderSeats();
    renderHand();
    renderActions();
    renderChat();
    renderMarket();
    updateTimer();
  }
  function renderTop() {
    const st = App.state;
    const names = {
      privacy: 'تسليم الأوراق', auction: 'السوق والمزايدة', supervisor: 'قرار المشرّف',
      offers: 'عروض الانسحاب', negotiation: 'التفاوض', counters: 'قرار المشرّف',
      result: 'نتيجة الجولة', matchEnd: 'نهاية المباراة', deal: 'توزيع الأوراق'
    };
    el.topPhase.textContent = names[st.phase] || st.phase;
    el.topRound.textContent = 'جولة ' + st.round + ' / ' + st.settings.maxRounds;
    const total = st.players.reduce((s, p) => s + (p.entry || 0), 0);
    el.pot.textContent = fmt(total);
    el.potPhase.textContent = st.phase === 'auction' ? 'أعلى دخول / الحد الأدنى: ' + fmt((st.auction && st.auction.highest) || 0) :
      st.phase === 'negotiation' ? '⏳ جولة التفاوض ' + (st.offersRound || 1) :
      st.phase === 'counters' ? '🔁 إعادة العرض أو الفرش' :
        st.phase === 'result' ? '🏆 ' + (st.result && st.result.winnerName || '—') : 'السوق مفتوح للتمويه';
    el.deckInfo.textContent = st.deckCount + ' رزمة · ' + st.players.length + ' مقاعد · ' + (st.players.length * 4) + ' ورقة';
  }
  function renderSeats() {
    const st = App.state, n = st.players.length;
    const listMode = App.settings.tableView === 'list';
    el.felt.classList.toggle('hidden', listMode);
    el.seatsList.classList.toggle('hidden', !listMode);
    if (listMode) {
      el.seatsList.innerHTML = st.players.map(p => seatListHtml(p, st)).join('');
      return;
    }
    el.seats.className = 'seats seats-' + n;
    const rx = n <= 4 ? 42 : 44, ry = n <= 4 ? 40 : 42;
    el.seats.innerHTML = st.players.map((p, i) => {
      const ang = (-90 + i * 360 / n) * Math.PI / 180;
      const left = 50 + rx * Math.cos(ang), top = 50 + ry * Math.sin(ang);
      return seatHtml(p, st, left, top);
    }).join('');
  }
  function seatFlags(p, st) {
    const flags = [];
    if (p.suspendedFor > 0) flags.push('موقوف ' + p.suspendedFor);
    if (st.supervisorId === p.seat && st.phase !== 'result') flags.push('المشرّف');
    if (p.type === 'bot') flags.push('بوت');
    if (p.folded && st.phase !== 'result') flags.push('خارج');
    if (p.response === 'accept') flags.push('قبل العرض');
    if (p.response === 'insist') flags.push('كشف!');
    if (p.response === 'counter') flags.push('يفاوض');
    return flags;
  }
  function seatHtml(p, st, left, top) {
    const actor = App.currentActorSeat();
    const cls = ['seat'];
    if (actor === p.seat && ['auction', 'negotiation', 'supervisor', 'offers', 'counters'].includes(st.phase)) cls.push('turn');
    if (st.supervisorId === p.seat) cls.push('supervisor');
    if (p.suspendedFor > 0) cls.push('suspended');
    if (p.folded || (p.withdrawal && p.withdrawal.accepted)) cls.push('out');
    const flags = seatFlags(p, st);
    const badge = flags.length ? '<span class="seat-badge ' + (flags[0] !== 'المشرّف' ? 'bot' : '') + '">' + esc(flags[0]) + '</span>' : '';
    const showCards = st.phase === 'result' && (st.revealedSeats || []).includes(p.seat);
    const cards = showCards ? '<div class="seat-hand-mini">' + p.hand.map(c =>
      '<i class="' + (c.rank === 'B' ? 'b' : '') + '">' + (c.rank === 'B' ? 'ب' : c.rank) + '</i>').join('') + '</div>'
      : '<div class="seat-cards">' + (p.hand.length ? '🂠'.repeat(Math.min(4, p.hand.length)) : '—') + '</div>';
    return '<div class="' + cls.join(' ') + '" data-seat="' + p.seat + '" style="left:' + left.toFixed(1) + '%;top:' + top.toFixed(1) + '%">' +
      '<div class="seat-avatar">' + esc(p.avatar) + badge + '</div>' +
      '<div class="seat-name">' + esc(p.name) + '</div>' +
      '<div class="seat-balance">' + fmt(p.balance) + '</div>' +
      '<div class="seat-bid ' + (p.entry === 0 ? 'zero' : '') + '">' + (p.entry === null ? 'لم يدخل' : 'دخل ' + fmt(p.entry)) + '</div>' +
      cards + '</div>';
  }
  function seatListHtml(p, st) {
    const flags = seatFlags(p, st);
    const actor = App.currentActorSeat();
    return '<div class="list-seat ' + (actor === p.seat ? 'turn' : '') + '" data-seat="' + p.seat + '">' +
      '<span class="sa">' + esc(p.avatar) + '</span><div class="ln"><b>' + esc(p.name) + ' ' + (flags.length ? '<small>(' + esc(flags.join(' · ')) + ')</small>' : '') + '</b>' +
      '<small>' + (p.entry === null ? 'لم يدخل السوق' : 'دخل ' + fmt(p.entry)) + ' · ' + (p.hand.length ? '٤ أوراق' : 'موقوف') + '</small></div>' +
      '<span class="lb">' + fmt(p.balance) + '</span></div>';
  }
  function renderMarket() {
    const st = App.state;
    const box = doc.getElementById('market-log');
    if (!box || !st.auction) return;
    box.innerHTML = (st.auction.history || []).slice(-8).map(x => {
      const p = st.players[x.seat];
      const t = x.kind === 'fold' ? 'انسحب' : x.kind === 'pass' ? 'ثبّت' : 'دخل ' + fmt(x.amount);
      return '<span>' + esc(p ? p.name : '') + ': ' + t + '</span>';
    }).join('');
  }

  /* ------------------------------- الأوراق ---------------------------- */
  function renderHand() {
    const st = App.state, seat = App.visibleSeat;
    const p = st.players[seat];
    if (!p) return;
    const canSee = App.canSeeHand(seat);
    const cards = p.hand || [];
    const label = 'أوراق ' + (seat === App.mySeat ? 'ك' : p.name);
    el.handLabel.textContent = label;
    let html = '';
    if (!canSee) {
      html = cards.map(() => '<div class="pcard back"></div>').join('') || '<span class="muted">موقوف هذا الدور</span>';
    } else {
      html = cards.map(c => {
        if (c.hidden) return '<div class="pcard back"></div>';
        const rank = c.rank === 'B' ? 'بنط' : c.rank;
        return '<div class="pcard ' + (c.rank === 'B' ? 'bint' : '') + ' reveal">' +
          '<span class="corner">' + esc(rank) + '</span><span class="rank">' + esc(rank) + '</span>' +
          '<span class="suit">' + esc(c.suit || '♠') + '</span></div>';
      }).join('');
    }
    el.hand.innerHTML = html;
    if (canSee && cards.length && !cards[0].hidden) {
      const e = T.evalHand(cards);
      el.handEval.innerHTML = '<b>' + e.categoryName + '</b>' + esc(e.label);
    } else el.handEval.innerHTML = '<b>🔒</b>أوراق مخفية';
    // أزرار تبديل العرض بين اللاعبين البشريين على نفس الجهاز
    const humans = st.players.filter(x => x.type === 'human').map(x => x.seat);
    if (humans.length > 1 && App.mode !== 'client') {
      el.handEval.innerHTML += '<div class="amount-presets" style="justify-content:center;margin-top:4px">' +
        humans.map(s => '<button data-act="viewer" data-seat="' + s + '" class="' + (s === seat ? 'on' : '') + '">' + esc(st.players[s].name) + '</button>').join('') + '</div>';
    }
  }

  /* ---------------------------- لوحة الإجراءات ------------------------ */
  function renderActions() {
    const st = App.state;
    const actor = App.currentActorSeat();
    const sig = [st.phase, actor, st.round, App.mySeat, App.canSeeHand(App.visibleSeat),
      st.supervisorId, st.offersRound, st.auction && st.auction.highest,
      (st.auction && st.auction.history || []).length,
      (st.players || []).map(p => p.response).join(','),
      (st.counterPending || []).join(','), App.handoffNeeded()].join('|');
    if (sig === actionSig && !App.forceActionRender) { return; }
    actionSig = sig; App.forceActionRender = false;
    const box = el.actions;
    let h = '';
    const localActor = App.isLocalSeat(actor);

    switch (st.phase) {
      case 'privacy':
        h = App.mode === 'client'
          ? banner('🤫 أوراقك جاهزة', 'أوراقك ظاهرة لك وحدك · بانتظار أن يجهّز المضيف الطاولة')
          : banner('🤫 توزيع الأوراق سراً', 'سلّم الجهاز لكل لاعب ليرى أوراقه دون أن يراها الآخرون') +
            '<div class="action-row"><button class="btn btn-gold" data-act="privacy:start">👁 عرض الأوراق بالتسليم</button></div>';
        break;

      case 'auction': {
        const a = st.auction;
        const p = st.players[actor];
        const minimum = a.leaderId === null ? 0 : (a.highest || 0);
        h = banner('🤑 السوق · دخول واحد لكل لاعب',
          'الحد الأدنى = أعلى دخول سابق · من لا يملكه يدخل بكامل رصيده · الأعلى يصبح المشرّف');
        if (localActor && p) {
          const my = p.balance;
          const short = my < minimum;
          const floor = Math.min(minimum, my);
          const presets = [minimum, minimum + 500, minimum + 1000, minimum + 5000,
            Math.floor(my * 0.25), Math.floor(my * 0.5), my]
            .map(v => Math.max(0, Math.min(my, v)))
            .filter((v, i, arr) => arr.indexOf(v) === i && v >= floor)
            .sort((x, y) => x - y);
          h += '<div class="action-title">دور ' + esc(p.name) + ' <small>رصيدك ' + fmt(my) +
            ' · الحد الأدنى للدخول ' + fmt(minimum) + '</small></div>' +
            (short ? '<div class="budget">⚠️ رصيدك أقل من الحد الأدنى: الاستثناء الوحيد أن تدخل <b>بكامل رصيدك ' + fmt(my) + '</b>.</div>' : '') +
            '<div class="bid-box"><input id="bid-amount" type="number" inputmode="numeric" min="' + floor +
            '" max="' + my + '" value="' + floor + '" dir="ltr" style="text-align:center">' +
            '<button class="btn btn-gold" data-act="bid:enter">✅ دخول السوق</button></div>' +
            '<div class="amount-presets">' + presets.map(v =>
              '<button data-act="bid:preset" data-v="' + v + '">' + (v === 0 ? 'صفر' : fmt(v)) + '</button>').join('') +
            (my > floor ? '<button data-act="bid:allin">💰 كل الرصيد</button>' : '') +
            (minimum + 1 <= my ? '<button data-act="bid:plus1">+1 فوق الحد</button>' : '') + '</div>' +
            '<div class="action-row"><button class="btn btn-outline" data-act="bid:pass">⏭ تمرير بلا دخول</button>' +
            '<button class="btn btn-red" data-act="bid:fold">انسحاب</button></div>' +
            '<div class="market-log" id="market-log"></div>';
        } else {
          h += '<div class="action-title">⏳ بانتظار ' + esc(p ? p.name : 'لاعب') + (p && p.type === 'bot' ? ' 🤖' : '') + '</div>' +
            '<div class="market-log" id="market-log"></div>' +
            (p && p.type === 'bot' ? '<button class="btn btn-sm btn-outline" data-act="skipBot">تخطي الانتظار ⏩</button>' : '');
        }
        break;
      }
      case 'supervisor': {
        const sup = st.players[st.supervisorId];
        h = banner('👑 ' + esc(sup.name) + ' هو المشرّف', 'دخل بـ ' + fmt(sup.entry) + ' · يختار الآن مسار الجولة');
        if (localActor && App.isLocalSeat(st.supervisorId)) {
          h += '<div class="action-row"><button class="btn btn-red" data-act="sup:fix">🔒 الكل مثبت</button>' +
            '<button class="btn btn-teal" data-act="sup:neg">🤝 عرض الانسحاب والتفاوض</button></div>' +
            '<p class="muted" style="margin-top:6px">«الكل مثبت» يُجبر الداخلين على كشف أوراقهم ويفوز صاحب اليد الأقوى.</p>';
        } else h += '<div class="action-title">⏳ بانتظار قرار المشرّف…</div>' + (sup.type === 'bot' ? '<button class="btn btn-sm btn-outline" data-act="skipBot">تخطي ⏩</button>' : '');
        break;
      }
      case 'offers': {
        const sup = st.players[st.supervisorId];
        const others = st.players.filter(p => p.entry !== null && !p.folded && p.seat !== st.supervisorId);
        h = banner('💸 عروض الانسحاب', 'المشرّف يوزّع من إجمالي ما دخل به (' + fmt(sup.entry) + ') · يمكن إعادة العرض أكثر من مرة');
        if (App.isLocalSeat(st.supervisorId)) {
          h += '<div class="action-title">حدّد مبلغاً لكل لاعب <small>المجموع لا يتجاوز ' + fmt(sup.entry) + '</small></div>';
          h += others.map(p => '<div class="offer-row"><span class="oname">' + esc(p.avatar) + ' ' + esc(p.name) + ' <small class="muted">دخل ' + fmt(p.entry) + '</small></span>' +
            '<input type="number" min="0" max="' + sup.entry + '" value="0" data-offer="' + p.seat + '" inputmode="numeric" dir="ltr" style="text-align:center"></div>').join('');
          h += '<div class="budget">💡 تستطيع عرض 0 أيضاً. إن قبل اللاعب وفزتَ في المفارشة دفعتَ له العرض من رصيدك.</div>' +
            '<div class="action-row" style="margin-top:8px"><button class="btn btn-gold" data-act="offers:submit">إرسال العروض</button>' +
            '<button class="btn btn-outline" data-act="offers:equal">توزيع بالتساوي</button></div>';
        } else h += '<div class="action-title">⏳ المشرّف يجهّز العروض…</div>' + (sup.type === 'bot' ? '<button class="btn btn-sm btn-outline" data-act="skipBot">تخطي ⏩</button>' : '');
        break;
      }
      case 'negotiation': {
        const pending = st.players.filter(p => p.entry !== null && !p.folded && p.seat !== st.supervisorId && p.response === null);
        const mine = pending.filter(p => App.isLocalSeat(p.seat));
        const p = mine[0] || pending[0];
        h = banner('⏳ جولة التفاوض ' + (st.offersRound || 1),
          (st.settings.negotiationSec ? 'الوقت المحدد لهذه الجولة: ' + st.settings.negotiationSec + ' ثانية · ' : 'الوقت مفتوح · ') +
          'يمكن إعادة التفاوض حتى الرضى أو يفرش المشرّف الأوراق');
        if (mine.length && p) {
          const offer = st.offers[p.seat] || 0;
          h += '<div class="action-title">دور ' + esc(p.name) + ' <small>العرض المقدّم: ' + fmt(offer) + ' · دخولك: ' + fmt(p.entry) + '</small></div>' +
            '<div class="action-row"><button class="btn btn-teal" data-act="resp:accept" data-seat="' + p.seat + '">✅ قبول (' + fmt(offer) + ')</button>' +
            '<button class="btn btn-red" data-act="resp:reject" data-seat="' + p.seat + '">✋ رفض</button></div>' +
            '<div class="bid-box" style="margin-top:8px"><input id="counter-amount" type="number" min="0" value="' + Math.max(offer * 2, 1000) + '" inputmode="numeric" dir="ltr" style="text-align:center">' +
            '<button class="btn btn-outline" data-act="resp:counter" data-seat="' + p.seat + '">💬 تفاوض على مبلغ</button>' +
            '<button class="btn btn-outline" data-act="resp:insist" data-seat="' + p.seat + '">😤 إصرار وكشف</button></div>' +
            '<div class="market-log" id="market-log"></div>';
        } else {
          h += '<div class="action-title">⏳ بانتظار رد ' + (pending.length ? esc(pending.map(x => x.name).join('، ')) : 'اللاعبين') + '</div>' +
            '<div class="market-log" id="market-log"></div>' +
            (pending.length && pending.every(x => x.type === 'bot') ? '<button class="btn btn-sm btn-outline" data-act="skipBot">تخطي ⏩</button>' : '') +
            (st.settings.negotiationSec ? '<button class="btn btn-sm btn-outline" data-act="timer:force">⏱ إنهاء الوقت الآن</button>' : '');
        }
        break;
      }
      case 'counters': {
        const sup = st.players[st.supervisorId];
        const pend = st.counterPending || [];
        const unresolved = st.players.filter(p => p.entry !== null && !p.folded &&
          p.seat !== st.supervisorId && !(p.withdrawal && p.withdrawal.accepted));
        const committed = st.players.filter(p => p.withdrawal && p.withdrawal.accepted)
          .reduce((sum, p) => sum + (p.withdrawal.amount || 0), 0);
        const left = Math.max(0, (sup.entry || 0) - committed);
        const round = st.offersRound || 1;
        h = banner('🔁 جولة التفاوض ' + round + ' · قرار المشرّف',
          'أعد العرض حتى القناعة والرضى، أو افرش الأوراق وثبّت المعاندين');
        if (App.isLocalSeat(st.supervisorId)) {
          if (pend.length) {
            const t = pend[0], q = st.players[t];
            h += '<div class="action-title">↩️ ' + esc(q.name) + ' يطلب ' + fmt(q.counter || 0) +
              ' <small>بدل ' + fmt(st.offers[t] || 0) + '</small></div>' +
              '<div class="action-row"><button class="btn btn-teal" data-act="counter:yes" data-seat="' + t + '">قبول طلبه</button>' +
              '<button class="btn btn-outline" data-act="counter:no" data-seat="' + t + '">رفض.. وإبقاء التفاوض</button></div>';
          }
          h += '<div class="action-title">🤝 عروض جديدة للمعاندين (' + unresolved.length + ') <small>المتبقي من دخولك ' + fmt(left) + '</small></div>';
          h += unresolved.map(p => '<div class="offer-row"><span class="oname">' + esc(p.avatar) + ' ' + esc(p.name) +
            ' <small class="muted">' + esc(responseWord(p)) + ' · آخر عرض ' + fmt(st.offers[p.seat] || 0) + '</small></span>' +
            '<input type="number" min="0" max="' + left + '" value="' +
            Math.min(left, Math.max((st.offers[p.seat] || 0) + 1000, p.counter || 0)) +
            '" data-offer="' + p.seat + '" inputmode="numeric" dir="ltr" style="text-align:center"></div>').join('');
          h += '<div class="action-row" style="margin-top:8px">' +
            '<button class="btn btn-gold" data-act="offers:submit">🔁 إعادة العرض (جولة ' + (round + 1) + ')</button>' +
            '<button class="btn btn-red" data-act="neg:reveal">🃏 فرش الأوراق وتثبيت المعاندين</button></div>' +
            '<div class="market-log" id="market-log"></div>';
        } else h += '<div class="action-title">⏳ بانتظار قرار المشرّف…</div>' +
          (sup.type === 'bot' ? '<button class="btn btn-sm btn-outline" data-act="skipBot">تخطي ⏩</button>' : '');
        break;
      }
      case 'result': {
        const r = st.result;
        h = banner(r && r.void ? '🃏 جولة فارغة' : '🏆 ' + esc(r ? r.winnerName : ''),
          r && r.tieInfo ? esc(r.tieInfo) : 'الفائز يربح مبلغ دخوله فقط، وكل خاسر يخسر مبلغ دخوله');
        if (r && r.lines) h += '<div class="result-lines">' + r.settlements.slice(0, 6).map(x =>
          '<div class="result-line"><span>' + esc(x.name) + ' <small class="muted">' + esc(x.note) + '</small></span>' +
          '<b class="' + (x.delta >= 0 ? 'plus' : 'minus') + '">' + (x.delta >= 0 ? '+' : '−') + fmt(Math.abs(x.delta)) + '</b></div>').join('') + '</div>';
        h += '<div class="action-row" style="margin-top:8px"><button class="btn btn-gold" data-act="next">الجولة التالية ▶</button>' +
          '<button class="btn btn-outline" data-act="endMatch">إنهاء المباراة</button>' +
          '<button class="btn btn-sm btn-outline" data-modal="result">تفاصيل التسوية</button></div>';
        break;
      }
      case 'matchEnd':
        h = banner('🏁 انتهت المباراة', 'الترتيب النهائي حسب الرصيد') +
          '<div class="action-row"><button class="btn btn-gold" data-act="newMatch">مباراة جديدة</button>' +
          '<button class="btn btn-outline" data-nav="history">السجل والإنجازات</button></div>'; break;
    }
    box.innerHTML = h;
    renderMarket();
  }
  function banner(title, sub) { return '<div class="phase-banner">' + title + '<br><span class="muted" style="font-weight:400;font-size:10px">' + sub + '</span></div>'; }
  function responseWord(p) {
    return { accept: 'قبل العرض', reject: 'رافض', insist: 'مُصرّ على الكشف', counter: 'يفاوض' }[p.response] || 'بلا رد';
  }

  /* ------------------------------- الدردشة ---------------------------- */
  function renderChat() {
    const st = App.state;
    const msgs = (st.chat || []).map(m => ({ at: m.at, html: m.emoji
      ? '<div class="chat-msg emoji-msg"><span class="who">' + esc(m.name) + '</span><span class="chat-emoji">' + esc(m.text) + '</span></div>'
      : '<div class="chat-msg"><span class="who">' + esc(m.name) + '</span>' + esc(m.text) + '</div>' }));
    const logs = (st.log || []).map(m => ({ at: m.at || 0, html: '<div class="chat-msg sys">' + esc(m.text) + '</div>' }));
    const net = (App.netChat || []).map(m => ({ at: m.at, html: m.emoji
      ? '<div class="chat-msg emoji-msg"><span class="who">' + esc(m.name) + '</span><span class="chat-emoji">' + esc(m.text) + '</span></div>'
      : '<div class="chat-msg"><span class="who">' + esc(m.name) + '</span>' + esc(m.text) + '</div>' }));
    const all = msgs.concat(logs, net).sort((a, b) => a.at - b.at).slice(-60);
    const sig = all.length + ':' + (all.length ? all[all.length - 1].at : 0);
    if (sig === lastChatSig) return;
    lastChatSig = sig;
    el.chatLog.innerHTML = all.length ? all.map(x => x.html).join('') : '<div class="chat-msg sys">أهلاً بطاولة تجارة 👋</div>';
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }

  /* -------------------------------- المؤقت ---------------------------- */
  function updateTimer() {
    const st = App.state;
    const active = st.phase === 'negotiation' && st.negotiationEndsAt > 0;
    el.timerRing.classList.toggle('hidden', !active);
    if (!active) return;
    const remain = Math.max(0, (st.negotiationEndsAt - Date.now()) / 1000);
    const total = st.settings.negotiationSec || 1;
    el.timerNum.textContent = Math.ceil(remain);
    el.trFg.style.strokeDashoffset = String(213.6 * (1 - remain / total));
    el.trFg.classList.toggle('danger', remain <= 5);
  }

  /* ------------------------------- النوافذ ---------------------------- */
  function openModal(html, opts) {
    opts = opts || {};
    el.modalRoot.innerHTML = '<div class="modal-mask" data-mask="' + (opts.dismissible === false ? 'no' : 'yes') + '"><div class="modal">' +
      '<div class="modal-head"><h3>' + (opts.title || 'تجارة') + '</h3>' +
      (opts.dismissible === false ? '' : '<button class="icon-btn" data-act="modal:close">✕</button>') + '</div>' +
      '<div class="modal-body">' + html + '</div>' +
      (opts.foot ? '<div class="modal-foot">' + opts.foot + '</div>' : '') + '</div></div>';
  }
  function closeModal() { el.modalRoot.innerHTML = ''; App && (App.forceActionRender = true); }
  function openRules() {
    const tabs = ['الأساسيات', 'قوة الأوراق', 'السوق', 'المشرّف', 'التفاوض', 'التسوية', 'الرحمة والإيقاف', 'الأنماط والشبكة'];
    const body = [
      /* 0 */ '<div class="rule-sec"><h4>ما هي «تجارة»؟</h4><p>لعبة ورق اجتماعية لعدد <span class="hl">2 إلى 10 لاعبين</span>، تُوزّع <span class="hl">4 أوراق</span> لكل لاعب سراً من رزم تحتوي <span class="hl">J · Q · K · البنط</span>. الهدف ليس أقوى ورقة فقط، بل <span class="hl">إدارة السوق والتمويه والتفاوض</span>.</p>' +
        '<h4>مسار الجولة</h4><ul><li>يُفتح <b>السوق</b> ويدخل كل لاعب <b>مرة واحدة فقط</b> بمبلغ لا يقل عن أعلى دخول سبقه.</li><li>صاحب <b>أعلى مبلغ دخول</b> يصبح <b>المشرّف</b>.</li><li>المشرّف يختار <b>الكل مثبت</b> أو <b>عرض الانسحاب والتفاوض</b>.</li><li>تُكشف أوراق الباقين في <b>المفارشة</b> ويفوز صاحب اليد الأقوى.</li></ul>' +
        '<div class="ex">💡 لك كامل الحرية في التمويه والترهيب وإيهام الآخرين بقوة أوراقك حتى لو كانت ضعيفة.</div></div>',
      /* 1 */ '<div class="rule-sec"><h4>ترتيب البطاقات (من الأضعف للأقوى)</h4><p class="hl">J ⟶ Q ⟶ K ⟶ البنط (الأقوى)</p>' +
        '<h4>قوة اليد = الكثرة والتكرار أولاً</h4>' +
        '<table class="rank-table"><tr><th>الترتيب</th><th>اليد</th><th>مثال</th></tr>' +
        '<tr><td>1 (الأقوى)</td><td>رباعية</td><td>J J J J</td></tr>' +
        '<tr><td>2</td><td>ثلاثية</td><td>Q Q Q + بنط</td></tr>' +
        '<tr><td>3</td><td>زوجان</td><td>بنط بنط + Q Q</td></tr>' +
        '<tr><td>4</td><td>زوج واحد</td><td>K K + بنط + J</td></tr>' +
        '<tr><td>5</td><td>أوراق متفرقة</td><td>J Q K بنط</td></tr></table>' +
        '<div class="ex"><b>مثال حاسم:</b> أربع أوراق <span class="hl">J</span> أقوى من ورقتَي <span class="hl">بنط</span> + ورقتَي <span class="hl">Q</span>، لأن الرباعية تتفوق على الزوجين مهما علت رتبة الأوراق.</div>' +
        '<p>داخل الفئة الواحدة تُحسم المقارنة برتبة المجموعة ثم بالأوراق المرافقة (الكيكرز) تنازلياً. عند <b>التعادل التام</b> يُحسم تلقائياً لصالح صاحب أعلى مبلغ دخول، ثم المقعد الأسبق.</p></div>',
      /* 2 */ '<div class="rule-sec"><h4>السوق: دخول واحد + حد أدنى</h4><ul>' +
        '<li>ينظر كل لاعب لأوراقه <b>سراً</b>، ويبدأ <b>العرض الأولي بلاعب عشوائي</b> في الجولة الأولى، ثم ينتقل الدور <b>بالترتيب</b> في الجولات التالية.</li>' +
        '<li><span class="hl">لكل لاعب دخول واحد فقط في الجولة</span>: لا دورات رفع إضافية ولا عودة لمن دخل أو مرّر. بعد آخر لاعب يُغلق السوق فوراً.</li>' +
        '<li><span class="hl">الحد الأدنى للدخول = أعلى مبلغ دخل به لاعب قبلك</span>. لا يصح أن يدخل من بعده بأقل منه؛ وإن حاول يُرفع دخوله تلقائياً إلى الحد الأدنى. الدخول بمساوٍ له مسموح، وبأعلى منه بلا سقف سوى رصيدك.</li>' +
        '<li><span class="hl">الاستثناء الوحيد</span>: إن لم يكن في رصيدك أكثر من الحد الأدنى، <b>تدخل بكامل رصيدك</b> (حتى لو كان أقل).</li>' +
        '<li>يحق دخول مبالغ كبيرة لاستدراج «الهوامير» ثم مباغتتهم برفض المفاوضات وهزيمتهم = <b>الإطاحة بالهوامير</b>.</li>' +
        '<li>الدخول بـ <b>صفر</b> مسموح إن لم يسبقك أحد بمبلغ، وكذلك التمرير أو الانسحاب دون خسارة.</li>' +
        '<li>تُدمج الرزم تلقائياً: رزمة لـ 2–4 لاعبين، رزمتان لـ 5–8، ثلاث رزم لـ 9–10، فلا تنقص الأوراق أبداً.</li></ul></div>',
      /* 3 */ '<div class="rule-sec"><h4>دور المشرّف</h4><p>اللاعب صاحب <span class="hl">أعلى مبلغ دخول</span> في السوق. يختار أحد المسارين:</p>' +
        '<h4>1) الكل مثبت 🔒</h4><p>يُجبر جميع الداخلين على كشف أوراقهم، ويفوز صاحب اليد الأقوى <b>حتى لو لم يكن المشرّف أو صاحب أعلى مبلغ</b>.</p>' +
        '<h4>2) عرض الانسحاب والتفاوض 🤝</h4><p>يعرض المشرّف على كل داخل مبلغاً للانسحاب <b>من إجمالي المبلغ الذي دخل به</b> (حتى لو كان 0). لكل لاعب: <b>قبول</b>، <b>رفض</b>، <b>تفاوض</b> على مبلغ يحدده، أو <b>الإصرار على الرفض</b> وطلب كشف الأوراق، ضمن وقت كل جولة، ويمكن إعادة العرض أكثر من مرة.</p></div>',
      /* 4 */ '<div class="rule-sec"><h4>التفاوض المتكرر حتى الرضى</h4><ul>' +
        '<li>وقت التفاوض قابل للتحديد قبل المباراة: 10 / 15 / 20 / 30 ثانية أو <b>مفتوح</b>، ويُحتسب <b>لكل جولة تفاوض</b> على حدة.</li>' +
        '<li>من لا يرد قبل انتهاء وقت الجولة يُعتبر <b>مُصرّاً على الرفض</b>، ولا يُكشف ورقه فوراً بل يبقى بانتظار قرار المشرّف.</li>' +
        '<li><span class="hl">التفاوض لا ينتهي بجولة واحدة</span>: بعد ردود الجميع يختار المشرّف <b>إعادة عرض مبالغ جديدة</b> على المعاندين (جولة ثانية وثالثة وهكذا) <b>حتى الوصول إلى قناعة ورضى</b>، أو <b>فرش الأوراق وتثبيت المعاندين</b> في أي لحظة.</li>' +
        '<li>التفاوض المضاد: يعرض اللاعب مبلغاً جديداً، وللمشرّف <b>القبول</b> (ينسحب اللاعب بالمبلغ الجديد) أو <b>الرفض</b> مع إمكانية إعادة العرض بدلاً من إنهاء الجولة.</li>' +
        '<li>مجموع كل العروض المقبولة لا يتجاوز <b>إجمالي ما دخل به المشرّف</b> (وقد يكون 0).</li>' +
        '<li>إذا قبل اللاعب العرض فلا يُعطى المبلغ <b>إلا إذا فاز المشرّف في المفارشة</b>. أمّا إذا خسر المشرّف فلا يخسر المنسحب من قِبل عرضه، لكنه <b>لا يربح شيئاً</b>.</li>' +
        '<li>عبارات سريعة بنقرة واحدة: ' + T.QUICK_PHRASES.map(esc).join(' · ') + '</li></ul></div>',
      /* 5 */ '<div class="rule-sec"><h4>التسوية المالية الدقيقة</h4><ul>' +
        '<li>كل <b>خاسر</b> يخسر المبلغ الذي <b>دخل به هو</b> السوق، ويُخصم من رصيده.</li>' +
        '<li><b>الفائز يربح فقط المبلغ الذي دخل به هو</b> من أرصدة الخاسرين (لا مجموع ما دخلوه).</li>' +
        '<li>المنسحب بعرض: لا يخسر دخوله؛ ويأخذ عرضه فقط إن فاز المشرّف (ويُخصم من رصيد المشرّف).</li></ul>' +
        '<div class="ex"><b>مثال عملي:</b> بدأ الجميع بـ 50,000. دخل <b>صالح</b> بـ 5,000 ثم <b>أحمد</b> بـ 10,000 ثم <b>علي</b> بـ 20,000 (كل لاعب مرة واحدة، والدخول غير متناقص)، فاز صالح:<br>' +
        'صالح <span class="hl">55,000</span> · علي <span class="hl">30,000</span> · أحمد <span class="hl">40,000</span></div></div>',
      /* 6 */ '<div class="rule-sec"><h4>الإفلاس والرحمة</h4><p>إذا نفد رصيد لاعب بالكامل يحصل تلقائياً على <span class="hl">5,000 «رحمة»</span> للاستمرار، و<b>تمنح مرة واحدة فقط في المباراة</b>.</p>' +
        '<h4>الإيقاف</h4><p>إذا خسر «الرحمة» أيضاً (أو نفد رصيده بعد استنفادها) فلا رحمة له، ويُعاقب <span class="hl">بالإيقاف 3 جولات كاملة</span> لا يستلم فيها أوراقاً ولا يشارك في السوق. يعود بعدها للطاولة برصيده المتبقي.</p>' +
        '<div class="ex">يُسجّل في السجل: مرات الرحمة، مرات الإيقاف، الإطاحة بالهوامير، أكبر ربح وأكبر خسارة.</div></div>',
      /* 7 */ '<div class="rule-sec"><h4>أنماط اللعب</h4><ul>' +
        '<li><b>فردي ضد البوتات</b>: ستة مستويات من «سهل جداً» إلى «أسطوري» مع 8 شخصيات (الهوّامير، المراوغ، المفاوض، المحافظ، المتهور، القنّاص، الهادي، الزعيم).</li>' +
        '<li><b>محلياً على جهاز واحد</b>: تسليم الجهاز بين اللاعبين مع إخفاء الأوراق.</li>' +
        '<li><b>الشبكة المحلية / الواي فاي / الإنترنت</b>: غرف برمز، دردشة، إيموجيات، ومايك عبر WebRTC. البلوتوث يُستخدم عبر نقطة اتصال مشتركة.</li>' +
        '<li><b>الأصدقاء</b>: طلبات صداقة وقبولها، دعوة لمنافسة فردية 1 ضد 1 أو جماعية.</li></ul>' +
        '<h4>السجل والإنجازات</h4><p>تاريخ المباريات والنتائج، أكبر ربح/خسارة، الإطاحات، الرحمة والإيقاف، وأوسمة قابلة للفتح بنسب إنجاز: قاطع رؤوس الهوامير، ملك المفاوضات، ناجي الرحمة، ثبات بلا تردد، زعيم الطاولة…</p></div>'
    ];
    const html = '<div class="rule-tabs">' + tabs.map((t, i) => '<button class="' + (i === rulesTab ? 'on' : '') + '" data-act="rules:tab" data-i="' + i + '">' + t + '</button>').join('') + '</div>' + body[rulesTab];
    openModal(html, { title: '📜 القوانين وطريقة اللعب', foot: '<button class="btn btn-gold" data-act="modal:close">فهمت، لنلعب!</button>' });
  }
  function openResult() {
    const r = App.state.result;
    if (!r) return;
    let h = '';
    if (r.void) h = '<div class="result-hero"><div class="trophy">🃏</div><h3>جولة فارغة</h3><p>لم يدخل أحد السوق، لا ربح ولا خسارة.</p></div>';
    else {
      h = '<div class="result-hero"><div class="trophy">🏆</div><h3>' + esc(r.winnerName) + ' فاز بالجولة</h3>' +
        '<p>' + (r.byReveal ? 'بعد المفارشة وكشف الأوراق' : 'بانسحاب بقية الداخلين') + ' · ربح ' + fmt(r.winnerGain) + '</p>' +
        (r.tieInfo ? '<p style="color:var(--gold)">' + esc(r.tieInfo) + '</p>' : '') + '</div>';
      if (r.contenders && r.contenders.length > 1) {
        h += '<div class="section-title">🃏 الأوراق المكشوفة</div><div class="reveal-hands">';
        for (const seat of r.contenders) {
          const p = App.state.players[seat], ev = r.evaluations[seat];
          h += '<div class="reveal-hand ' + (seat === r.winnerId ? 'win' : '') + '"><small>' + esc(p.name) + (seat === r.winnerId ? ' 👑' : '') + '</small>' +
            '<b>' + esc(ev ? ev.categoryName : '') + '</b><div class="mini-cards">' +
            (p.hand || []).map(c => '<i class="' + (c.rank === 'B' ? 'b' : '') + '">' + (c.rank === 'B' ? 'ب' : esc(c.rank)) + '</i>').join('') + '</div></div>';
        }
        h += '</div>';
      }
      h += '<div class="section-title">💰 التسوية</div><div class="result-lines">' + r.settlements.map(x =>
        '<div class="result-line"><span>' + esc(x.name) + ' <small class="muted">' + esc(x.note) + '</small></span>' +
        '<b class="' + (x.delta >= 0 ? 'plus' : 'minus') + '">' + (x.delta >= 0 ? '+' : '−') + fmt(Math.abs(x.delta)) + '</b></div>').join('') + '</div>';
    }
    openModal(h, { title: 'نتيجة الجولة ' + App.state.round, foot: '<button class="btn btn-gold" data-act="next">الجولة التالية ▶</button><button class="btn btn-outline" data-act="modal:close">إغلاق</button>' });
  }
  function openMatchEnd() {
    const m = App.state.matchSummary;
    if (!m) return;
    let h = '<div class="result-hero"><div class="trophy">🏁</div><h3>انتهت المباراة</h3><p>' + m.rounds + ' جولة · ' + m.players + ' لاعبين</p></div>' +
      '<div class="section-title">🏆 الترتيب النهائي</div>';
    h += m.ranking.map(x => '<div class="result-line"><span>' + x.rank + '. ' + esc(x.name) + ' <small class="muted">' + x.wins + ' فوز</small></span><b class="plus">' + fmt(x.balance) + '</b></div>').join('');
    h += '<div class="section-title">📊 حصيلة المباراة</div><div class="stat-grid">' +
      cell(fmt(m.biggestWin), 'أكبر ربح') + cell(fmt(m.biggestLoss), 'أكبر خسارة') +
      cell(m.whaleTakedowns, 'إطاحات') + cell(m.mercy, 'رحمة') + cell(m.suspensions, 'إيقاف') + cell(m.rounds, 'جولات') + '</div>';
    openModal(h, { title: 'نهاية المباراة', foot: '<button class="btn btn-gold" data-act="newMatch">مباراة جديدة</button><button class="btn btn-outline" data-nav="history">السجل والإنجازات</button>' });
  }
  function openPrivacy(seat, shown) {
    const p = App.state.players[seat];
    const cards = (p.hand || []).map(c => '<div class="pcard ' + (c.rank === 'B' ? 'bint' : '') + '"><span class="corner">' + (c.rank === 'B' ? 'بنط' : c.rank) + '</span><span class="rank">' + (c.rank === 'B' ? 'بنط' : c.rank) + '</span><span class="suit">' + esc(c.suit) + '</span></div>').join('');
    const html = '<div class="privacy-card">' +
      (shown ? '<div class="big">👀</div><h3>أوراق ' + esc(p.name) + '</h3><div class="hand" style="margin:12px 0">' + cards + '</div>' +
        '<p class="muted">احفظها في ذاكرتك ثم اخفها وسلّم الجهاز للاعب التالي.</p>'
        : '<div class="big">🤫</div><h3>سلّم الجهاز إلى ' + esc(p.name) + '</h3><p class="muted">تأكد أن لا أحد يرى الشاشة قبل المتابعة.</p>') +
      '</div>';
    openModal(html, {
      title: '🔒 خصوصية الأوراق', dismissible: false,
      foot: shown ? '<button class="btn btn-gold" data-act="privacy:hide">أخفيت الأوراق ✓</button>'
        : '<button class="btn btn-gold" data-act="privacy:show">أنا ' + esc(p.name) + '.. اعرض أوراقي</button>'
    });
  }
  function openHandoff(seat) {
    const p = App.state.players[seat];
    openModal('<div class="privacy-card"><div class="big">📱</div><h3>سلّم الجهاز إلى ' + esc(p.name) + '</h3>' +
      '<p class="muted">دوره الآن في السوق. لا تعرض أوراقه أمام بقية اللاعبين.</p></div>', {
      title: 'تسليم الدور', dismissible: false,
      foot: '<button class="btn btn-gold" data-act="handoff:ok">أنا ' + esc(p.name) + '، تفضّل</button>'
    });
  }
  function openAbout() {
    openModal('<div class="rule-sec" style="text-align:center"><div style="font-size:54px">🃏</div><h3 style="font-size:22px;color:var(--gold-2)">تِجَارَة</h3>' +
      '<p>لعبة ورق اجتماعية عربية · الإصدار 1.0</p><p class="muted">محرك قواعد كامل، بوتات بشخصيات ومستويات، تفاوض بوقت محدد، تسوية مالية دقيقة، رحمة وإيقاف، دردشة وإيموجيات ومايك، سجل وإنجازات، وغرف لعب على الشبكة.</p>' +
      '<p class="muted" style="margin-top:10px">تعمل بالكامل دون إنترنت داخل تطبيق أندرويد. صُنعت بعناية لتجربة سلسة وحماسية.</p></div>',
      { title: 'ℹ️ عن اللعبة', foot: '<button class="btn btn-gold" data-act="modal:close">حسناً</button>' });
  }
  function openConfirm(text, actId) {
    openModal('<p style="text-align:center;font-size:14px">' + esc(text) + '</p>', {
      title: '⚠️ تأكيد', foot: '<button class="btn btn-red" data-act="' + actId + '">نعم، متابعة</button><button class="btn btn-outline" data-act="modal:close">إلغاء</button>'
    });
  }
  function openAchievements(list) {
    if (!list || !list.length) return;
    openModal('<div style="text-align:center"><div style="font-size:56px">🏅</div><h3 style="color:var(--gold-2);font-size:20px">وسام جديد!</h3>' +
      list.map(a => '<div class="result-line" style="margin:8px 0"><span>' + a.icon + ' <b>' + esc(a.name) + '</b></span><small class="muted">' + esc(a.cat) + '</small></div>').join('') +
      '<p class="muted">تابع اللعب لفتح المزيد من الأوسمة في قسم السجل والإنجازات.</p></div>',
      { title: 'تهانينا', foot: '<button class="btn btn-gold" data-act="modal:close">🎉 رائع</button>' });
  }

  /* ---------------------------- ربط الأحداث --------------------------- */
  function bindEvents() {
    doc.addEventListener('click', onClick);
    doc.addEventListener('change', onChange);
    doc.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        if (e.target.id === 'chat-text') { App.sendChat(); e.preventDefault(); }
        if (e.target.id === 'bid-amount') { onClick({ target: { closest: () => ({ dataset: { act: 'bid:enter' } }) } }); e.preventDefault(); }
        if (e.target.id === 'room-code-input') { onClick({ target: { closest: () => ({ dataset: { act: 'net:join' } }) } }); e.preventDefault(); }
      }
      if (e.key === 'Escape') closeModal();
    });
  }
  function onClick(ev) {
    const t = ev.target;
    if (!t) return;
    if (t.classList && t.classList.contains('modal-mask') && t.dataset.mask === 'yes') { closeModal(); return; }
    const b = t.closest && t.closest('[data-act],[data-nav],[data-modal]');
    if (!b) return;
    AU.unlock();
    if (b.dataset.nav) {
      const quick = b.dataset.quick;
      closeModal();
      if (quick) { App.quickStart(); } else go(b.dataset.nav);
      return;
    }
    if (b.dataset.modal) {
      const m = b.dataset.modal;
      if (m === 'rules') { rulesTab = 0; openRules(); }
      else if (m === 'result') openResult();
      else if (m === 'about') openAbout();
      else if (m === 'confirm-clear') openConfirm('سيتم مسح السجل والإنجازات والإعدادات والأصدقاء والمباراة المحفوظة. هل أنت متأكد؟', 'confirm:clear');
      return;
    }
    const act = b.dataset.act, d = b.dataset;
    switch (act) {
      case 'modal:close': closeModal(); break;
      case 'confirm:clear': App.clearData(); closeModal(); go('home'); FX.toast('تم مسح البيانات', 'good'); break;
      case 'toggle': App.setSetting(d.key, !App.settings[d.key]); renderSettings(); renderSetup(); break;
      case 'players': App.setPlayers(+d.n); renderSetup(); AU.play('tap'); break;
      case 'balance': App.setSetting('startBalance', +d.v); renderSetup(); AU.play('chip'); break;
      case 'neg': App.setSetting('negotiationSec', +d.v); renderSetup(); AU.play('tap'); break;
      case 'difficulty': App.setSetting('difficulty', d.v); App.applyDifficultyToSeats(d.v); renderSetup(); AU.play('tap'); break;
      case 'seat-type': App.toggleSeatType(+d.i); renderSetup(); AU.play('tap'); break;
      case 'rules:tab': rulesTab = +d.i; openRules(); AU.play('tap'); break;
      case 'viewer': App.setViewer(+d.seat); render(); break;

      case 'privacy:start': App.privacyStart(); break;
      case 'privacy:show': App.privacyShow(); break;
      case 'privacy:hide': App.privacyHide(); break;
      case 'handoff:ok': App.handoffDone(); break;

      case 'bid:preset': { const inp = $('bid-amount'); if (inp) inp.value = d.v; AU.play('chip'); break; }
      case 'bid:plus1': { const inp = $('bid-amount'); if (inp) inp.value = (App.state.auction.leaderId === null ? 0 : App.state.auction.highest) + 1; AU.play('raise'); break; }
      case 'bid:allin': { const inp = $('bid-amount'); const who = App.state.players[App.currentActorSeat()]; if (inp && who) inp.value = who.balance; AU.play('raise'); break; }
      case 'bid:enter': { const inp = $('bid-amount'); App.act({ type: 'bid', seat: App.currentActorSeat(), kind: 'enter', amount: inp ? inp.value : 0 }); break; }
      case 'bid:pass': App.act({ type: 'bid', seat: App.currentActorSeat(), kind: 'pass' }); break;
      case 'bid:fold': App.act({ type: 'bid', seat: App.currentActorSeat(), kind: 'fold' }); break;
      case 'sup:fix': App.act({ type: 'supervisor:choose', seat: App.state.supervisorId, mode: 'fix' }); break;
      case 'sup:neg': App.act({ type: 'supervisor:choose', seat: App.state.supervisorId, mode: 'negotiate' }); break;
      case 'offers:equal': {
        const sup = App.state.players[App.state.supervisorId];
        const inputs = Array.from(doc.querySelectorAll('[data-offer]'));
        const each = Math.floor(Math.max(0, sup.entry || 0) / Math.max(1, inputs.length));
        inputs.forEach(i => i.value = each); AU.play('chip'); break;
      }
      case 'offers:submit': {
        const offers = {};
        doc.querySelectorAll('[data-offer]').forEach(i => { offers[i.dataset.offer] = i.value; });
        App.act({ type: 'offers:submit', seat: App.state.supervisorId, offers: offers }); break;
      }
      case 'resp:accept': App.respond(+d.seat, 'accept'); break;
      case 'resp:reject': App.respond(+d.seat, 'reject'); break;
      case 'resp:insist': App.respond(+d.seat, 'insist'); break;
      case 'resp:counter': { const inp = $('counter-amount'); App.respond(+d.seat, 'counter', inp ? inp.value : 0); break; }
      case 'counter:yes': App.act({ type: 'counter:decide', seat: App.state.supervisorId, target: +d.seat, accept: true }); break;
      case 'counter:no': App.act({ type: 'counter:decide', seat: App.state.supervisorId, target: +d.seat, accept: false }); break;
      case 'neg:reveal': App.act({ type: 'negotiation:reveal', seat: App.state.supervisorId }); break;
      case 'timer:force': App.forceTimeout(); break;
      case 'skipBot': App.skipBot(); break;
      case 'next': closeModal(); App.act({ type: 'next' }); break;
      case 'endMatch': App.act({ type: 'endMatch' }); break;
      case 'newMatch': closeModal(); go('setup'); break;

      case 'phrase': App.sendChat(d.text); break;
      case 'emoji': App.sendEmoji(d.emoji); break;
      case 'sendChat': App.sendChat(); break;
      case 'mic': App.toggleMic(); break;
      case 'chatToggle': el.side.classList.toggle('open'); break;
      case 'sideClose': el.side.classList.remove('open'); break;
      case 'tableView': App.setSetting('tableView', App.settings.tableView === 'table' ? 'list' : 'table'); render(); break;
      case 'exitGame': openConfirm('الخروج من الطاولة؟ ستبقى المباراة محفوظة ويمكن متابعتها.', 'confirm:exit'); break;
      case 'confirm:exit': closeModal(); App.persist(); go('home'); break;
      case 'clearHistory': openConfirm('مسح تاريخ المباريات والأوسمة؟', 'confirm:clearhistory'); break;
      case 'confirm:clearhistory': App.clearHistory(); closeModal(); renderHistory(); break;

      case 'net:connect': App.connect(($('net-url') || {}).value); break;
      case 'net:disconnect': App.disconnect(); renderFriends(); break;
      case 'net:create': App.createRoom(); break;
      case 'net:join': App.joinRoom(($('room-code-input') || {}).value); break;
      case 'net:leave': App.leaveRoom(); renderFriends(); break;
      case 'net:start': App.startRoomMatch(); break;
      case 'friend:add': App.addFriend(($('friend-name') || {}).value, ($('friend-code') || {}).value); renderFriends(); break;
      case 'friend:accept': S.acceptFriend(d.id); renderFriends(); FX.toast('تم قبول الصديق', 'good'); break;
      case 'friend:remove': S.removeFriend(d.id); renderFriends(); break;
      case 'friend:invite1': App.invite(d.id, 2); break;
      case 'friend:inviteGroup': App.invite(d.id, Math.max(3, App.settings.players)); break;
    }
  }
  function onChange(ev) {
    const t = ev.target;
    if (!t || !t.dataset) return;
    if (t.dataset.field) {
      let v = t.value;
      if (['startBalance', 'maxRounds', 'negotiationSec', 'players'].includes(t.dataset.field)) v = Number(v);
      if (['sfxVolume', 'musicVolume'].includes(t.dataset.field)) v = Number(v);
      App.setSetting(t.dataset.field, v);
      if (t.dataset.field === 'players') { App.setPlayers(v); renderSetup(); }
      if (t.dataset.field === 'startBalance' || t.dataset.field === 'negotiationSec' || t.dataset.field === 'maxRounds') renderSetup();
      if (['sfxVolume', 'musicVolume', 'sound', 'music', 'vibration', 'effects'].includes(t.dataset.field)) App.applyAudioSettings();
      return;
    }
    if (t.dataset.seatName !== undefined) { App.setSeat(+t.dataset.seatName, { name: t.value }); return; }
    if (t.dataset.seatDiff !== undefined) { App.setSeat(+t.dataset.seatDiff, { difficulty: t.value }); return; }
    if (t.dataset.seatPerson !== undefined) { App.setSeat(+t.dataset.seatPerson, { personality: t.value }); return; }
  }

  root.TijaraUI = {
    init: init, go: go, render: render, renderActions: renderActions, renderChat: renderChat,
    renderSetup: renderSetup, renderSettings: renderSettings, renderHistory: renderHistory,
    renderFriends: renderFriends, renderHome: renderHome, updateTimer: updateTimer,
    openModal: openModal, closeModal: closeModal, openRules: openRules, openResult: openResult,
    openMatchEnd: openMatchEnd, openPrivacy: openPrivacy, openHandoff: openHandoff,
    openAchievements: openAchievements, openAbout: openAbout, toast: (t, k) => FX.toast(t, k),
    resetActionSig: () => { actionSig = ''; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
