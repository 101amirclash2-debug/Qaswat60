/**
 * QASWARA — application shell.
 *
 * Wires the cloud brains, the local bridge, the agent loop and every studio in
 * the UI. Nothing here fakes a result: every number, file and status shown to
 * the user comes from a real provider response or a real bridge call.
 */

import {
  APP_NAME,
  APP_NAME_AR,
  APP_VERSION,
  SAFETY_MODES,
  DEFAULT_SETTINGS,
  LIMITS,
  PROVIDERS,
  MODEL_CHOICES,
  AUTO_MODEL_ID,
  normalizeSettings,
  providerFor,
  supportsVision
} from './config.js';
import { Store } from './store.js';
import { choiceById, routeModel, taskLabel, modelLabel, applyChoice } from './models.js';
import { STYLES, DIALECTS, styleFor, dialectFor, personaChip } from './persona.js';
import { setInternetEnabled, isInternetEnabled } from './privacy.js';
import { chat, testConnection, ProviderError } from './providers.js';
import { BridgeClient, BridgeError } from './tools.js';
import { Agent } from './agent.js';
import { detectTrainingIntent, mergeMemories, KIND_LABELS } from './memory.js';
import { renderMarkdown, escapeHtml, plainPreview } from './markdown.js';
import { assessCommand, decideExecution, riskLabel, previewCommand } from './safety.js';
import { Voice, voiceSupport } from './voice.js';
import { LiveSession, mediaSupport } from './live.js';
import { FileLab, buildQuizPrompt, parseQuiz, gradeQuiz } from './lab.js';
import {
  createImage,
  composeSong,
  composeVideo,
  createDocument,
  exportApplication,
  auditOutput,
  buildPreviewDoc,
  base64DataUrl,
  formatBytes
} from './studio.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const store = new Store();
const state = {
  settings: store.settings,
  bridge: null,
  bridgeOnline: false,
  running: false,
  abort: null,
  autoAll: false,
  voice: null,
  live: null,
  lab: null,
  quiz: null,
  wakeActive: false,
  appBuffers: { html: '<h1 style="font-family:sans-serif">مرحبا من قسورة</h1>', css: 'body{background:#000;color:#eee}', js: '' },
  appTab: 'html'
};

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

let toastTimer = null;
function toast(message, { error = false, ms = 3200 } = {}) {
  const node = $('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('err', Boolean(error));
  node.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, ms);
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;
  if (id !== 'modalConfirm' && id !== 'modalInternet' && id !== 'modalLive') {
    $('backdrop').hidden = false;
  }
  modal.hidden = false;
  const focusable = modal.querySelector('input:not([type=hidden]), textarea, select, button');
  setTimeout(() => focusable?.focus?.({ preventScroll: true }), 60);
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.hidden = true;
  if (!document.querySelector('.modal:not([hidden])')) $('backdrop').hidden = true;
  if (id === 'modalLive') stopLiveSources();
}

function bindModalClosers() {
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  $('backdrop')?.addEventListener('click', () => {
    document.querySelectorAll('.modal:not([hidden])').forEach((m) => {
      m.hidden = true;
    });
    $('drawer').hidden = true;
    $('backdrop').hidden = true;
    stopLiveSources();
  });
}

function bridgeFileUrl(path) {
  if (!state.bridge) return '#';
  const base = state.bridge.resolvedBase || 'http://127.0.0.1:8080';
  const token = encodeURIComponent(state.settings.bridgeToken || '');
  return `${base}/files/raw?path=${encodeURIComponent(path)}${token ? `&token=${token}` : ''}`;
}

function save() {
  store.save();
}

function syncInternetFlag() {
  const on = Boolean(state.settings.internetEnabled);
  setInternetEnabled(on);
  $('netLabel').textContent = on ? 'متصل' : 'معزول';
  $('netIcon').textContent = on ? '🔌' : '⛔';
  $('btnInternet').classList.toggle('on', on);
  $('btnInternet').classList.toggle('off', !on);
}

function updateSafetyChip() {
  const mode = SAFETY_MODES[state.settings.safetyMode] || SAFETY_MODES.confirm;
  $('safetyLabel').textContent = mode.short;
}

/* ------------------------------------------------------------------ */
/* Sessions & messages                                                 */
/* ------------------------------------------------------------------ */

function activeSession() {
  if (!store.activeSession) {
    const session = store.createSession();
    store.selectSession(session.id);
  }
  return store.activeSession;
}

function renderSessions() {
  const list = $('sessionList');
  if (!list) return;
  list.innerHTML = '';
  for (const session of store.state.sessions) {
    const item = el('li', `session-item${session.id === store.state.activeSessionId ? ' active' : ''}`);
    const title = el('span', 'session-title', session.title || 'محادثة');
    title.addEventListener('click', () => {
      store.selectSession(session.id);
      renderSessions();
      renderAllMessages();
      $('drawer').hidden = true;
      $('backdrop').hidden = true;
    });
    const del = el('button', 'session-del', '✕');
    del.type = 'button';
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      store.deleteSession(session.id);
      renderSessions();
      renderAllMessages();
    });
    item.append(title, del);
    list.append(item);
  }
}

function messageFooter(message) {
  const actions = el('div', 'msg-actions');
  const copy = el('button', 'mini-btn', 'نسخ النص');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      toast('نُسخ النص.');
    } catch {
      toast('تعذّر النسخ — حدّد النص يدوياً.', { error: true });
    }
  });
  actions.append(copy);

  if (message.role === 'assistant' && message.content) {
    const speak = el('button', 'mini-btn', '🔊 استمع');
    speak.type = 'button';
    speak.addEventListener('click', () => state.voice.speak(message.content));
    actions.append(speak);
  }

  if (message.meta?.model) {
    actions.append(el('span', 'badge', message.meta.model));
  }
  return actions;
}

function renderMessage(message) {
  const wrap = el('div', `msg msg-${message.role}${message.error ? ' msg-error' : ''}`);
  const meta = el('div', 'msg-meta');
  meta.append(el('span', 'msg-role', message.role === 'user' ? 'أنت' : APP_NAME_AR));
  meta.append(el('span', '', new Date(message.createdAt || Date.now()).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })));
  if (message.meta?.route) meta.append(el('span', 'badge', message.meta.route));
  wrap.append(meta);

  const bubble = el('div', 'bubble');
  if (message.role === 'assistant') bubble.innerHTML = renderMarkdown(message.content || '');
  else bubble.textContent = message.content || '';
  wrap.append(bubble);

  if (message.steps?.length) {
    const steps = el('div', 'msg-steps');
    for (const step of message.steps.slice(-14)) {
      const line = el('div', 'step-line');
      const mark = el('span', step.status === 'ok' ? 'ok' : step.status === 'error' ? 'err' : 'blocked', step.status === 'ok' ? '✓' : step.status === 'error' ? '✕' : '!');
      line.append(mark, el('span', '', `${step.tool}${step.args?.code ? ` · ${String(step.args.code).slice(0, 70)}` : ''}`));
      steps.append(line);
    }
    wrap.append(steps);
  }

  wrap.append(messageFooter(message));
  return wrap;
}

function renderAllMessages() {
  const box = $('messages');
  if (!box) return;
  box.innerHTML = '';
  const session = activeSession();
  for (const message of session?.messages || []) box.append(renderMessage(message));
  toggleWatermark();
  scrollToEnd();
}

function scrollToEnd() {
  const chat = $('chat');
  if (chat) chat.scrollTop = chat.scrollHeight;
}

function toggleWatermark() {
  const session = activeSession();
  const hasMessages = Boolean(session?.messages?.length);
  $('watermark')?.classList.toggle('hidden', hasMessages);
}

