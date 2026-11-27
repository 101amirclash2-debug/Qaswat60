/* ==========================================================================
   تجارة — المؤثرات البصرية: قصاصات ذهبية، إيموجيات طائرة، إشعارات، اهتزاز
   ========================================================================== */
(function (root) {
  'use strict';
  const doc = root.document;
  let canvas, ctx, particles = [], raf = null, dpr = 1;
  const COLORS = ['#e9c46a', '#ffe9ae', '#35d6b0', '#6ee7de', '#ffffff', '#ff6f6f', '#c99b3c'];

  function init() {
    canvas = doc.getElementById('fx-canvas');
    if (!canvas) return;
    try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) return;                       // بيئات بلا Canvas (اختبارات)
    resize();
    root.addEventListener('resize', resize);
  }
  function resize() {
    if (!canvas || !ctx) return;
    dpr = Math.min(2, root.devicePixelRatio || 1);
    canvas.width = Math.floor(root.innerWidth * dpr);
    canvas.height = Math.floor(root.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function loop() {
    if (!ctx) return;
    ctx.clearRect(0, 0, root.innerWidth, root.innerHeight);
    particles = particles.filter(p => p.life > 0);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.992;
      p.rot += p.vr; p.life -= 1;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.life / 30);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.s, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    }
    if (particles.length) raf = root.requestAnimationFrame(loop);
    else { raf = null; ctx.clearRect(0, 0, root.innerWidth, root.innerHeight); }
  }
  function kick() { if (!raf && ctx) raf = root.requestAnimationFrame(loop); }

  function confetti(count, origin) {
    if (!ctx || !root.TijaraStore.settings().effects) return;
    count = count || 90;
    const ox = origin ? origin.x : root.innerWidth / 2;
    const oy = origin ? origin.y : root.innerHeight * 0.38;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 7;
      particles.push({
        x: ox + (Math.random() - 0.5) * 60, y: oy + (Math.random() - 0.5) * 30,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 3,
        g: 0.13 + Math.random() * 0.08, s: 4 + Math.random() * 7,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
        life: 70 + Math.random() * 70, c: COLORS[(Math.random() * COLORS.length) | 0],
        round: Math.random() < 0.25
      });
    }
    kick();
  }
  function goldRain() {
    if (!ctx) return;
    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * root.innerWidth, y: -20 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 1.2, vy: 1.5 + Math.random() * 2.5,
        g: 0.02, s: 3 + Math.random() * 5, rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.2, life: 160 + Math.random() * 90,
        c: COLORS[(Math.random() * 3) | 0], round: true
      });
    }
    kick();
  }
  function emoji(symbol, x, y, big) {
    const layer = doc.getElementById('emoji-layer');
    if (!layer) return;
    // الإيموجيات متحركة دائماً، حتى لو عُطّلت المؤثرات الإضافية في الإعدادات
    const count = big ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const el = doc.createElement('div');
      el.className = 'float-emoji' + (i === 0 ? ' main' : ' spark');
      el.textContent = symbol;
      const dx = Math.round((Math.random() - 0.5) * 140);
      const dy = -(190 + Math.random() * 70);
      const ox = i ? Math.round((Math.random() - 0.5) * 70) : 0;
      const oy = i ? Math.round((Math.random() - 0.5) * 26) : 0;
      el.style.fontSize = Math.max(17, (big ? 54 : 40) - i * 7) + 'px';
      el.style.left = Math.max(4, Math.min(root.innerWidth - 48, x - 22 + ox)) + 'px';
      el.style.top = Math.max(4, Math.min(root.innerHeight - 48, y - 22 + oy)) + 'px';
      el.style.setProperty('--dx', dx + 'px');
      el.style.animationDelay = (i * 95) + 'ms';
      layer.appendChild(el);
      // حركة مضمونة عبر Web Animations API حتى لو لم تُطبّق أنيميشن CSS في WebView
      if (typeof el.animate === 'function') {
        try {
          el.animate([
            { opacity: 0, transform: 'translate(0px,0px) scale(.3) rotate(-25deg)' },
            { opacity: 1, transform: 'translate(0px,-28px) scale(1.3) rotate(14deg)', offset: 0.16 },
            { opacity: 1, transform: 'translate(' + (dx * 0.5) + 'px,-115px) scale(1.05) rotate(190deg)', offset: 0.62 },
            { opacity: 0, transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.75) rotate(375deg)' }
          ], { duration: 2050 + i * 130, easing: 'cubic-bezier(.22,.8,.3,1)', fill: 'forwards' });
          el.style.animation = 'none';     // WAAPI يتولى الحركة، وتبقى حلقة ::after عبر CSS
        } catch (e) { /* يبقى أنيميشن CSS بديلاً */ }
      }
      setTimeout(() => el.remove(), 2700 + i * 130);
    }
  }
  function emojiAtSeat(symbol, seat, big) {
    const el = doc.querySelector('.seat[data-seat="' + seat + '"] .seat-avatar') ||
               doc.querySelector('.list-seat[data-seat="' + seat + '"]');
    if (el) {
      const r = el.getBoundingClientRect();
      emoji(symbol, r.left + r.width / 2, r.top + r.height / 2, big);
    } else emoji(symbol, root.innerWidth / 2, root.innerHeight / 2, big);
    // فقاعة على المقعد
    const av = doc.querySelector('.seat[data-seat="' + seat + '"] .seat-avatar');
    if (av) {
      const b = doc.createElement('span');
      b.className = 'seat-emoji animated'; b.textContent = symbol;
      av.appendChild(b); setTimeout(() => b.remove(), 2600);
    }
  }
  function toast(text, type) {
    const host = doc.getElementById('toasts');
    if (!host) return;
    const el = doc.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 3200);
    if (host.children.length > 4) host.firstChild.remove();
  }
  function flash() {
    const el = doc.createElement('div');
    el.className = 'gold-flash'; doc.body.appendChild(el);
    setTimeout(() => el.remove(), 850);
  }
  function shake(el) {
    el = el || doc.getElementById('app');
    if (!el) return;
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 450);
  }

  root.TijaraFX = { init: init, confetti: confetti, goldRain: goldRain, emoji: emoji, emojiAtSeat: emojiAtSeat, toast: toast, flash: flash, shake: shake };
})(typeof globalThis !== 'undefined' ? globalThis : this);
