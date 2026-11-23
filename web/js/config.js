/**
 * QASWARA · قسورة — shared configuration.
 * Pure data + tiny helpers: importable from the browser and from Node tests.
 */

export const APP_NAME = 'QASWARA';
export const APP_NAME_AR = 'قسورة';
export const APP_TAGLINE = 'الوكيل التنفيذي المستقل';
export const APP_VERSION = '2.0.0';

export const STORAGE_KEY = 'qaswara.agent.v2';
export const LEGACY_STORAGE_KEY = 'jarvis.superagent.v1';
export const SCHEMA_VERSION = 2;

/** Provider catalogue. `kind` selects the wire protocol adapter. */
export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash-image'
    ],
    defaultModel: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    vision: true,
    note: 'طبقة مجانية سخية + دعم الصور والصوت والتوليد البصري.'
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'moonshotai/kimi-k2-instruct', 'qwen/qwen3-32b'],
    defaultModel: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys',
    vision: false,
    note: 'أسرع استجابة — الأفضل لحلقات التنفيذ متعددة الخطوات.'
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
    defaultModel: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    vision: true,
    note: 'أفضل التزاماً بصيغة JSON + رؤية حاسوبية.'
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    vision: false,
    note: 'قوي جداً في البرمجة والاستدلال العميق (R1).'
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'anthropic/claude-3.7-sonnet',
      'deepseek/deepseek-r1',
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.3-70b-instruct',
      'google/gemini-2.0-flash-001'
    ],
    defaultModel: 'anthropic/claude-3.7-sonnet',
    keyUrl: 'https://openrouter.ai/keys',
    vision: true,
    note: 'بوابة واحدة لكل النماذج: Claude 3.7، DeepSeek-R1، Llama…'
  },
  custom: {
    id: 'custom',
    label: 'مزوّد مخصص (OpenAI-compatible)',
    kind: 'openai',
    baseUrl: '',
    models: [],
    defaultModel: '',
    keyUrl: '',
    vision: false,
    note: 'أي خدمة تدعم /chat/completions: vLLM، LM Studio، Together…'
  }
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