function pushMessage(message) {
  const session = activeSession();
  const record = {
    id: `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    role: message.role,
    content: message.content,
    steps: message.steps || [],
    meta: message.meta || {},
    error: Boolean(message.error),
    createdAt: Date.now()
  };
  store.appendMessage(session.id, record);
  $('messages').append(renderMessage(record));
  toggleWatermark();
  scrollToEnd();
  return record;
}

/* ------------------------------------------------------------------ */
/* Thinking panel                                                      */
/* ------------------------------------------------------------------ */

function resetThinking(metaText = '') {
  const panel = $('thinking');
  if (!panel) return;
  panel.hidden = false;
  $('thinkingList').innerHTML = '';
  $('thinkingMeta').textContent = metaText;
  $('thinkingNow').textContent = 'يبدأ التحليل…';
}

function think(kind, label, text) {
  const list = $('thinkingList');
  if (!list) return;
  const item = el('li', `think-item phase-${kind}`);
  const head = el('span', 'think-label', label);
  const body = el('span', 'think-text');
  if (kind === 'action') {
    body.append(el('code', '', text));
  } else {
    body.textContent = text;
  }
  item.append(head, body);
  list.append(item);
  list.scrollTop = list.scrollHeight;
  $('thinkingNow').textContent = text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

function handleAgentEvent(event) {
  switch (event.type) {
    case 'start':
      resetThinking(event.mode === 'agent' ? `العقل: ${modelLabel(state.settings)} · الأدوات: ${event.tools.length}` : `العقل: ${modelLabel(state.settings)} · وضع الدردشة`);
      think('thought', 'تحليل', 'أقرأ المهمة وأحدد الهدف وخطة الخطوات.');
      break;
    case 'retry':
      think('problem', 'عائق مؤقت', `إعادة المحاولة ${event.attempt} بعد ${event.backoff}ms — ${event.message}`);
      break;
    case 'step': {
      const step = event.step;
      if (event.phase === 'start') {
        if (step.thought) think('thought', 'تحليل', step.thought);
        const args = step.args?.code ? step.args.code : JSON.stringify(step.args || {}).slice(0, 220);
        think('action', `تنفيذ · ${step.tool}`, args);
      } else {
        const status = step.status;
        const obs = step.observation || step.error || '';
        const short = obs.length > 260 ? `${obs.slice(0, 260)}…` : obs;
        think(status === 'ok' ? 'result' : 'problem', status === 'ok' ? 'نتيجة' : `عائق · ${status}`, short);
      }
      break;
    }
    case 'risk':
      if (event.decision === 'ask') think('fix', 'أمان', `طلب تأكيد قبل: ${event.assessment.reasons?.[0] || 'أمر حساس'}`);
      break;
    case 'workaround':
      think(event.installed === false ? 'problem' : 'fix', 'تجاوز عقبة', event.installed ? `ثُبّت ${event.need} ثم أُعيدت المحاولة.` : `${event.need}: ${event.message || event.reason || ''}`);
      break;
    case 'format-error':
      think('problem', 'تنسيق', event.message);
      break;
    case 'budget':
      think('fix', 'ميزانية', 'انتهت الخطوات المسموحة — أُعدّ تقريراً بما اكتمل.');
      break;
    case 'final':
      $('thinkingNow').textContent = 'اكتمل — التقرير في المحادثة.';
      think('result', 'تسليم', 'المهمة انتهت، أُرسل التقرير النهائي.');
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Command confirmation                                                */
/* ------------------------------------------------------------------ */

let confirmResolve = null;
function askConfirm(request) {
  const modal = $('modalConfirm');
  if (!modal) return Promise.resolve(false);
  if (state.autoAll && request.assessment?.level !== 'high') return Promise.resolve(true);

  $('confirmTitle').textContent = request.tool === 'exec' ? 'تأكيد تنفيذ أمر' : `تأكيد: ${request.tool}`;
  $('confirmRisk').textContent = riskLabel(request.assessment?.level || 'medium');
  $('confirmMeta').textContent = request.preview?.slice(0, 400) || '';
  $('confirmCode').textContent = request.args?.code || JSON.stringify(request.args || {}, null, 2);
  const reasons = $('confirmReasons');
  reasons.innerHTML = '';
  for (const reason of request.assessment?.reasons || []) reasons.append(el('li', '', reason));
  $('confirmAutoAll').checked = false;
  modal.hidden = false;

  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

function finishConfirm(allowed) {
  $('modalConfirm').hidden = true;
  if (confirmResolve) {
    confirmResolve(allowed);
    confirmResolve = null;
  }
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

function composedPrompt(text) {
  const context = state.lab?.context();
  if (!context?.text) return { prompt: text, files: 0 };
  const block = `\n\n[ملفات أرفقها المستخدم — اعتمد عليها كمصدر أساسي]\n${context.text}`;
  return { prompt: `${text}${block}`, files: context.files };
}

function ensureProviderReady() {
  const provider = providerFor(state.settings);
  if (!state.settings.apiKey) {
    toast(`أضف مفتاح ${provider.label} من ⚙ الإعدادات أولاً.`, { error: true });
    openModal('modalSettings');
    return false;
  }
  if (!isInternetEnabled()) {
    toast('الإنترنت مغلق بمفتاح العزل. افتحه من الشريط العلوي.', { error: true });
    return false;
  }
  return true;
}

async function send(text) {
  const value = String(text ?? '').trim();
  if (!value || state.running) return;

  const training = detectTrainingIntent(value);
  if (training) {
    store.addMemory({ kind: training.kind, content: training.content, source: 'chat' });
    pushMessage({ role: 'user', content: value });
    pushMessage({
      role: 'assistant',
      content: `حفظتُها في الذاكرة الدائمة ✅\n\n- النوع: ${KIND_LABELS[training.kind]}\n- النص: ${training.content}\n\nستُطبَّق في كل محادثة قادمة.`,
      meta: { model: 'الذاكرة' }
    });
    syncMemoryToBridge().catch(() => {});
    renderMemoryList();
    return;
  }

  if (!ensureProviderReady()) return;

  pushMessage({ role: 'user', content: value });
  $('input').value = '';
  autosize();
  $('watermark').classList.add('hidden');

  const { prompt } = composedPrompt(value);

  // Auto-Genius routing happens per message.
  let runSettings = state.settings;
  let routeNote = '';
  if (state.settings.autoModel) {
    try {
      const route = routeModel({
        text: value,
        settings: state.settings,
        hasImage: false,
        hasFile: Boolean(state.lab?.ready.length)
      });
      runSettings = applyChoice(state.settings, route.choiceId);
      routeNote = `Auto-Genius · ${taskLabel(route.task)} → ${choiceById(route.choiceId)?.label || route.choiceId}`;
      if (!route.providerKeyOk) routeNote += ' (بدون مفتاح؟)';
    } catch {
      routeNote = 'Auto-Genius';
    }
  } else {
    routeNote = modelLabel(state.settings);
  }

  await runAgent({ prompt, runSettings, routeNote });
}

async function runAgent({ prompt, runSettings = state.settings, routeNote = '', history = null }) {
  state.running = true;
  state.abort = new AbortController();
  $('btnSend').disabled = true;
  setLiveIndicator(true);

  const session = activeSession();
  const historyMessages = history || (session?.messages || []).slice(0, -1);
  const agent = new Agent({
    settings: runSettings,
    bridge: state.bridge,
    bridgeOnline: state.bridgeOnline,
    onEvent: handleAgentEvent,
    confirm: askConfirm,
    saveMemory: async ({ kind, content }) => {
      store.addMemory({ kind, content, source: 'agent' });
      await syncMemoryToBridge().catch(() => {});
      renderMemoryList();
    }
  });

  try {
    const result = await agent.run({
      prompt,
      history: historyMessages.map((m) => ({ role: m.role, content: m.content })),
      memory: { personaRules: store.state.personaRules, memories: store.state.memories },
      signal: state.abort.signal
    });
    const message = pushMessage({
      role: 'assistant',
      content: result.final || '(لا نص)',
      steps: result.steps,
      meta: { model: routeNote || modelLabel(runSettings), route: result.mode === 'agent' ? 'تنفيذ' : 'دردشة' }
    });
    if (state.settings.voiceEnabled && state.settings.autoSpeak) state.voice.speak(message.content);
  } catch (err) {
    if (err?.name === 'AbortError') {
      pushMessage({ role: 'assistant', content: 'توقفتُ بناءً على طلبك. ما نُفّذ حتى الآن مثبت في الخطوات أعلاه.', meta: { model: 'إيقاف' } });
    } else {
      const message = err?.message || 'خطأ غير معروف';
      pushMessage({ role: 'assistant', content: `**تعذّر إكمال المهمة.**\n\n${message}`, error: true, meta: { model: 'خطأ' } });
      state.voice.speak(`تعذّر إكمال المهمة. ${message}`);
    }
  } finally {
    state.running = false;
    state.abort = null;
    $('btnSend').disabled = false;
    setLiveIndicator(false);
    state.lab?.clear?.();
    renderFiles();
    renderSessions();
  }
}

function setLiveIndicator(on) {
  $('btnLive').classList.toggle('on', on);
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function buildSelects() {
  const providerSelect = $('setProvider');
  providerSelect.innerHTML = '';
  for (const provider of Object.values(PROVIDERS)) {
    const option = el('option', '', provider.label);
    option.value = provider.id;
    providerSelect.append(option);
  }

  const modelChoices = $('modelChoice');
  modelChoices.innerHTML = '';
  const auto = el('option', '', '✨ Auto-Genius');
  auto.value = AUTO_MODEL_ID;
  modelChoices.append(auto);
  for (const choice of MODEL_CHOICES) {
    const option = el('option', '', choice.label);
    option.value = choice.id;
    modelChoices.append(option);
  }
  const custom = el('option', '', 'مخصّص…');
  custom.value = 'custom';
  modelChoices.append(custom);

  for (const id of ['setStyle', 'quickStyle']) {
    const select = $(id);
    if (!select) continue;
    select.innerHTML = '';
    for (const style of Object.values(STYLES)) {
      const option = el('option', '', style.label);
      option.value = style.id;
      select.append(option);
    }
  }
  for (const id of ['setDialect', 'quickDialect']) {
    const select = $(id);
    if (!select) continue;
    select.innerHTML = '';
    for (const dialect of Object.values(DIALECTS)) {
      const option = el('option', '', dialect.label);
      option.value = dialect.id;
      select.append(option);
    }
  }

  const safetySelect = $('setSafetyMode');
  safetySelect.innerHTML = '';
  for (const mode of Object.values(SAFETY_MODES)) {
    const option = el('option', '', `${mode.short} — ${mode.label}`);
    option.value = mode.id;
    safetySelect.append(option);
  }

  const voiceSelect = $('setVoiceName');
  voiceSelect.innerHTML = '';
  const system = el('option', '', 'تلقائي (عربي إن وُجد)');
  system.value = '';
  voiceSelect.append(system);
  for (const voice of state.voice.voices()) {
    const option = el('option', '', `${voice.name} — ${voice.lang}`);
    option.value = voice.name;
    voiceSelect.append(option);
  }
}

function settingsToUI() {
  const s = state.settings;
  $('setProvider').value = s.provider;
  $('setApiKey').value = s.apiKey;
  $('setBaseUrl').value = s.customBaseUrl;
  $('setModel').value = s.model;
  $('setBridgeUrl').value = s.bridgeUrl;
  $('setBridgeToken').value = s.bridgeToken;
  $('setStyle').value = s.style;
  $('quickStyle').value = s.style;
  $('setDialect').value = s.dialect;
  $('quickDialect').value = s.dialect;
  $('setSafetyMode').value = s.safetyMode;
  $('setMaxSteps').value = s.maxSteps;
  $('setTemperature').value = s.temperature;
  $('setMaxTokens').value = s.maxOutputTokens;
  $('setHistoryWindow').value = s.historyWindow;
  $('setVoiceEnabled').checked = s.voiceEnabled;
  $('setVoiceName').value = s.voiceName;
  $('setVoiceRate').value = s.voiceRate;
  $('setVoicePitch').value = s.voicePitch;
  $('setWakeWord').value = s.wakeWord;
  $('setScrubSecrets').checked = s.scrubSecrets;
  $('setWorkspaceRoot').value = s.workspaceRoot;
  $('rateValue').textContent = `${Number(s.voiceRate).toFixed(1)}x`;
  $('pitchValue').textContent = Number(s.voicePitch).toFixed(1);
  $('modelChoice').value = s.autoModel ? AUTO_MODEL_ID : s.modelChoice || 'custom';
  $('providerNote').textContent = `${providerFor(s).label}${providerFor(s).vision ? ' · يدعم الصور' : ''}`;
  $('rowCustomBase').hidden = s.provider !== 'custom';
  $('keyLink').hidden = !providerFor(s).keyUrl;
  if (providerFor(s).keyUrl) $('keyLink').href = providerFor(s).keyUrl;
  $('aboutLine').textContent = `${APP_NAME} · ${APP_NAME_AR} — الإصدار ${APP_VERSION} · ${personaChip(s)} · التخزين محلي بالكامل.`;
  const options = $('modelList');
  options.innerHTML = '';
  for (const model of providerFor(s).models || []) {
    const option = el('option');
    option.value = model;
    options.append(option);
  }
  updateSafetyChip();
  syncInternetFlag();
}

function readSettingsUI() {
  return normalizeSettings({
    ...state.settings,
    provider: $('setProvider').value,
    apiKey: $('setApiKey').value.trim(),
    customBaseUrl: $('setBaseUrl').value.trim(),
    model: $('setModel').value.trim(),
    bridgeUrl: $('setBridgeUrl').value.trim() || 'auto',
    bridgeToken: $('setBridgeToken').value.trim(),
    style: $('setStyle').value,
    dialect: $('setDialect').value,
    safetyMode: $('setSafetyMode').value,
    maxSteps: Number($('setMaxSteps').value),
    temperature: Number($('setTemperature').value),
    maxOutputTokens: Number($('setMaxTokens').value),
    historyWindow: Number($('setHistoryWindow').value),
    voiceEnabled: $('setVoiceEnabled').checked,
    voiceName: $('setVoiceName').value,
    voiceRate: Number($('setVoiceRate').value),
    voicePitch: Number($('setVoicePitch').value),
    wakeWord: $('setWakeWord').value.trim() || DEFAULT_SETTINGS.wakeWord,
    scrubSecrets: $('setScrubSecrets').checked,
    workspaceRoot: $('setWorkspaceRoot').value.trim() || DEFAULT_SETTINGS.workspaceRoot
  });
}

async function commitSettings({ rebuildBridge = true } = {}) {
  state.settings = store.updateSettings(readSettingsUI());
  settingsToUI();
  if (rebuildBridge) setupBridge();
}

async function setupBridge() {
  state.bridge = new BridgeClient({
    baseUrl: state.settings.bridgeUrl,
    token: state.settings.bridgeToken,
    timeoutMs: state.settings.bridgeTimeoutMs
  });
  await checkBridge();
}

async function checkBridge() {
  if (!state.bridge) {
    state.bridgeOnline = false;
    return false;
  }
  try {
    const health = await state.bridge.health();
    state.bridgeOnline = Boolean(health?.ok);
    state.bridge.resolvedBase = await state.bridge.resolveBase();
    state.bridge.info = health;
    if (state.settings.bridgeToken !== state.bridge.token) {
      // token was auto-discovered from the served page
      state.settings.bridgeToken = state.bridge.token;
    }
    return true;
  } catch {
    state.bridgeOnline = false;
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Memory                                                             */
/* ------------------------------------------------------------------ */

function renderMemoryList(filter = '') {
  const list = $('memoryList');
  if (!list) return;
  list.innerHTML = '';
  const query = filter.trim().toLowerCase();
  const items = store.state.memories.filter((m) => !query || m.content.toLowerCase().includes(query));
  if (!items.length) {
    list.append(el('li', 'hint', query ? 'لا نتائج.' : 'لا ذاكرة بعد — أضف قاعدة أو اكتب «تذكر دائماً …».'));
    return;
  }
  for (const memory of items.slice().reverse()) {
    const item = el('li', 'memory-item');
    const left = el('div');
    left.append(el('span', 'memory-kind', KIND_LABELS[memory.kind] || memory.kind));
    left.append(el('div', '', memory.content));
    const del = el('button', 'memory-del', '🗑');
    del.type = 'button';
    del.addEventListener('click', async () => {
      store.removeMemory(memory.id);
      renderMemoryList($('memoryFilter').value);
      if (state.bridgeOnline && /^\d+$/.test(String(memory.id))) {
        state.bridge.memoryDelete(memory.id).catch(() => {});
      }
    });
    item.append(left, del);
    list.append(item);
  }
  $('memoryStatus').textContent = `محلياً: ${store.state.memories.length} عنصر${state.bridgeOnline ? ' · الجسر متصل' : ' · الجسر غير متصل'}`;
}

async function syncMemoryToBridge() {
  if (!state.bridgeOnline) throw new Error('الجسر غير متصل.');
  const local = store.state.memories.filter((m) => !m.synced);
  for (const memory of local) {
    await state.bridge.memorySave({ kind: memory.kind, content: memory.content });
    memory.synced = true;
  }
  const remote = await state.bridge.memoryList({ limit: 500 });
  const merged = mergeMemories(store.state.memories, remote.items || []);
  store.state.memories = merged;
  save();
  renderMemoryList($('memoryFilter').value);
  return { pushed: local.length, total: merged.length };
}

/* ------------------------------------------------------------------ */
/* Voice                                                              */
/* ------------------------------------------------------------------ */

function setupVoice() {
  state.voice = new Voice({
    getSettings: () => state.settings,
    onError: (message) => toast(message, { error: true })
  });
}

function startWake() {
  const ok = state.voice.startWake({
    phrase: state.settings.wakeWord,
    onWake: () => {
      state.wakeActive = false;
      toast(`سمعتك تقول «${state.settings.wakeWord}» — تكلّم الآن.`);
      state.voice.listen({
        onFinal: (text) => {
          if (text.trim()) {
            $('input').value = text.trim();
            send(text.trim());
          }
          if (state.settings.wakeEnabled) startWake();
        },
        onError: (message) => toast(message, { error: true })
      });
      $('btnWakeToggle').textContent = 'إعادة تفعيل كلمة التنبيه';
    },
    onStatus: (message) => {
      $('wakeStatus').textContent = message;
    }
  });
  state.wakeActive = ok;
  $('btnWakeToggle').textContent = ok ? 'إيقاف الاستماع لكلمة التنبيه' : 'تفعيل الاستماع لكلمة التنبيه';
  if (ok) toast('قسورة يستمع لكلمة التنبيه.');
}

function stopWake() {
  state.voice.stopWake();
  state.wakeActive = false;
  $('btnWakeToggle').textContent = 'تفعيل الاستماع لكلمة التنبيه';
  $('wakeStatus').textContent = '';
}

/* ------------------------------------------------------------------ */
/* Live                                                               */
/* ------------------------------------------------------------------ */

function renderLiveStatus(text) {
  $('liveStatus').textContent = text;
}

async function startLiveSource(kind, facing = 'environment') {
  if (!state.bridgeOnline) toast('لايف يعمل بلا جسر أيضاً، لكن بعض الميزات تحتاجه.', { error: false });
  try {
    const stream = kind === 'camera' ? await state.live.startCamera({ facing }) : await state.live.startScreen();
    const video = $('liveVideo');
    video.srcObject = stream;
    await video.play().catch(() => {});
    $('livePlaceholder').hidden = true;
    $('btnLive').classList.add('on');
    renderLiveStatus(kind === 'camera' ? `الكاميرا تعمل (${facing === 'user' ? 'أمامية' : 'خلفية'}).` : 'مشاركة الشاشة تعمل.');
  } catch (err) {
    renderLiveStatus(err.message);
    toast(err.message, { error: true });
  }
}

function stopLiveSources() {
  state.live?.stop();
  const video = $('liveVideo');
  if (video) video.srcObject = null;
  $('livePlaceholder') && ($('livePlaceholder').hidden = false);
  $('btnLive').classList.remove('on');
  $('btnLiveAuto').textContent = '▶︎ تحليل مستمر (كل ٤ ثوانٍ)';
  if (autoLiveTimer) clearInterval(autoLiveTimer);
  autoLiveTimer = null;
}

let autoLiveTimer = null;

async function liveAsk() {
  const question = $('liveQuestion').value.trim();
  const translate = $('liveTranslate').checked;
  let frame = null;
  try {
    if ($('liveVideo').srcObject) {
      frame = state.live.frame({ video: $('liveVideo') });
    } else if (state.bridgeOnline) {
      frame = await state.live.captureScreenViaBridge();
      renderLiveStatus(`التُقطت الشاشة عبر ${frame.method || 'الجسر'}.`);
    } else {
      renderLiveStatus('لا مصدر صورة. شغّل الكاميرا أو مشاركة الشاشة أو الجسر.');
      return;
    }
  } catch (err) {
    renderLiveStatus(err.message);
    return;
  }

  if (state.voice.utterance) state.voice.stop(); // barge-in
  $('btnLiveAsk').disabled = true;
  renderLiveStatus(translate ? 'أترجم الصورة…' : 'أحلل الصورة…');
  try {
    const result = await state.live.ask({ question, frames: [frame], translate });
    $('liveAnswer').textContent = result.text || '(لا نص)';
    if ($('liveVoice').checked) state.voice.speak(result.text || '');
    renderLiveStatus('تم.');
  } catch (err) {
    $('liveAnswer').textContent = err.message;
    renderLiveStatus('فشل التحليل.');
  } finally {
    $('btnLiveAsk').disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Files lab                                                          */
/* ------------------------------------------------------------------ */

function renderFiles() {
  const list = $('filesList');
  if (!list) return;
  list.innerHTML = '';
  const items = state.lab?.items || [];
  if (!items.length) {
    list.append(el('li', 'hint', 'لا ملفات. أضف PDF أو Word أو Excel أو نصاً أو كوداً أو صورة أو صوتاً.'));
    return;
  }
  for (const item of items) {
    const row = el('li', 'file-item');
    const name = el('div', '', `${item.name} · ${formatBytes(item.size)}`);
    const status = el('span', `file-status ${item.status}`, item.note || item.status);
    row.append(name, status);
    list.append(row);
  }
  $('filesStatus').textContent = `${state.lab?.ready.length || 0} ملف جاهز · ${Math.round((state.lab?.context().chars || 0) / 1000)} ألف حرف في السياق`;
}

async function addFiles(files) {
  if (!files?.length) return;
  if (!state.bridgeOnline) toast('بدون جسر: الملفات النصية تُقرأ، أما PDF/Office/الصور فتحتاج تشغيل الجسر.', { error: false });
  openModal('modalFiles');
  $('filesStatus').textContent = 'جارٍ المعالجة…';
  await state.lab.addFiles([...files]);
  renderFiles();
}

async function filesAsk(prompt, label) {
  if (!state.lab?.ready.length) {
    toast('أضف ملفاً أولاً.', { error: true });
    return;
  }
  if (!ensureProviderReady()) return;
  const context = state.lab.context();
  if (!context.text) {
    toast('لم يُستخرج نص من الملفات.', { error: true });
    return;
  }
  closeModal('modalFiles');
  pushMessage({ role: 'user', content: `${label} (${context.files} ملف · ${context.chars} حرف)` });
  resetThinking(`تحليل ${context.files} ملف`);
  think('thought', 'تحليل', 'أقرأ محتوى الملفات وأستخرج المطلوب.');
  try {
    const settings = state.settings.autoModel
      ? applyChoice(state.settings, routeModel({ text: prompt, settings: state.settings, hasFile: true }).choiceId)
      : state.settings;
    const result = await chat({
      settings,
      system: `أنت ${APP_NAME_AR}. أجب بالعربية بأسلوب ${styleFor(settings.style).label} ولهجة ${dialectFor(settings.dialect).label}. اعتمد على الملفات المرفقة فقط، واذكر أسماء الملفات عند الاقتباس.`,
      messages: [{ role: 'user', content: `${prompt}\n\n[الملفات]\n${context.text}` }]
    });
    pushMessage({ role: 'assistant', content: result.text, meta: { model: modelLabel(settings) } });
    if (settings.voiceEnabled) state.voice.speak(result.text);
  } catch (err) {
    pushMessage({ role: 'assistant', content: `**تعذّر التحليل.** ${err.message}`, error: true });
  } finally {
    $('thinkingNow').textContent = 'اكتمل.';
  }
}

async function startQuiz() {
  if (!state.lab?.ready.length) {
    toast('أضف ملفاً أولاً ليصمّم قسورة الاختبار منه.', { error: true });
    return;
  }
  if (!ensureProviderReady()) return;
  const context = state.lab.context({ maxChars: 16000 });
  $('quizBox').hidden = false;
  $('quizBox').innerHTML = 'جارٍ تصميم الأسئلة من محتوى ملفاتك…';
  try {
    const result = await chat({
      settings: state.settings.autoModel
        ? applyChoice(state.settings, routeModel({ text: 'quiz', settings: state.settings }).choiceId)
        : state.settings,
      system: `أنت ${APP_NAME_AR} — مصمّم اختبارات دقيق. تخرج JSON فقط.`,
      messages: [{ role: 'user', content: buildQuizPrompt(context.text, { count: 5 }) }]
    });
    const parsed = parseQuiz(result.text);
    if (!parsed.ok) {
      $('quizBox').innerHTML = `تعذّر بناء الاختبار: ${parsed.reason}`;
      return;
    }
    renderQuiz(parsed.questions);
  } catch (err) {
    $('quizBox').innerHTML = `تعذّر بناء الاختبار: ${err.message}`;
  }
}

function renderQuiz(questions) {
  const box = $('quizBox');
  box.hidden = false;
  box.innerHTML = '';
  state.quiz = { questions, answers: new Array(questions.length).fill(null) };
  questions.forEach((question, index) => {
    const card = el('div', 'quiz-q');
    card.dataset.index = String(index);
    card.append(el('h4', '', `${index + 1}. ${question.q}`));
    question.options.forEach((option, optIndex) => {
      const label = el('label', 'quiz-opt');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `quiz_${index}`;
      input.value = String(optIndex);
      input.addEventListener('change', () => {
        state.quiz.answers[index] = optIndex;
      });
      label.append(input, el('span', '', option));
      card.append(label);
    });
    box.append(card);
  });
  const submit = el('button', 'btn-primary', 'صحّح إجاباتي');
  submit.type = 'button';
  submit.addEventListener('click', gradeCurrentQuiz);
  const actions = el('div', 'btn-row');
  actions.append(submit);
  box.append(actions);
}

function gradeCurrentQuiz() {
  if (!state.quiz) return;
  const { questions, answers } = state.quiz;
  if (answers.some((a) => a === null)) {
    toast('أجب على كل الأسئلة أولاً (أو اختر أي خيار لتجربة التصحيح).', { error: true });
    return;
  }
  const result = gradeQuiz(questions, answers);
  const box = $('quizBox');
  box.innerHTML = '';
  const score = el('div', 'quiz-score', `نتيجتك: ${result.correct}/${result.total} (${result.percent}%)`);
  box.append(score);
  questions.forEach((question, index) => {
    const card = el('div', 'quiz-q');
    card.append(el('h4', '', `${index + 1}. ${question.q}`));
    question.options.forEach((option, optIndex) => {
      const row = el('div', `quiz-opt${optIndex === question.answer ? ' correct' : ''}${optIndex === answers[index] && optIndex !== question.answer ? ' wrong' : ''}`);
      row.textContent = option;
      card.append(row);
    });
    if (question.explain) card.append(el('p', 'quiz-explain', question.explain));
    box.append(card);
  });
  const again = el('button', 'btn-ghost', 'اختبار جديد');
  again.type = 'button';
  again.addEventListener('click', startQuiz);
  const row = el('div', 'btn-row');
  row.append(again);
  box.append(row);
  const verdict = result.percent >= 80 ? 'ممتاز — فهمت الملفات جيداً.' : result.percent >= 50 ? 'جيد، راجع الأسئلة التي أخطأت فيها.' : 'تحتاج إعادة قراءة الملفات ثم إعادة الاختبار.';
  state.voice.speak(`نتيجتك ${result.correct} من ${result.total}. ${verdict}`);
}

/* ------------------------------------------------------------------ */
/* Studio                                                             */
/* ------------------------------------------------------------------ */

function mediaResult(container, nodes) {
  container.innerHTML = '';
  for (const node of nodes) container.append(node);
}

function pathLine(path) {
  const line = el('div', 'path-line', path);
  const link = el('a', 'mini-btn', 'فتح / تنزيل');
  link.href = bridgeFileUrl(path);
  link.target = '_blank';
  link.rel = 'noopener';
  const row = el('div', 'btn-row');
  row.append(link);
  return [line, row];
}

async function generateStudioImage() {
  const prompt = $('imgPrompt').value.trim();
  if (!prompt) {
    toast('اكتب وصف الصورة.', { error: true });
    return;
  }
  if (!ensureProviderReady()) return;
  $('imageResult').textContent = 'جارٍ التوليد…';
  try {
    const image = await createImage({ settings: state.settings, prompt, bridge: state.bridgeOnline ? state.bridge : null });
    const img = document.createElement('img');
    img.src = base64DataUrl(image.base64, image.mime);
    img.alt = prompt;
    const nodes = [img, el('div', 'hint', `${image.provider} · ${formatBytes(image.bytes)}`)];
    if (image.path) nodes.push(...pathLine(image.path));
    mediaResult($('imageResult'), nodes);
  } catch (err) {
    $('imageResult').textContent = err.message;
    toast(err.message, { error: true });
  }
}

async function generateStudioSong() {
  if (!state.bridgeOnline) {
    toast('الأغنية تُنتج على الهاتف عبر الجسر (ffmpeg + espeak). شغّل الجسر أولاً.', { error: true });
    return;
  }
  $('songResult').textContent = 'جارٍ التأليف والتسجيل…';
  try {
    const result = await composeSong({
      bridge: state.bridge,
      title: $('songTitle').value.trim() || 'نشيد قسورة',
      lyrics: $('songLyrics').value,
      bpm: Number($('songBpm').value),
      seconds: Number($('songSeconds').value),
      scale: $('songScale').value,
      vocals: $('songVocals').checked
    });
    const nodes = [];
    if (result.files?.length) {
      for (const file of result.files) nodes.push(...pathLine(file));
    }
    if (result.message) nodes.push(el('div', 'hint', result.message));
    mediaResult($('songResult'), nodes);
    state.voice.speak('تم إنتاج الأغنية.');
  } catch (err) {
    $('songResult').textContent = err.message;
    toast(err.message, { error: true });
  }
}

async function generateStudioVideo() {
  if (!state.bridgeOnline) {
    toast('الفيديو يحتاج الجسر (ffmpeg).', { error: true });
    return;
  }
  $('videoResult').textContent = 'جارٍ الإنتاج…';
  try {
    const images = $('videoImages').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const result = await composeVideo({
      bridge: state.bridge,
      images,
      audio: $('videoAudio').value.trim() || null,
      title: $('videoTitle').value.trim() || 'qaswara_video'
    });
    const nodes = [];
    if (result.path) nodes.push(...pathLine(result.path));
    if (result.message) nodes.push(el('div', 'hint', result.message));
    mediaResult($('videoResult'), nodes);
  } catch (err) {
    $('videoResult').textContent = err.message;
  }
}

async function generateStudioDoc() {
  if (!state.bridgeOnline) {
    toast('المستندات تُنشأ على الهاتف عبر الجسر.', { error: true });
    return;
  }
  const kind = $('docKind').value;
  const path = $('docPath').value.trim() || `artifacts/${Date.now()}.${kind}`;
  const title = $('docTitle').value.trim() || 'تقرير قسورة';
  const body = $('docBody').value;
  let payload;
  if (['xlsx', 'csv'].includes(kind)) {
    const rows = body.split('\n').filter((line) => line.trim()).map((line) => line.split('|').map((cell) => cell.trim()));
    payload = { title, rows };
  } else if (kind === 'zip') {
    payload = { files: { 'README.md': body || '# أرشيف قسورة' } };
  } else {
    payload = { title, sections: [{ heading: title, body: body.split('\n').filter(Boolean) }] };
  }
  $('docResult').textContent = 'جارٍ الإنشاء…';
  try {
    const result = await createDocument({ bridge: state.bridge, kind, path, payload });
    mediaResult($('docResult'), pathLine(result.path));
  } catch (err) {
    $('docResult').textContent = err.message;
  }
}

/* ------------------------------------------------------------------ */
/* App studio                                                         */
/* ------------------------------------------------------------------ */

function updateAppPreview() {
  $('appPreview').srcdoc = buildPreviewDoc({
    html: state.appBuffers.html,
    css: state.appBuffers.css,
    js: state.appBuffers.js,
    title: $('appName').value || 'QASWARA'
  });
}

function appFiles() {
  const name = ($('appName').value || 'QaswaraApp').replace(/[^\w.-]+/g, '');
  return {
    'index.html': buildPreviewDoc({
      html: state.appBuffers.html,
      css: state.appBuffers.css,
      js: state.appBuffers.js,
      title: name
    }),
    'manifest.webmanifest': JSON.stringify({ name, short_name: name, display: 'standalone', background_color: '#000000', theme_color: '#10b981', start_url: './' }, null, 2)
  };
}

async function appAudit() {
  if (!state.bridgeOnline) {
    toast('تدقيق Artemis يعمل على الجسر.', { error: true });
    return;
  }
  $('appResult').textContent = 'جارٍ التدقيق…';
  try {
    const code = `${state.appBuffers.html}\n<style>${state.appBuffers.css}</style>\n<script>${state.appBuffers.js}</script>`;
    const result = await auditOutput({ bridge: state.bridge, code, lang: 'html' });
    const findings = (result.findings || []).map((f) => `• [${f.severity}] ${f.rule}${f.line ? ` (سطر ${f.line})` : ''}`).join('\n');
    $('appResult').textContent = `درجة الأمان: ${result.score}/100\n${result.summary || ''}\n${findings || 'لا ملاحظات.'}\n\nملاحظة: Artemis يفحص الكود هنا فقط؛ الثغرات في تشغيل الجسر لا تُصلح تلقائياً.`;
  } catch (err) {
    $('appResult').textContent = err.message;
  }
}

async function appExport(kind) {
  if (!state.bridgeOnline) {
    toast('التصدير يحتاج الجسر.', { error: true });
    return;
  }
  $('appResult').textContent = kind === 'apk' ? 'جارٍ بناء APK…' : 'جارٍ تجهيز الحزمة…';
  try {
    const result = await exportApplication({
      bridge: state.bridge,
      files: appFiles(),
      name: $('appName').value || 'QaswaraApp',
      kind
    });
    if (result.ok === false) {
      $('appResult').textContent = `${result.message || 'تعذّر بناء APK.'}\nينقص: ${(result.missing || []).join(', ')}\nالحزمة البديلة: ${result.bundle || '—'}`;
      return;
    }
    $('appResult').textContent = `تم: ${result.path}\n${result.note || ''}`;
    const link = el('a', 'mini-btn', 'تنزيل الحزمة');
    link.href = bridgeFileUrl(result.path);
    link.target = '_blank';
    link.rel = 'noopener';
    $('appResult').append(document.createTextNode('\n'), link);
  } catch (err) {
    $('appResult').textContent = err.message;
    toast(err.message, { error: true });
  }
}

/* ------------------------------------------------------------------ */
/* Device diagnostics                                                 */
/* ------------------------------------------------------------------ */

async function scanDevice() {
  if (!state.bridgeOnline) {
    toast('الفحص يحتاج الجسر — شغّله من Termux.', { error: true });
    return;
  }
  $('deviceSummary').textContent = 'جارٍ الفحص…';
  $('deviceAdvice').innerHTML = '';
  try {
    const info = await state.bridge.device({ refresh: true });
    const caps = info.capabilities || {};
    const summary = $('deviceSummary');
    summary.innerHTML = '';
    for (const [key, value] of Object.entries(caps)) {
      summary.append(el('div', `cap ${value ? 'on' : 'off'}`, `${value ? '✅' : '❌'} ${key}`));
    }
    const advice = $('deviceAdvice');
    advice.innerHTML = '';
    for (const item of info.advice || []) {
      const row = el('li', 'advice-item');
      const info2 = el('div');
      info2.append(el('div', '', item.need));
      info2.append(el('code', '', item.install || ''));
      const btn = el('button', 'btn-ghost small', 'ثبّت');
      btn.type = 'button';
      btn.addEventListener('click', () => installMissing(item));
      row.append(info2, btn);
      advice.append(row);
    }
    $('deviceRaw').hidden = true;
  } catch (err) {
    $('deviceSummary').textContent = err.message;
  }
}

async function installMissing(item) {
  if (!state.bridge) return;
  const raw = String(item.install || '').trim();
  const match = raw.match(/^(pkg|pip)\s+install\s+([\w.@+\-/]+)/);
  const manager = match ? match[1] : item.manager || 'pkg';
  const name = match ? match[2] : raw || item.need;
  if (!name) {
    toast('لا يوجد اسم حزمة لهذا العنصر.', { error: true });
    return;
  }
  try {
    toast(`يثبّت ${name}…`);
    const result = await state.bridge.install({ manager, name });
    toast(`تم التثبيت: ${result.message || result.stdout || name}`);
    await scanDevice();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

async function installAllMissing() {
  if (!state.bridgeOnline) return;
  try {
    const info = await state.bridge.device({ refresh: true });
    for (const item of info.advice || []) {
      if (!item.install) continue;
      if (/android-sdk/i.test(item.install)) continue;
      // eslint-disable-next-line no-await-in-loop
      await installMissing(item).catch(() => {});
    }
    await scanDevice();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

/* ------------------------------------------------------------------ */
/* Event wiring                                                       */
/* ------------------------------------------------------------------ */

function autosize() {
  const input = $('input');
  input.style.height = 'auto';
  input.style.height = `${Math.min(132, input.scrollHeight)}px`;
}

function bindComposer() {
  const input = $('input');
  input.addEventListener('input', () => {
    autosize();
    $('watermark').classList.toggle('hidden', Boolean(input.value.trim()) || Boolean(activeSession()?.messages.length));
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(input.value);
    }
  });
  $('btnSend').addEventListener('click', () => send(input.value));
  $('btnStop').addEventListener('click', () => {
    state.abort?.abort();
    state.voice.stop();
  });

  $('btnMic').addEventListener('click', () => {
    if (state.voice.listening) {
      state.voice.stopListening();
      return;
    }
    state.voice.listen({
      onPartial: (text) => {
        input.value = text;
        autosize();
      },
      onFinal: (text) => {
        input.value = text.trim();
        autosize();
        if (text.trim()) toast('تم التعرف — عدّل النص أو أرسله.');
      },
      onError: (message) => toast(message, { error: true })
    });
    toast('تكلّم الآن…');
  });

  $('btnAttach').addEventListener('click', () => $('attachInput').click());
  $('attachInput').addEventListener('change', async (event) => {
    await addFiles(event.target.files);
    event.target.value = '';
  });
}

function bindMenus() {
  const openDrawer = () => {
    $('drawer').hidden = false;
    $('backdrop').hidden = false;
  };
  $('btnMenu').addEventListener('click', openDrawer);
  $('btnCloseDrawer').addEventListener('click', () => {
    $('drawer').hidden = true;
    $('backdrop').hidden = true;
  });
  document.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.open;
      const map = {
        files: 'modalFiles',
        studio: 'modalStudio',
        apps: 'modalApps',
        live: 'modalLive',
        device: 'modalDevice',
        memory: 'modalMemory',
        safety: 'modalSafety',
        settings: 'modalSettings'
      };
      if (target === 'safety') $('backdrop').hidden = false;
      if (target === 'live') $('backdrop').hidden = false;
      openModal(map[target]);
      $('drawer').hidden = true;
      if (target === 'memory') {
        $('personaRules').value = store.state.personaRules || '';
        renderMemoryList($('memoryFilter').value);
      }
      if (target === 'device') scanDevice();
      if (target === 'settings') settingsToUI();
    });
  });
  $('btnNewSession').addEventListener('click', () => {
    const session = store.createSession();
    store.selectSession(session.id);
    renderSessions();
    renderAllMessages();
    $('drawer').hidden = true;
    $('backdrop').hidden = true;
    $('input').focus();
  });
  for (const id of ['quickStyle', 'quickDialect']) {
    $(id).addEventListener('change', () => {
      state.settings = store.updateSettings({
        style: $('quickStyle').value,
        dialect: $('quickDialect').value
      });
      $('setStyle').value = state.settings.style;
      $('setDialect').value = state.settings.dialect;
      toast(`الأسلوب: ${styleFor(state.settings.style).label} · اللهجة: ${dialectFor(state.settings.dialect).label}`);
    });
  }
  $('modelChoice').addEventListener('change', () => {
    const value = $('modelChoice').value;
    if (value === AUTO_MODEL_ID) {
      state.settings = store.updateSettings({ autoModel: true });
    } else if (value === 'custom') {
      openModal('modalSettings');
      settingsToUI();
      return;
    } else {
      state.settings = store.updateSettings(applyChoice(state.settings, value));
    }
    settingsToUI();
    toast(`العقل: ${modelLabel(state.settings)}`);
  });
}

function bindSettingsModal() {
  $('btnSaveSettings').addEventListener('click', async () => {
    await commitSettings();
    closeModal('modalSettings');
    toast('حُفظت الإعدادات.');
    if (state.settings.wakeEnabled && !state.wakeActive) startWake();
    if (!state.settings.wakeEnabled && state.wakeActive) stopWake();
  });

  $('btnToggleKey').addEventListener('click', () => {
    const field = $('setApiKey');
    field.type = field.type === 'password' ? 'text' : 'password';
  });

  $('setProvider').addEventListener('change', () => {
    const provider = PROVIDERS[$('setProvider').value];
    $('setModel').value = provider.defaultModel;
    $('rowCustomBase').hidden = provider.id !== 'custom';
    $('providerNote').textContent = `${provider.label}${provider.vision ? ' · يدعم الصور' : ''}`;
    $('keyLink').hidden = !provider.keyUrl;
    if (provider.keyUrl) $('keyLink').href = provider.keyUrl;
  });

  $('btnTestConnection').addEventListener('click', async () => {
    await commitSettings({ rebuildBridge: false });
    const result = $('testResult');
    result.hidden = false;
    result.className = 'result';
    result.textContent = 'جارٍ الاختبار…';
    try {
      const outcome = await testConnection(state.settings);
      if (outcome && outcome.ok === false) throw new Error(outcome.error || 'فشل الاتصال.');
      result.classList.add('ok');
      result.textContent = `✅ الاتصال ناجح — ${outcome.model || state.settings.model} · ${outcome.latencyMs || 0}ms`;
    } catch (err) {
      result.classList.add('err');
      result.textContent = `❌ ${err.message}`;
    }
  });

  $('btnTestBridge').addEventListener('click', async () => {
    await commitSettings();
    const result = $('bridgeResult');
    result.hidden = false;
    result.className = 'result';
    if (state.bridgeOnline) {
      result.classList.add('ok');
      result.textContent = `✅ الجسر يعمل — ${state.bridge.info?.name || APP_NAME} ${state.bridge.info?.version || ''} · مساحة العمل: ${state.bridge.info?.workspace || '—'}`;
    } else {
      result.classList.add('err');
      result.textContent = '❌ تعذّر الوصول إلى الجسر. شغّله من Termux وتأكد من الرمز.';
    }
  });

  $('btnDeviceRefresh').addEventListener('click', async () => {
    await commitSettings({ rebuildBridge: false });
    closeModal('modalSettings');
    openModal('modalDevice');
    scanDevice();
  });

  $('setVoiceRate').addEventListener('input', () => {
    $('rateValue').textContent = `${Number($('setVoiceRate').value).toFixed(1)}x`;
  });
  $('setVoicePitch').addEventListener('input', () => {
    $('pitchValue').textContent = Number($('setVoicePitch').value).toFixed(1);
  });
  $('btnTestVoice').addEventListener('click', async () => {
    await commitSettings({ rebuildBridge: false });
    state.voice.speak(`مرحباً، أنا ${APP_NAME_AR}. هذه سرعة ${Number(state.settings.voiceRate).toFixed(1)} ولهجة ${dialectFor(state.settings.dialect).label}.`);
  });
  $('btnWakeToggle').addEventListener('click', async () => {
    if (state.wakeActive) {
      stopWake();
      state.settings = store.updateSettings({ wakeEnabled: false });
      return;
    }
    await commitSettings({ rebuildBridge: false });
    state.settings = store.updateSettings({ wakeEnabled: true });
    startWake();
  });

  $('btnExport').addEventListener('click', () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `qaswara-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  });
  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      store.importJSON(text);
      state.settings = store.settings;
      settingsToUI();
      renderSessions();
      renderAllMessages();
      renderMemoryList();
      toast('استُوردت النسخة.');
    } catch (err) {
      toast(err.message, { error: true });
    }
    event.target.value = '';
  });
  $('btnClearAll').addEventListener('click', () => {
    if (!window.confirm('مسح كل البيانات المحلية (المحادثات، الذاكرة، المفاتيح)؟ لا يمكن التراجع.')) return;
    store.clearAll();
    state.settings = store.settings;
    settingsToUI();
    renderSessions();
    renderAllMessages();
    renderMemoryList();
    toast('مُسحت البيانات المحلية.');
  });
}

