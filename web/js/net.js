/* ==========================================================================
   تجارة — طبقة الشبكة: غرف WebSocket (محلي/إنترنت) + صوت WebRTC
   البروتوكول متطابق مع server/server.mjs
   ========================================================================== */
(function (root) {
  'use strict';
  const doc = root.document;

  class Network {
    constructor() {
      this.ws = null;
      this.peerId = null;
      this.code = null;
      this.isHost = false;
      this.name = 'لاعب';
      this.peers = [];
      this.url = '';
      this.status = 'offline';
      this.handlers = {};
      this.reconnectTimer = null;
      this.voice = { enabled: false, stream: null, pcs: {}, audios: {}, pendingIce: {} };
      this.stats = { rooms: 0 };
    }
    on(evt, fn) { (this.handlers[evt] || (this.handlers[evt] = [])).push(fn); return this; }
    emit(evt, data) { (this.handlers[evt] || []).forEach(fn => { try { fn(data); } catch (e) { console.warn(e); } }); }
    setStatus(s) { this.status = s; this.emit('status', s); }

    normalizeUrl(input) {
      let u = String(input || '').trim();
      if (!u) return '';
      if (!/^wss?:\/\//i.test(u)) {
        if (/^https?:\/\//i.test(u)) u = u.replace(/^http/i, 'ws');
        else u = 'ws://' + u;
      }
      if (!/\/ws\/?$/.test(u)) u = u.replace(/\/+$/, '') + '/ws';
      return u;
    }
    connect(url, name) {
      const u = this.normalizeUrl(url);
      if (!u) { this.setStatus('offline'); return Promise.reject(new Error('عنوان الخادم مطلوب')); }
      this.url = u; this.name = name || this.name;
      this.disconnect(false);
      this.setStatus('connecting');
      return new Promise((resolve, reject) => {
        let ws;
        try { ws = new root.WebSocket(u); } catch (e) { this.setStatus('offline'); return reject(e); }
        this.ws = ws;
        const settled = (ok, data) => { if (ok) resolve(data); else reject(data); };
        let done = false;
        ws.onopen = () => {
          this.setStatus('online');
          this.send({ t: 'hello', name: this.name });
        };
        ws.onmessage = (ev) => {
          let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.t === 'welcome') {
            this.peerId = m.peerId;
            if (!done) { done = true; settled(true, m); }
            this.emit('welcome', m);
          } else this._handle(m);
        };
        ws.onerror = () => { if (!done) { done = true; settled(false, new Error('تعذّر الاتصال بالخادم')); } };
        ws.onclose = () => {
          this.setStatus('offline');
          this.emit('close');
          if (!done) { done = true; settled(false, new Error('أُغلق الاتصال')); }
        };
        setTimeout(() => { if (!done) { done = true; settled(false, new Error('انتهت مهلة الاتصال')); } }, 8000);
      });
    }
    disconnect(clear = true) {
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch (e) {} }
      this.ws = null;
      if (clear) { this.code = null; this.isHost = false; this.peers = []; }
      this.setStatus('offline');
    }
    send(obj) {
      if (!this.ws || this.ws.readyState !== 1) return false;
      try { this.ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    }
    _handle(m) {
      switch (m.t) {
        case 'room:created':
          this.code = m.code; this.isHost = true; this.peers = [];
          this.emit('room', m); break;
        case 'room:joined':
          this.code = m.code; this.isHost = false;
          this.emit('room', m); break;
        case 'peer:list':
          this.peers = m.peers || [];
          this.emit('peers', this.peers);
          break;
        case 'peer:join': this.emit('peer:join', m); break;
        case 'peer:left': this.emit('peer:left', m); this._closeVoice(m.peerId); break;
        case 'action': this.emit('action', m); break;
        case 'state': this.emit('state', m.state); break;
        case 'chat': this.emit('chat', m); break;
        case 'emoji': this.emit('emoji', m); break;
        case 'signal': this._signal(m.from, m.data); break;
        case 'voice:state': this.emit('voice:state', m); break;
        case 'error': this.emit('error', m); break;
        case 'pong': break;
        default: this.emit('raw', m);
      }
    }

    /* ------------------------------ الغرف ----------------------------- */
    createRoom(settings, name) { return this.send({ t: 'room:create', name: name || this.name, settings: settings || {} }); }
    joinRoom(code, name) { return this.send({ t: 'room:join', code: String(code || '').toUpperCase(), name: name || this.name }); }
    leaveRoom() { this.send({ t: 'room:leave' }); this.code = null; this.isHost = false; }
    broadcastState(views) { return this.send({ t: 'state', views: views }); }
    sendAction(action) { return this.send({ t: 'action', action: action }); }
    sendChat(text, seat, name, avatar) { return this.send({ t: 'chat', text: text, seat: seat, name: name, avatar: avatar }); }
    sendEmoji(emoji, seat, name) { return this.send({ t: 'emoji', emoji: emoji, seat: seat, name: name }); }

    /* ------------------------- الصوت (WebRTC) ------------------------- */
    rtcConfig() {
      return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    }
    async enableMic() {
      if (!root.navigator.mediaDevices || !root.navigator.mediaDevices.getUserMedia) {
        throw new Error('المتصفح لا يدعم التقاط الصوت');
      }
      const stream = await root.navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false
      });
      this.voice.enabled = true; this.voice.stream = stream;
      this.send({ t: 'voice:state', on: true });
      for (const p of this.peers) {
        if (p.peerId !== this.peerId && this.peerId < p.peerId) this._offer(p.peerId);
      }
      this.emit('voice', true);
      return stream;
    }
    disableMic() {
      if (this.voice.stream) this.voice.stream.getTracks().forEach(t => t.stop());
      this.voice.stream = null; this.voice.enabled = false;
      for (const id in this.voice.pcs) { try { this.voice.pcs[id].close(); } catch (e) {} }
      this.voice.pcs = {};
      for (const id in this.voice.audios) { try { this.voice.audios[id].remove(); } catch (e) {} }
      this.voice.audios = {};
      this.send({ t: 'voice:state', on: false });
      this.emit('voice', false);
    }
    _pc(peerId) {
      if (this.voice.pcs[peerId]) return this.voice.pcs[peerId];
      if (!root.RTCPeerConnection) return null;
      const pc = new root.RTCPeerConnection(this.rtcConfig());
      this.voice.pcs[peerId] = pc;
      if (this.voice.stream) this.voice.stream.getTracks().forEach(t => pc.addTrack(t, this.voice.stream));
      pc.onicecandidate = (e) => {
        if (e.candidate) this.send({ t: 'signal', to: peerId, data: { kind: 'ice', candidate: e.candidate } });
      };
      pc.ontrack = (e) => {
        let a = this.voice.audios[peerId];
        if (!a) {
          a = doc.createElement('audio'); a.autoplay = true; a.setAttribute('playsinline', '');
          a.style.display = 'none'; doc.body.appendChild(a); this.voice.audios[peerId] = a;
        }
        a.srcObject = e.streams[0];
        a.play().catch(() => {});
      };
      (this.voice.pendingIce[peerId] || []).forEach(c => pc.addIceCandidate(c).catch(() => {}));
      this.voice.pendingIce[peerId] = [];
      return pc;
    }
    async _offer(peerId) {
      const pc = this._pc(peerId); if (!pc) return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.send({ t: 'signal', to: peerId, data: { kind: 'offer', sdp: offer } });
      } catch (e) { console.warn('offer', e); }
    }
    async _signal(from, data) {
      if (!data) return;
      const pc = this._pc(from);
      if (!pc) return;
      try {
        if (data.kind === 'offer') {
          await pc.setRemoteDescription(data.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.send({ t: 'signal', to: from, data: { kind: 'answer', sdp: answer } });
        } else if (data.kind === 'answer') {
          await pc.setRemoteDescription(data.sdp);
        } else if (data.kind === 'ice' && data.candidate) {
          if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
          else (this.voice.pendingIce[from] || (this.voice.pendingIce[from] = [])).push(data.candidate);
        }
      } catch (e) { console.warn('signal', e); }
    }
    _closeVoice(peerId) {
      try { if (this.voice.pcs[peerId]) this.voice.pcs[peerId].close(); } catch (e) {}
      try { if (this.voice.audios[peerId]) this.voice.audios[peerId].remove(); } catch (e) {}
      delete this.voice.pcs[peerId]; delete this.voice.audios[peerId];
    }
  }

  /* URL الافتراضي: نفس المضيف الذي يخدم الصفحة (يعمل على الشبكة المحلية) */
  function defaultUrl() {
    try {
      const loc = root.location;
      if (!loc || loc.protocol === 'file:') return (root.TijaraStore.settings().serverUrl || '');
      const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      return proto + '//' + loc.host + '/ws';
    } catch (e) { return ''; }
  }

  root.TijaraNet = { Network: Network, defaultUrl: defaultUrl, instance: new Network() };
})(typeof globalThis !== 'undefined' ? globalThis : this);