/** Curated model list for the top-bar switcher (متعدد النماذج). */
export const MODEL_CHOICES = [
  { id: 'gemini-flash', label: 'Gemini 2.5 Flash', provider: 'gemini', model: 'gemini-2.5-flash', tag: 'سريع' },
  { id: 'gemini-pro', label: 'Gemini 2.5 Pro', provider: 'gemini', model: 'gemini-2.5-pro', tag: 'استدلال' },
  { id: 'claude', label: 'Claude 3.7 Sonnet', provider: 'openrouter', model: 'anthropic/claude-3.7-sonnet', tag: 'كتابة' },
  { id: 'deepseek-r1', label: 'DeepSeek R1', provider: 'openrouter', model: 'deepseek/deepseek-r1', tag: 'تفكير' },
  { id: 'deepseek-chat', label: 'DeepSeek V3', provider: 'deepseek', model: 'deepseek-chat', tag: 'كود' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai', model: 'gpt-4o', tag: 'رؤية' },
  { id: 'groq-llama', label: 'Llama 3.3 70B (Groq)', provider: 'groq', model: 'llama-3.3-70b-versatile', tag: 'سرعة' }
];

export const AUTO_MODEL_ID = 'auto';

/** Auto-Genius routing table: task → preferred models → fallbacks. */
export const AUTO_ROUTES = {
  vision: ['gemini-flash', 'gpt-4o', 'gemini-pro'],
  code: ['deepseek-chat', 'claude', 'gemini-pro'],
  reasoning: ['deepseek-r1', 'gemini-pro', 'claude'],
  writing: ['claude', 'gemini-pro', 'gpt-4o'],
  quick: ['gemini-flash', 'groq-llama', 'gpt-4o'],
  default: ['gemini-flash', 'claude', 'deepseek-chat']
};

/** Safety modes, ordered from most restrictive to most permissive. */
export const SAFETY_MODES = {
  locked: {
    id: 'locked',
    label: 'معزول',
    short: '🔒 معزول',
    description: 'قسورة يفكّر ويكتب فقط. لا تنفيذ أوامر، لا قراءة/كتابة ملفات على الهاتف.'
  },
  confirm: {
    id: 'confirm',
    label: 'تأكيد مسبق',
    short: '🛡️ تأكيد',
    description: 'كل أمر يُعرض عليك أولاً مع تصنيف خطورته، ولا يُنفّذ إلا بموافقتك.'
  },
  auto: {
    id: 'auto',
    label: 'تنفيذ تلقائي',
    short: '⚡ تلقائي',
    description: 'تنفيذ مباشر بدون سؤال. الأوامر عالية الخطورة تبقى محجوبة على مستوى الجسر.'
  }
};

export const DEFAULT_SETTINGS = {
  provider: 'gemini',
  apiKey: '',
  model: 'gemini-2.5-flash',
  modelChoice: 'gemini-flash',
  autoModel: false,
  customBaseUrl: '',
  bridgeUrl: 'auto',
  bridgeToken: '',
  maxSteps: 10,
  temperature: 0.3,
  maxOutputTokens: 4096,
  safetyMode: 'confirm',
  historyWindow: 14,
  bridgeTimeoutMs: 120000,
  // persona / language
  style: 'formal',
  dialect: 'standard',
  language: 'ar',
  // voice
  voiceEnabled: true,
  voiceName: '',
  voiceRate: 1,
  voicePitch: 1,
  autoSpeak: true,
  wakeEnabled: false,
  wakeWord: 'يا قسورة',
  // privacy
  internetEnabled: true,
  scrubSecrets: true,
  // workspace
  workspaceRoot: '/sdcard/Qaswara_Workspace'
};

export const LIMITS = {
  maxSteps: { min: 1, max: 24 },
  temperature: { min: 0, max: 2 },
  maxOutputTokens: { min: 512, max: 16384 },
  historyWindow: { min: 2, max: 40 },
  observationChars: 6000,
  memoryDigestChars: 2400,
  maxInputChars: 12000,
  bridgeTimeoutMs: { min: 5000, max: 600000 },
  voiceRate: { min: 0.5, max: 2 },
  voicePitch: { min: 0, max: 2 }
};

export function clamp(value, { min, max }, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function providerFor(settings) {
  return PROVIDERS[settings?.provider] || PROVIDERS.gemini;
}

export function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  s.provider = PROVIDERS[s.provider] ? s.provider : DEFAULT_SETTINGS.provider;
  s.apiKey = typeof s.apiKey === 'string' ? s.apiKey.trim() : '';
  s.bridgeToken = typeof s.bridgeToken === 'string' ? s.bridgeToken.trim() : '';
  s.customBaseUrl = typeof s.customBaseUrl === 'string' ? s.customBaseUrl.trim().replace(/\/+$/, '') : '';
  s.bridgeUrl = typeof s.bridgeUrl === 'string' && s.bridgeUrl.trim() ? s.bridgeUrl.trim().replace(/\/+$/, '') : 'auto';
  s.model = typeof s.model === 'string' && s.model.trim()
    ? s.model.trim()
    : (PROVIDERS[s.provider].defaultModel || '');
  s.modelChoice = typeof s.modelChoice === 'string' && s.modelChoice.trim() ? s.modelChoice.trim() : 'gemini-flash';
  if (!SAFETY_MODES[s.safetyMode]) s.safetyMode = DEFAULT_SETTINGS.safetyMode;
  s.maxSteps = Math.round(clamp(s.maxSteps, LIMITS.maxSteps, DEFAULT_SETTINGS.maxSteps));
  s.temperature = clamp(s.temperature, LIMITS.temperature, DEFAULT_SETTINGS.temperature);
  s.maxOutputTokens = Math.round(clamp(s.maxOutputTokens, LIMITS.maxOutputTokens, DEFAULT_SETTINGS.maxOutputTokens));
  s.historyWindow = Math.round(clamp(s.historyWindow, LIMITS.historyWindow, DEFAULT_SETTINGS.historyWindow));
  s.bridgeTimeoutMs = Math.round(clamp(s.bridgeTimeoutMs, LIMITS.bridgeTimeoutMs, DEFAULT_SETTINGS.bridgeTimeoutMs));
  s.voiceRate = clamp(s.voiceRate, LIMITS.voiceRate, DEFAULT_SETTINGS.voiceRate);
  s.voicePitch = clamp(s.voicePitch, LIMITS.voicePitch, DEFAULT_SETTINGS.voicePitch);
  s.wakeWord = typeof s.wakeWord === 'string' && s.wakeWord.trim() ? s.wakeWord.trim().slice(0, 40) : DEFAULT_SETTINGS.wakeWord;
  s.workspaceRoot = typeof s.workspaceRoot === 'string' && s.workspaceRoot.trim()
    ? s.workspaceRoot.trim()
    : DEFAULT_SETTINGS.workspaceRoot;
  for (const boolKey of ['autoModel', 'voiceEnabled', 'autoSpeak', 'wakeEnabled', 'internetEnabled', 'scrubSecrets']) {
    s[boolKey] = Boolean(s[boolKey]);
  }
  return s;
}

export function chatEndpoint(settings) {
  const p = providerFor(settings);
  const base = (p.kind === 'openai' && settings.provider === 'custom'
    ? settings.customBaseUrl
    : p.baseUrl).replace(/\/+$/, '');
  if (!base) throw new Error('لم يتم تعيين عنوان Base URL لهذا المزوّد.');
  return p.kind === 'gemini'
    ? `${base}/models/${encodeURIComponent(settings.model)}:generateContent`
    : `${base}/chat/completions`;
}

export function imageEndpoint(settings) {
  const p = providerFor(settings);
  const base = (p.kind === 'openai' && settings.provider === 'custom' ? settings.customBaseUrl : p.baseUrl).replace(/\/+$/, '');
  return p.kind === 'gemini'
    ? `${base}/models/gemini-2.5-flash-image:generateContent`
    : `${base}/images/generations`;
}

export function supportsVision(settings) {
  return Boolean(providerFor(settings).vision);
}