function bindMemoryModal() {
  $('btnSavePersona').addEventListener('click', () => {
    store.setPersonaRules($('personaRules').value);
    toast('حُفظت القواعد الدائمة.');
  });
  $('btnAddMemory').addEventListener('click', () => {
    const content = $('newMemoryInput').value.trim();
    if (content.length < 4) {
      toast('اكتب نصاً أطول.', { error: true });
      return;
    }
    store.addMemory({ kind: $('newMemoryKind').value, content });
    $('newMemoryInput').value = '';
    renderMemoryList($('memoryFilter').value);
    syncMemoryToBridge().catch(() => {});
  });
  $('memoryFilter').addEventListener('input', () => renderMemoryList($('memoryFilter').value));
  $('btnSyncMemory').addEventListener('click', async () => {
    try {
      const result = await syncMemoryToBridge();
      toast(`تمت المزامنة: ${result.pushed} مرفوع · ${result.total} إجمالي.`);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
}

function bindSafetyModal() {
  $('btnSafety').addEventListener('click', () => {
    $('backdrop').hidden = false;
    renderSafetyOptions();
    openModal('modalSafety');
  });
  $('btnApplySafety').addEventListener('click', () => {
    const selected = document.querySelector('input[name="safety"]:checked')?.value || 'confirm';
    state.settings = store.updateSettings({ safetyMode: selected });
    updateSafetyChip();
    closeModal('modalSafety');
    toast(`وضع الأمان: ${SAFETY_MODES[selected].label}`);
  });
  $('btnInternet').addEventListener('click', () => {
    const on = state.settings.internetEnabled;
    $('internetText').textContent = on
      ? 'الإنترنت مفتوح الآن. إغلاقه يوقف كل اتصال بالعقول السحابية فوراً ويمنع أي طلب خارجي.'
      : 'الإنترنت مغلق. فتحه يسمح لقسورة بالاتصال بمزوّد العقل لإكمال المهام.';
    $('btnInternetConfirm').textContent = on ? 'إغلاق الإنترنت' : 'فتح الإنترنت';
    $('backdrop').hidden = false;
    openModal('modalInternet');
  });
  $('btnInternetConfirm').addEventListener('click', () => {
    const next = !state.settings.internetEnabled;
    state.settings = store.updateSettings({ internetEnabled: next });
    syncInternetFlag();
    closeModal('modalInternet');
    toast(next ? 'فُتح الإنترنت — العقول متاحة.' : 'أُغلق الإنترنت — عزل كامل.', { error: !next });
  });
  $('btnConfirmRun').addEventListener('click', () => {
    if ($('confirmAutoAll').checked) state.autoAll = true;
    finishConfirm(true);
  });
  $('btnConfirmSkip').addEventListener('click', () => finishConfirm(false));
  $('btnConfirmStop').addEventListener('click', () => {
    state.abort?.abort();
    finishConfirm(false);
  });
}

function renderSafetyOptions() {
  const box = $('safetyOptions');
  box.innerHTML = '';
  for (const mode of Object.values(SAFETY_MODES)) {
    const label = el('label', `safety-option${state.settings.safetyMode === mode.id ? ' active' : ''}`);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'safety';
    input.value = mode.id;
    input.checked = state.settings.safetyMode === mode.id;
    input.hidden = true;
    input.addEventListener('change', () => {
      document.querySelectorAll('.safety-option').forEach((n) => n.classList.remove('active'));
      label.classList.add('active');
      $('safetyWarning').hidden = mode.id !== 'auto';
    });
    label.append(input, el('span', '', mode.label), el('small', '', mode.description));
    label.addEventListener('click', () => {
      input.checked = true;
      input.dispatchEvent(new Event('change'));
    });
    box.append(label);
  }
  $('safetyWarning').hidden = state.settings.safetyMode !== 'auto';
}

function bindLiveModal() {
  $('btnLive').addEventListener('click', () => {
    $('backdrop').hidden = false;
    openModal('modalLive');
  });
  $('btnLiveRear').addEventListener('click', () => startLiveSource('camera', 'environment'));
  $('btnLiveFront').addEventListener('click', () => startLiveSource('camera', 'user'));
  $('btnLiveScreen').addEventListener('click', () => startLiveSource('screen'));
  $('btnLiveStop').addEventListener('click', stopLiveSources);
  $('btnLiveAsk').addEventListener('click', liveAsk);
  $('btnLiveMic').addEventListener('click', () => {
    state.voice.stop();
    state.voice.listen({
      onFinal: (text) => {
        if (!text.trim()) return;
        $('liveQuestion').value = text.trim();
        liveAsk();
      },
      onError: (message) => renderLiveStatus(message)
    });
    renderLiveStatus('تكلّم…');
  });
  $('btnLiveBridgeShot').addEventListener('click', async () => {
    if (!state.bridgeOnline) {
      renderLiveStatus('الجسر غير متصل.');
      return;
    }
    try {
      const shot = await state.live.captureScreenViaBridge();
      const img = new Image();
      img.src = base64DataUrl(shot.base64, shot.mime);
      $('liveAnswer').textContent = `صورة الشاشة جاهزة (${shot.method}). اكتب سؤالك ثم «اسأل الآن» لتحليلها.`;
      state.live.bridgeShot = shot;
      renderLiveStatus('التُقطت الشاشة عبر الجسر.');
    } catch (err) {
      renderLiveStatus(err.message);
    }
  });
  $('btnLiveAuto').addEventListener('click', () => {
    if (autoLiveTimer) {
      clearInterval(autoLiveTimer);
      autoLiveTimer = null;
      $('btnLiveAuto').textContent = '▶︎ تحليل مستمر (كل ٤ ثوانٍ)';
      renderLiveStatus('أُوقف التحليل المستمر.');
      return;
    }
    $('btnLiveAuto').textContent = '⏸ إيقاف التحليل المستمر';
    renderLiveStatus('تحليل مستمر كل ٤ ثوانٍ…');
    autoLiveTimer = setInterval(() => {
      if (!state.running) liveAsk();
    }, 4000);
  });
}

function bindFilesModal() {
  $('btnFilesPick').addEventListener('click', () => $('filesInput').click());
  $('filesInput').addEventListener('change', async (event) => {
    await addFiles(event.target.files);
    event.target.value = '';
  });
  $('btnFilesClear').addEventListener('click', () => {
    state.lab.clear();
    $('quizBox').hidden = true;
    renderFiles();
  });
  $('btnFilesSummary').addEventListener('click', () =>
    filesAsk('لخّص كل ملف على حدة، ثم أعطِ خلاصة موحّدة بالنقاط الأساسية والأرقام المهمة والخطوات العملية.', 'تلخيص الملفات')
  );
  $('btnFilesTables').addEventListener('click', () =>
    filesAsk('استخرج كل الجداول والحقول من الملفات بصيغة Markdown، واذكر لكل جدول اسم الملف والأعمدة وأنواع البيانات.', 'استخراج الجداول والحقول')
  );
  $('btnFilesQuiz').addEventListener('click', startQuiz);
}

function bindStudioModal() {
  $('studioTabs').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#studioTabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('#modalStudio .tab-panel').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tab.dataset.tab;
    });
  });
  $('btnGenImage').addEventListener('click', generateStudioImage);
  $('btnGenSong').addEventListener('click', generateStudioSong);
  $('btnGenVideo').addEventListener('click', generateStudioVideo);
  $('btnGenDoc').addEventListener('click', generateStudioDoc);
}

function bindAppsModal() {
  $('appTabs').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    state.appBuffers[state.appTab] = $('appCode').value;
    state.appTab = tab.dataset.apptab;
    document.querySelectorAll('#appTabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('appCode').value = state.appBuffers[state.appTab] || '';
  });
  $('appCode').addEventListener('input', () => {
    state.appBuffers[state.appTab] = $('appCode').value;
  });
  $('btnAppPreview').addEventListener('click', updateAppPreview);
  $('btnAppAudit').addEventListener('click', appAudit);
  $('btnAppBundle').addEventListener('click', () => appExport('bundle'));
  $('btnAppApk').addEventListener('click', () => appExport('apk'));
  $('appCode').value = state.appBuffers.html;
  updateAppPreview();
}

function bindDeviceModal() {
  $('btnDeviceScan').addEventListener('click', scanDevice);
  $('btnDeviceInstallAll').addEventListener('click', installAllMissing);
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

function bindGlobalShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.querySelectorAll('.modal:not([hidden])').forEach((modal) => closeModal(modal.id));
      $('drawer').hidden = true;
      $('backdrop').hidden = true;
    }
    // Ctrl/Cmd + K → wake microphone (assistant key substitute)
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      $('btnMic').click();
    }
  });
  window.addEventListener('online', () => syncInternetFlag());
}

async function init() {
  if (!store.state.sessions.length) {
    const session = store.createSession();
    store.selectSession(session.id);
  }
  setupVoice();
  state.live = new LiveSession({
    getSettings: () => state.settings,
    onEvent: () => {},
    bridge: null
  });
  state.lab = new FileLab({
    bridge: null,
    onStatus: (text) => {
      $('filesStatus').textContent = text;
    }
  });

  buildSelects();
  settingsToUI();
  bindModalClosers();
  bindComposer();
  bindMenus();
  bindSettingsModal();
  bindMemoryModal();
  bindSafetyModal();
  bindLiveModal();
  bindFilesModal();
  bindStudioModal();
  bindAppsModal();
  bindDeviceModal();
  bindGlobalShortcuts();

  await setupBridge();
  state.live.bridge = state.bridge;
  state.lab.bridge = state.bridge;

  renderSessions();
  renderAllMessages();
  renderMemoryList();
  renderFiles();
  autosize();

  if (state.settings.wakeEnabled && voiceSupport().wake) startWake();

  const support = mediaSupport();
  if (!support.camera) {
    $('btnLiveRear').disabled = true;
    $('btnLiveFront').disabled = true;
  }
  if (!support.screen) $('btnLiveScreen').title = 'أندرويد لا يدعم getDisplayMedia — استخدم «التقاط عبر الجسر»';

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Android app shortcuts / deep links: #live, #files, #studio, #apps, #device, #memory
  const hashTargets = {
    live: 'modalLive',
    files: 'modalFiles',
    studio: 'modalStudio',
    apps: 'modalApps',
    device: 'modalDevice',
    memory: 'modalMemory',
    settings: 'modalSettings'
  };
  const hash = String(location.hash || '').replace('#', '');
  if (hashTargets[hash]) {
    $('backdrop').hidden = false;
    openModal(hashTargets[hash]);
    if (hash === 'device') scanDevice();
    if (hash === 'memory') {
      $('personaRules').value = store.state.personaRules || '';
      renderMemoryList();
    }
  }

  if (state.bridgeOnline) {
    toast(`${APP_NAME_AR} جاهز · الجسر متصل`);
  } else if (state.settings.apiKey) {
    toast('العقل جاهز · الجسر غير متصل (التنفيذ على الهاتف معطّل)');
  }
  document.body.dataset.qaswaraReady = '1';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Exposed for the smoke tests and for console-based recovery.
window.qaswara = {
  state,
  store,
  send,
  scanDevice,
  checkBridge,
  version: APP_VERSION,
  openModal,
  closeModal
};
