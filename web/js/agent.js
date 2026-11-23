/**
 * QASWARA agent core — plan → act → observe → repeat → final report.
 *
 * The loop is deliberately protocol-based (a single JSON object per turn)
 * instead of relying on native tool-calling, because the same code then works
 * identically on Gemini, Groq, OpenAI, DeepSeek and OpenRouter.
 *
 * Hard guarantees:
 *  - Never more than `maxSteps` model calls; a forced wrap-up follows.
 *  - The model never sees a success it did not get from the bridge.
 *  - Every destructive command passes client policy + user confirmation, and
 *    the bridge re-checks it server-side.
 */

import { chat as defaultChat, ProviderError, redact } from './providers.js';
import { buildMemoryDigest } from './memory.js';
import { assessCommand, decideExecution, previewCommand } from './safety.js';
import { formatExecutionResult } from './tools.js';
import { LIMITS, providerFor } from './config.js';

export class AgentError extends Error {
  constructor(message, { kind = 'agent', cause } = {}) {
    super(message);
    this.name = 'AgentError';
    this.kind = kind;
    this.cause = cause;
  }
}

export const TOOL_DOCS = {
  exec: {
    signature: 'exec({code, lang?, cwd?, timeout?})',
    description:
      'ينفّذ أمراً على الهاتف عبر الجسر المحلي: bash أو sh أو python3. يعيد exit code + stdout + stderr. استخدمه للملفات، البرمجة، تحليل البيانات، ffmpeg، termux-api…'
  },
  read_file: {
    signature: 'read_file({path})',
    description: 'يقرأ ملفاً نصياً داخل مساحة عمل الجسر ويعيد محتواه.'
  },
  write_file: {
    signature: 'write_file({path, content, append?})',
    description: 'يكتب/ينشئ ملفاً نصياً داخل مساحة عمل الجسر (سكربتات، CSV، Markdown…).'
  },
  list_dir: {
    signature: 'list_dir({path})',
    description: 'يسرد محتويات مجلد داخل مساحة العمل (اسم، نوع، حجم).'
  },
  memory_search: {
    signature: 'memory_search({query})',
    description: 'يبحث في الذاكرة طويلة المدى (قواعد، تفضيلات، مشاريع) ويعيد النتائج.'
  },
  memory_save: {
    signature: 'memory_save({kind, content})',
    description:
      'يحفظ معلومة دائمة عن المستخدم أو مشروعه. الأنواع: rule | preference | skill | project | fact.'
  },
  device_info: {
    signature: 'device_info({refresh?})',
    description:
      'يفحص الهاتف والجسر الآن: الأدوات والمكتبات المثبتة، الصلاحيات، والقدرات (شاشة، كاميرا، جهات اتصال، اتصال/SMS، OCR، ffmpeg، PDF، بناء APK) مع قائمة ما ينقصك وأمر تثبيته. استخدمه قبل أن تقول «لا أستطيع».'
  },
  install_tool: {
    signature: 'install_tool({manager, name})',
    description:
      'يثبّت ما ينقصك: manager = pkg (Termux) أو pip (Python). أمثلة: pkg ffmpeg، pkg termux-api، pip openpyxl، pip pypdf. مسموح فقط ضمن قائمة الأمان في الجسر.'
  },
  phone: {
    signature: 'phone({action, number?, message?, title?, body?})',
    description:
      'يتحكم بالهاتف عبر termux-api/rish: action = contacts (بحث عن رقم) | call (مكالمة) | sms (رسالة) | whatsapp (فتح محادثة مع نص) | battery | notify (إشعار) | clipboard (قراءة الحافظة). ابحث في contacts أولاً إن لم تعرف الرقم.'
  },
  capture_screen: {
    signature: 'capture_screen({save?})',
    description:
      'يلتقط الشاشة عبر Shizuku/rish ويحفظ الصورة في مساحة العمل، ويعيد المسار. استخدمه عند سؤال المستخدم عن محتوى شاشته أو ترجمة شاشة كاملة.'
  },
  extract_file: {
    signature: 'extract_file({path})',
    description:
      'يستخرج النص من PDF / Word / Excel / CSV / الصور (OCR) داخل مساحة العمل لتحليله أو تلخيصه أو بناء جدول منه.'
  },
  create_document: {
    signature: 'create_document({kind, path, payload})',
    description:
      'ينشئ ملفاً حقيقياً: pdf | xlsx | docx | csv | md | html | rtf | zip. مرّر payload كائناً: {title, sections:[{heading,body:[]}]} للمستندات، {rows:[[...]]} للجداول، {files:{name:content}} للأرشيف.'
  },
  synth_media: {
    signature: 'synth_media({action, ...})',
    description:
      'ينتج وسائط فعلية: action = song (كلمات + لحن + غناء اختياري → wav/mp3) | video (صور/ألوان + صوت → mp4) | trim (قص صوت). مرّر title, lyrics, bpm, seconds, scale, vocals, images, audio.'
  },
  export_app: {
    signature: 'export_app({kind, name, files})',
    description:
      'يصدّر تطبيقاً: kind = bundle (ZIP يعمل كتطبيق ويب) أو apk (يبني APK حقيقياً إن وُجدت أدوات Android، وإلا يشرح ما ينقص). files = {اسم الملف: المحتوى}.'
  },
  audit_code: {
    signature: 'audit_code({code?, path?, lang?})',
    description:
      'مراجع قسورة الداخلي (Artemis): يفحص الكود/النص ويكشف أخطاء الصياغة والثغرات والأسرار المسرّبة ويعطي درجة 0-100. استخدمه قبل تسليم أي كود للمستخدم.'
  }
};

const PROTOCOL = `# بروتوكول الرد (صارم جداً)
ردّك في كل دورة يجب أن يكون **كائن JSON واحداً فقط** دون أي نص قبله أو بعده ودون علامات markdown.
إما خطة تنفيذ:
{"thought":"سبب مختصر جداً","action":{"tool":"اسم_الأداة","args":{...}}}
أو الإنهاء مع التقرير:
{"thought":"انتهى العمل","final":"التقرير النهائي الكامل للمستخدم"}

قواعد البروتوكول:
- حقل thought إلزامي وقصير (سطر أو سطران).
- لا تضع أكثر من action واحد في الرد؛ إذا احتجت خطوتين نفّذ الأولى وانتظر الـ OBSERVATION.
- لا تكتب أي شرح خارج JSON. أي حرف خارج الكائن يُعد خطأ تنسيق.
- لا تخترع اسم أداة غير موجودة في القائمة.`;

const ROLE_RULES = `# هويتك
أنت **قسورة | QASWARA** — الوكيل التنفيذي المستقل الذي يعمل داخل هاتف المستخدم (Samsung S23 Ultra + Termux) بعقل سحابي ويد محلية.
أنت لست روبوت دردشة: أنت عامل ينفّذ مهام فعلية حتى نهايتها ثم يقدّم تقريراً احترافياً.
لا تتقمّص أي اسم أو هوية أخرى؛ هويتك قسورة فقط.

# قواعد إلزامية لا تُخترق
1. لا تدّعي أبداً أنك نفّذت أمراً أو أنشأت ملفاً قبل أن يصلك OBSERVATION يثبت ذلك. إن لم تصلك نتيجة، قل إن التنفيذ لم يحدث.
2. إن كانت الأدوات غير متاحة، صرّح بذلك بوضوح واقترح ما يمكن فعله، ولا تتخيل نتائج.
3. إن فشل أمر، اقرأ stderr وأصلح السبب وأعد المحاولة (حتى ٣ محاولات للخطوة نفسها) قبل أن تستسلم وتشرح العائق.
4. لا تنفّذ أوامر مدمّرة (حذف جذري، تغيير صلاحيات النظام، تعطيل التطبيقات) إلا إذا طلبها المستخدم نصاً صريحاً، واذكر التحذير.
5. لا تُرسل مفاتيح API أو رموزاً سرية إلى أي أمر أو ملف أو رابط خارجي.
6. اللغة: أجب بلغة المستخدم (العربية افتراضياً) وبأسلوب تنفيذي موجز، دون حشو.
7. التقرير النهائي يجب أن يحتوي: ما تم إنجازه، مسارات الملفات الناتجة، الأوامر الأساسية التي نجحت، وأي عوائق أو خطوات تالية.
8. الوعي بالذات: قبل أن تعلن عجزك، استخدم device_info لتعرف ما هو مثبت فعلاً. إن نقصت أداة أو مكتبة، استخدم install_tool لتثبيتها ثم أعد المحاولة تلقائياً.
9. عند الفشل، اذكر العائق بدقة: اسم الأداة/المكتبة الناقصة أو الصلاحية (Termux / Shizuku / termux-api) وخطوة التثبيت، ثم اقترح البديل المتاح الآن.
10. خطّط بخطوات صغيرة يمكن التحقق منها؛ كل خطوة يجب أن تعطي نتيجة قابلة للفحص (exit code، ملف موجود، عدد صفوف…). لا تكرر أمراً فشل مرتين بنفس الشكل، بل غيّر الأسلوب.
11. الملفات والوسائط: استخدم create_document و synth_media و export_app بدل كتابة سكربتات طويلة إلا إذا احتجت مرونة أكبر.
12. قبل تسليم أي كود أو مستند مهم، شغّل audit_code وأصلح ما يجده (أو اشرح ما تعذّر إصلاحه).
13. لا تُنشئ ملفات خارج مساحة العمل، ولا تلمس /system أو /data، ولا ترسل بيانات المستخدم لأي جهة غير مزوّد العقل نفسه.`;

/** Which tools are actually usable right now. */
export function availableTools({ bridgeOnline = false, mode = 'confirm' } = {}) {
  if (!bridgeOnline || mode === 'locked') return [];
  return Object.keys(TOOL_DOCS);
}

export function buildToolDocs(tools) {
  return tools
    .map((name) => `- ${TOOL_DOCS[name].signature}: ${TOOL_DOCS[name].description}`)
    .join('\n');
}

/**
 * @param {object} p
 * @param {object} p.settings
 * @param {string[]} [p.tools]
 * @param {string} [p.personaRules]
 * @param {object[]} [p.memories]
 * @param {string} [p.query]
 * @param {boolean} [p.forceFinal]
 */
export function buildSystemPrompt({
  settings,
  tools = [],
  personaRules = '',
  memories = [],
  query = '',
  forceFinal = false
} = {}) {
  const provider = providerFor(settings);
  const digest = buildMemoryDigest({
    personaRules,
    memories,
    query,
    maxChars: LIMITS.memoryDigestChars
  });

  if (!tools.length) {
    const chatOnly = `${ROLE_RULES}

# وضع الدردشة فقط
لا يوجد جسر تنفيذ محلي متصل في هذه اللحظة (أو أن وضع الأمان "معزول").
لذلك: لا تستخدم أي بروتوكول JSON، ولا تدّعي تنفيذ أوامر على الجهاز. أجب نصياً بشكل مباشر ومفيد.
إن طلب المستخدم مهمة تحتاج تنفيذاً على الهاتف، اشرح له أن يفعّل الجسر من الإعدادات ثم أعد الطلب.
${digest ? `\n${digest}` : ''}`;
    return chatOnly;
  }

  return `${ROLE_RULES}

# بيئة التنفيذ
- العقل: ${provider.label} (${settings.model}).
- اليد: جسر محلي على الهاتف. مساحة العمل محصورة في مجلد الجسر؛ المسارات المطلقة خارجها تُرفض.
- إذا نقصت أداة، يعيد الجسر خطأً فيه حقل install (manager + name). استخدم install_tool ثم أعد المحاولة — وهذا مسموح تلقائياً.
- بعض الأوامر تحتاج صلاحية Shizuku (rish) أو حزمة termux-api؛ إن ظهر ذلك فاذكره صراحة للمستخدم مع خطوة التفعيل.
- كل أمر يعود إليك مع exit code و stdout و stderr. اعتمد عليهما فقط.

# الأدوات المتاحة
${buildToolDocs(tools)}

${PROTOCOL}
${forceFinal ? '\n# تنبيه\nانتهت ميزانية الخطوات. لا تنفّذ أداة الآن. أخرج كائن JSON يحتوي final فقط، واذكر ما اكتمل وما تبقّى.' : ''}
${digest ? `\n${digest}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* Response parsing                                                    */
/* ------------------------------------------------------------------ */

/** Return the first balanced JSON object substring, ignoring braces in strings. */
export function extractJsonObject(text) {
  const src = String(text ?? '');
  const start = src.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

/** Low-risk repairs for the mistakes models actually make. */
export function repairJson(text) {
  return String(text)
    .replace(/^[`\s]*json\s*/i, '')
    .replace(/```/g, '')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(repairJson(text));
    } catch {
      return null;
    }
  }
}

/**
 * @returns {{kind:'final', text:string, thought:string}
 *          |{kind:'action', tool:string, args:object, thought:string}
 *          |{kind:'invalid', reason:string, raw:string}}
 */
export function parseAgentResponse(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { kind: 'invalid', reason: 'رد فارغ', raw };

  const candidate = extractJsonObject(raw) || raw;
  const obj = safeJsonParse(candidate);
  if (!obj || typeof obj !== 'object') {
    // A model that ignored the protocol but wrote plain prose: accept it only
    // when tools were not in play; the caller decides.
    return { kind: 'invalid', reason: 'لم أجد كائن JSON صالحاً في الرد', raw };
  }

  const thought = typeof obj.thought === 'string' ? obj.thought.slice(0, 600) : '';

  const finalText = typeof obj.final === 'string' ? obj.final
    : typeof obj.answer === 'string' ? obj.answer
    : typeof obj.final_answer === 'string' ? obj.final_answer
    : null;
  if (finalText !== null) {
    return { kind: 'final', text: finalText.trim(), thought };
  }

  const action = obj.action && typeof obj.action === 'object' ? obj.action : null;
  let tool = action?.tool || obj.tool || obj.name || '';
  let args = action?.args || action?.parameters || obj.args || obj.parameters || obj.input || {};

  if (typeof args === 'string') {
    const parsedArgs = safeJsonParse(args);
    args = parsedArgs && typeof parsedArgs === 'object' ? parsedArgs : { code: args };
  }

  if (!tool && typeof obj.code === 'string') {
    tool = 'exec';
    args = { code: obj.code, lang: obj.lang };
  }

  if (tool) {
    if (tool === 'done' || tool === 'finish' || tool === 'final') {
      const text2 = args?.final || args?.answer || args?.summary || obj.thought || 'تم.';
      return { kind: 'final', text: String(text2), thought };
    }
    return { kind: 'action', tool: String(tool), args: args || {}, thought };
  }

  return { kind: 'invalid', reason: 'لا يوجد final ولا action في الرد', raw };
}

/* ------------------------------------------------------------------ */
/* Agent                                                               */
/* ------------------------------------------------------------------ */

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      },
      { once: true }
    );
  });

function trimObservation(text, maxChars = LIMITS.observationChars) {
  const s = String(text ?? '');
  if (s.length <= maxChars) return s;
  const half = Math.floor(maxChars / 2);
  return `${s.slice(0, half)}\n… [اختصار ${s.length - maxChars} حرفاً] …\n${s.slice(-half)}`;
}

export class Agent {
  /**
   * @param {object} deps
   * @param {object} deps.settings
   * @param {import('./tools.js').BridgeClient|null} deps.bridge
   * @param {boolean} [deps.bridgeOnline]
   * @param {(e:object)=>void} [deps.onEvent]
   * @param {(req:object)=>Promise<boolean>} [deps.confirm] resolves true to allow a command
   * @param {(p:object)=>Promise<object>} [deps.chatImpl]
   * @param {(m:{kind:string,content:string})=>Promise<any>} [deps.saveMemory]
   */
  constructor({
    settings,
    bridge = null,
    bridgeOnline = false,
    onEvent = () => {},
    confirm = async () => false,
    chatImpl = defaultChat,
    saveMemory = null,
    fetchImpl = globalThis.fetch
  }) {
    this.settings = settings;
    this.bridge = bridge;
    this.bridgeOnline = Boolean(bridgeOnline);
    this.onEvent = onEvent;
    this.confirm = confirm;
    this.chat = chatImpl;
    this.saveMemory = saveMemory;
    this.fetchImpl = fetchImpl;
    this._consecutiveOffline = 0;
  }

  get tools() {
    return availableTools({ bridgeOnline: this.bridgeOnline, mode: this.settings.safetyMode });
  }

  buildMessages(history, prompt) {
    const window = Math.max(2, Number(this.settings.historyWindow) || 12);
    const recent = history.slice(-window).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 8000)
    }));
    return [...recent, { role: 'user', content: prompt }];
  }

  async chatWithRetry({ system, messages, signal }, { retries = 2 } = {}) {
    let attempt = 0;
    for (;;) {
      try {
        return await this.chat({
          settings: this.settings,
          system,
          messages,
          signal,
          fetchImpl: this.fetchImpl
        });
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        const retryable = err instanceof ProviderError && err.retryable;
        if (!retryable || attempt >= retries) throw err;
        attempt += 1;
        const backoff = 600 * 2 ** (attempt - 1);
        this.onEvent({ type: 'retry', attempt, backoff, message: err.message });
        await sleep(backoff, signal);
      }
    }
  }

  /**
   * @param {object} p
   * @param {string} p.prompt
   * @param {Array<{role:string, content:string}>} [p.history]
   * @param {{personaRules?:string, memories?:object[]}} [p.memory]
   * @param {AbortSignal} [p.signal]
   */
  async run({ prompt, history = [], memory = {}, signal }) {
    const started = Date.now();
    const steps = [];
    const tools = this.tools;
    const mode = tools.length ? 'agent' : 'chat';
    this._consecutiveOffline = 0;

    this.onEvent({ type: 'start', mode, tools });

    if (mode === 'chat') {
      const system = buildSystemPrompt({ settings: this.settings, tools: [], ...memory, query: prompt });
      const messages = this.buildMessages(history, prompt);
      const result = await this.chatWithRetry({ system, messages, signal });
      this.onEvent({ type: 'final', text: result.text, steps, usage: result.usage });
      return {
        final: result.text,
        steps,
        usage: result.usage,
        mode,
        stopped: false,
        durationMs: Date.now() - started
      };
    }

    const system = buildSystemPrompt({
      settings: this.settings,
      tools,
      personaRules: memory.personaRules,
      memories: memory.memories,
      query: prompt
    });
    const messages = this.buildMessages(history, prompt);
    let formatErrors = 0;

    for (let index = 1; index <= this.settings.maxSteps; index += 1) {
      if (signal?.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });

      const result = await this.chatWithRetry({ system, messages, signal });
      if (!result.text && result.finishReason === 'MAX_TOKENS') {
        throw new AgentError(
          'استنفد النموذج حدّ المخرجات قبل أن يكمل الرد. ارفع «حد المخرجات» من الإعدادات (٤٠٩٦ أو أعلى) أو اختصر الطلب.',
          { kind: 'budget' }
        );
      }
      messages.push({ role: 'assistant', content: result.text });
      const parsed = parseAgentResponse(result.text);

      if (parsed.kind === 'final') {
        this.onEvent({ type: 'final', text: parsed.text, steps, usage: result.usage });
        return {
          final: parsed.text,
          steps,
          usage: result.usage,
          mode,
          stopped: false,
          durationMs: Date.now() - started
        };
      }

      if (parsed.kind === 'invalid') {
        formatErrors += 1;
        const looksLikeProse = !/[{}]/.test(parsed.raw);
        if (looksLikeProse) {
          // Provider ignored the protocol but produced a usable answer. Accept it
          // rather than looping forever — but only when no tool ran.
          this.onEvent({ type: 'final', text: parsed.raw.trim(), steps, usage: result.usage });
          return {
            final: parsed.raw.trim(),
            steps,
            usage: result.usage,
            mode,
            stopped: false,
            durationMs: Date.now() - started
          };
        }
        if (formatErrors >= 2) {
          throw new AgentError(
            'النموذج لا يلتزم بصيغة JSON المطلوبة. جرّب نموذجاً أقوى (gpt-4o / gemini-2.5-pro / deepseek-chat) أو أعد صياغة الطلب.',
            { kind: 'protocol' }
          );
        }
        this.onEvent({ type: 'format-error', message: parsed.reason });
        messages.push({
          role: 'user',
          content: `FORMAT ERROR: ${parsed.reason}. أعد الإرسال بكائن JSON واحد فقط (action أو final)، دون أي نص خارجه.`
        });
        continue;
      }

      // ---- action ----
      formatErrors = 0;
      const tool = parsed.tool;
      const args = parsed.args || {};
      const step = {
        index,
        thought: parsed.thought,
        tool,
        args: summarizeArgs(tool, args),
        status: 'running',
        risk: null,
        observation: '',
        startedAt: Date.now()
      };
      steps.push(step);
      this.onEvent({ type: 'step', step, phase: 'start' });

      let observation;
      try {
        observation = await this.execute(tool, args, { step, signal, mode });
        step.status = step.status === 'running' ? 'ok' : step.status;
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        step.status = 'error';
        step.error = err.message;
        this.onEvent({ type: 'step', step, phase: 'error', message: err.message });
        observation = `ERROR: ${err.message}`;
        if (err?.code === 'offline' || err?.code === 'auth') {
          this._consecutiveOffline += 1;
          if (this._consecutiveOffline >= 2) {
            throw new AgentError(
              err.code === 'auth'
                ? 'رمز الجسر غير صحيح. حدّثه في الإعدادات ثم أعد المحاولة.'
                : 'انقطع الاتصال بالجسر المحلي أثناء التنفيذ. شغّل الجسر من Termux ثم أعد المحاولة.',
              { kind: 'bridge', cause: err }
            );
          }
        }
      }
      step.durationMs = Date.now() - step.startedAt;
      step.observation = trimObservation(observation);
      this.onEvent({ type: 'step', step, phase: 'end' });

      messages.push({
        role: 'user',
        content: `OBSERVATION (${tool}) — اعتمد على هذه النتيجة فقط:\n${step.observation}\n\nإن كانت المهمة لم تكتمل، نفّذ الخطوة التالية بـ JSON. وإن اكتملت، أعد final.`
      });
      this.compact(messages);
    }

    // ---- step budget exhausted: force a report, no more tool calls ----
    this.onEvent({ type: 'budget', steps: steps.length });
    const finalSystem = buildSystemPrompt({
      settings: this.settings,
      tools,
      personaRules: memory.personaRules,
      memories: memory.memories,
      query: prompt,
      forceFinal: true
    });
    messages.push({
      role: 'user',
      content:
        'انتهت ميزانية الخطوات. أخرج الآن JSON فيه {"final": "..."} فقط: تقرير بما أنجزته فعلياً اعتماداً على OBSERVATIONS، وما لم يكتمل وسببه.'
    });
    const wrap = await this.chatWithRetry({ system: finalSystem, messages, signal });
    if (!wrap.text && wrap.finishReason === 'MAX_TOKENS') {
      throw new AgentError('تعذّر إعداد التقرير: النموذج وصل لحدّ المخرجات. ارفع الحد ثم أعد المحاولة.', {
        kind: 'budget'
      });
    }
    const parsedWrap = parseAgentResponse(wrap.text);
    const text = parsedWrap.kind === 'final' ? parsedWrap.text : wrap.text.trim();
    this.onEvent({ type: 'final', text, steps, usage: wrap.usage });
    return {
      final: text,
      steps,
      usage: wrap.usage,
      mode,
      stopped: false,
      budgetExhausted: true,
      durationMs: Date.now() - started
    };
  }

  /** Keep the prompt under control: drop the oldest tool exchanges first. */
  compact(messages) {
    const budget = 120000; // characters, ~30k tokens
    let total = messages.reduce((n, m) => n + m.content.length, 0);
    while (total > budget && messages.length > 4) {
      const idx = messages.findIndex((m) => m.role === 'user' && m.content.startsWith('OBSERVATION'));
      if (idx === -1) break;
      total -= messages[idx].content.length;
      messages.splice(idx, 1);
      if (messages[idx - 1]?.role === 'assistant') {
        total -= messages[idx - 1].content.length;
        messages.splice(idx - 1, 1);
      }
    }
  }

  /**
   * Shared safety gate for non-shell tools (install / call / sms …).
   * @returns {Promise<{ok:boolean, observation?:string}>}
   */
  async riskGate({ tool, args, level = 'medium', label = '', step = null, mode = this.settings.safetyMode }) {
    const assessment = { level, reasons: label ? [label] : [] };
    const decision = decideExecution({ mode, level });
    if (step) step.risk = level;
    this.onEvent({ type: 'risk', step, assessment, decision });
    if (decision === 'block') {
      return { ok: false, observation: `BLOCKED: وضع الأمان «معزول» يمنع ${label || tool}.` };
    }
    if (decision === 'ask') {
      const approved = await this.confirm({ tool, args, assessment, step, preview: label || tool });
      if (!approved) return { ok: false, observation: 'DENIED: رفض المستخدم التنفيذ. لا تدّعِ أنه نُفِّذ.' };
    }
    return { ok: true };
  }

  /**
   * Execute a tool call with self-repair: when the bridge reports a missing
   * binary/library it installs it (policy-checked server-side) and retries once.
   */
  async execute(tool, args, ctx = {}) {
    try {
      return await this._execute(tool, args, ctx);
    } catch (err) {
      if (err?.name === 'AbortError' || ctx.noRepair) throw err;
      const hint = err?.installHint || err?.details?.install || null;
      if (!hint || !hint.name || !this.bridge) throw err;
      if (hint.manager === 'android-sdk') {
        this.onEvent({
          type: 'workaround',
          step: ctx.step || null,
          tool,
          installed: false,
          need: hint.name,
          message: 'بناء APK يحتاج حزمة Android SDK على الحاسوب (aapt2/d8/apksigner) — سأسلّمك حزمة PWA جاهزة الآن.'
        });
        throw err;
      }
      this.onEvent({
        type: 'workaround',
        step: ctx.step || null,
        tool,
        need: `${hint.manager}:${hint.name}`,
        reason: err.message
      });
      try {
        const installed = await this.bridge.install({
          manager: hint.manager || 'pkg',
          name: hint.name,
          signal: ctx.signal
        });
        this.onEvent({
          type: 'workaround',
          step: ctx.step || null,
          tool,
          installed: true,
          need: `${hint.manager}:${hint.name}`,
          output: trimObservation(installed.stdout || installed.message || 'تم التثبيت', 400)
        });
      } catch (installErr) {
        this.onEvent({
          type: 'workaround',
          step: ctx.step || null,
          tool,
          installed: false,
          need: `${hint.manager}:${hint.name}`,
          message: installErr.message
        });
        throw new AgentError(
          `الأداة المطلوبة «${hint.name}» غير مثبتة وفشل تثبيتها: ${installErr.message}`,
          { kind: 'dependency', cause: installErr }
        );
      }
      return this._execute(tool, args, { ...ctx, noRepair: true });
    }
  }

  /**
   * Execute one tool call. Returns the observation string.
   * Throws BridgeError / AgentError for infrastructure problems.
   */
  async _execute(tool, args, { step, signal, mode }) {
    switch (tool) {
      case 'exec': {
        const code = String(args.code ?? args.command ?? args.cmd ?? '').trim();
        if (!code) throw new AgentError('الأداة exec تحتاج حقل code.', { kind: 'tool' });
        const lang = ['bash', 'sh', 'python', 'python3'].includes(args.lang) ? args.lang : 'bash';
        const assessment = assessCommand({ code });
        const decision = decideExecution({ mode: this.settings.safetyMode, level: assessment.level });
        if (step) step.risk = assessment.level;
        this.onEvent({ type: 'risk', step, assessment, decision });

        if (decision === 'block') {
          step.status = 'blocked';
          return 'BLOCKED: وضع الأمان "معزول" يمنع تنفيذ الأوامر. أخبر المستخدم بتفعيل الجسر ووضع التأكيد/التلقائي.';
        }
        if (decision === 'ask') {
          const approved = await this.confirm({
            tool,
            args: { code, lang, cwd: args.cwd, timeout: args.timeout },
            preview: previewCommand(code),
            assessment,
            step
          });
          if (!approved) {
            step.status = 'denied';
            return 'DENIED: المستخدم رفض تنفيذ هذا الأمر. اقترح بديلاً آمناً أو اطلب منه تعديل الطلب. لا تدّعِ أن الأمر نُفّذ.';
          }
        }
        if (args.cwd && /(^|\/)\.\.(\/|$)/.test(String(args.cwd))) {
          throw new AgentError('مسار العمل يحتوي ".." وهو مرفوض.', { kind: 'tool' });
        }
        if (!this.bridge) throw new AgentError('لا يوجد جسر متصل.', { kind: 'bridge' });
        const result = await this.bridge.execute({
          code,
          lang,
          cwd: args.cwd,
          timeout: Number(args.timeout) || 60,
          signal
        });
        return formatExecutionResult(result);
      }

      case 'read_file': {
        if (!this.bridge) throw new AgentError('لا يوجد جسر متصل.', { kind: 'bridge' });
        const res = await this.bridge.readFile(String(args.path ?? ''), { signal });
        const content = res.encoding === 'base64' ? '(ملف ثنائي — استخدم exec لتحليله)' : String(res.content ?? '');
        return trimObservation(`path=${res.path} · ${res.size ?? content.length} bytes\n${content}`);
      }

      case 'write_file': {
        if (!this.bridge) throw new AgentError('لا يوجد جسر متصل.', { kind: 'bridge' });
        const content = typeof args.content === 'string' ? args.content : '';
        if (!content && !args.append) throw new AgentError('write_file يحتاج content.', { kind: 'tool' });
        const res = await this.bridge.writeFile(String(args.path ?? ''), content, { append: Boolean(args.append), signal });
        return `تم الكتابة: ${res.path} (${res.bytes} بايت)`;
      }

      case 'list_dir': {
        if (!this.bridge) throw new AgentError('لا يوجد جسر متصل.', { kind: 'bridge' });
        const res = await this.bridge.listDir(String(args.path ?? '.'), { signal });
        const lines = (res.entries || []).map(
          (e) => `${e.type === 'dir' ? '📁' : '📄'} ${e.name}${e.size != null ? ` (${e.size} B)` : ''}`
        );
        return `path=${res.path}\n${lines.join('\n') || '(فارغ)'}`;
      }

      case 'memory_search': {
        const query = String(args.query ?? '').trim();
        if (!query) throw new AgentError('memory_search يحتاج query.', { kind: 'tool' });
        if (!this.bridgeOnline || !this.bridge) {
          return 'MEMORY_BRIDGE_OFFLINE: البحث في ذاكرة الجسر غير متاح الآن؛ اعتمد على الذاكرة المرفقة في التعليمات.';
        }
        const res = await this.bridge.memorySearch(query, { signal });
        const items = res.items || [];
        if (!items.length) return `لا نتائج في ذاكرة الجسر عن: ${query}`;
        return items
          .map((m) => `- [${m.kind}] ${m.content}`)
          .join('\n');
      }

      case 'memory_save': {
        const content = String(args.content ?? '').trim();
        if (content.length < 4) throw new AgentError('memory_save يحتاج content مفيداً.', { kind: 'tool' });
        const kind = ['rule', 'preference', 'skill', 'project', 'fact'].includes(args.kind) ? args.kind : 'fact';
        if (!this.saveMemory) throw new AgentError('حفظ الذاكرة غير مهيأ.', { kind: 'tool' });
        await this.saveMemory({ kind, content });
        return `حُفظت في الذاكرة: [${kind}] ${content.slice(0, 200)}`;
      }

      case 'device_info': {
        if (!this.bridge) throw new AgentError('لا يوجد جسر متصل.', { kind: 'bridge' });
        const info = await this.bridge.device({ refresh: Boolean(args.refresh), signal });
        const caps = info.capabilities || {};
        const lines = Object.entries(caps).map(([key, value]) => `${value ? '✅' : '❌'} ${key}`);
        const missing = (info.advice || []).map((a) => `- ${a.need}: ${a.reason || ''} → ${a.install || ''}`);
        return trimObservation(
          `الأدوات: ${(info.binaries || []).join(', ') || '—'}\n` +
            `مكتبات Python: ${(info.pythonModules || []).join(', ') || '—'}\n` +
            `القدرات:\n${lines.join('\n')}\n` +
            `ما ينقصك:\n${missing.join('\n') || '(لا شيء)'}`
        );
      }

      case 'install_tool': {
        if (!this.bridge) throw new AgentError('لا يوجد جسر متصل.', { kind: 'bridge' });
        const manager = ['pkg', 'pip'].includes(args.manager) ? args.manager : 'pkg';
        const name = String(args.name ?? '').trim();
        if (!name) throw new AgentError('install_tool يحتاج name.', { kind: 'tool' });
        const gate = await this.riskGate({
          tool,
          args: { manager, name },
          level: 'medium',
          label: `تثبيت ${manager} ${name}`,
          step,
          mode
        });
        if (!gate.ok) return gate.observation;
        const res = await this.bridge.install({ manager, name, signal });
        return `تم: ${manager} install ${name}\n${trimObservation(res.stdout || res.message || '', 800)}`;
      }

      case 'phone': {
        if (!this.bridge) throw new AgentError('لا يوجد جسر متصل.', { kind: 'bridge' });
        const action = String(args.action ?? '').trim();
        if (!action) throw new AgentError('phone يحتاج action.', { kind: 'tool' });
        const outward = ['call', 'sms', 'whatsapp'].includes(action);
        if (outward) {
          const gate = await this.riskGate({
            tool,
            args,
            level: 'medium',
            label:
              action === 'call'
                ? `إجراء مكالمة إلى ${args.number || '؟'}`
                : action === 'sms'
                  ? `إرسال رسالة إلى ${args.number || '؟'}`
                  : `فتح واتساب مع ${args.number || '؟'}`,
            step,
            mode
          });
          if (!gate.ok) return gate.observation;
        }
        const res = await this.bridge.phone(
          {
            action,
            number: args.number,
            message: args.message,
            title: args.title,
            body: args.body
          },
          { signal }
        );
        if (action === 'contacts') {
          const items = res.items || [];
          return items.length
            ? items.map((c) => `${c.name}: ${c.number}`).join('\n')
            : 'لا نتائج. تأكد من تثبيت termux-api ومنح صلاحية جهات الاتصال (termux-contact-list).';
        }
        return `تم تنفيذ ${action}. ${res.message || res.stdout || ''}`.trim();
      }

      case 'capture_screen': {
        if (!this.bridge) throw new AgentError('لا يوجد جسر متصل.', { kind: 'bridge' });
        const shot = await this.bridge.captureScreen({ signal });
        let path = shot.path || '';
        if (!shot.base64) return `تم الالتقاط لكن دون بيانات صورة (${shot.method || '?'}).`;
        const target = `captures/screen_${Date.now()}.png`;
        if (args.save !== false) {
          const saved = await this.bridge.uploadFile(target, shot.base64, { mime: shot.mime || 'image/png' });
          path = saved.path;
        }
        return `تم التقاط الشاشة (${shot.method || 'rish'}) وحُفظت في: ${path || target}`;
      }

      case 'extract_file': {
        if (!this.bridge) throw new AgentError('لا يوجد جسر متصل.', { kind: 'bridge' });
        const res = await this.bridge.extractFile(String(args.path ?? ''), { signal });
        const note = res.note ? `\n(ملاحظة: ${res.note})` : '';
        return trimObservation(`المستخرج من ${res.path} عبر ${res.tool}${note}\n${res.text || '(لا نص)'}`);
      }

      case 'create_document': {
        if (!this.bridge) throw new AgentError('لا يوجد جسر متصل.', { kind: 'bridge' });
        const kind = String(args.kind ?? '').toLowerCase();
        const allowed = ['pdf', 'xlsx', 'docx', 'csv', 'md', 'html', 'rtf', 'zip'];
        if (!allowed.includes(kind)) {
          throw new AgentError(`نوع المستند غير مدعوم: ${kind}. المتاح: ${allowed.join(' | ')}`, { kind: 'tool' });
        }
        const res = await this.bridge.createDocument({
          kind,
          path: args.path,
          payload: args.payload && typeof args.payload === 'object' ? args.payload : {}
        });
        return `أُنشئ الملف: ${res.path} (${res.bytes ?? '?'} بايت، النوع ${res.kind})`;
      }

      case 'synth_media': {
        if (!this.bridge) throw new AgentError('لا يوجد جسر متصل.', { kind: 'bridge' });
        const action = ['song', 'video', 'trim'].includes(args.action) ? args.action : 'song';
        const payload = { ...args, action };
        delete payload.__;
        const res = await this.bridge.media(payload);
        const files = (res.files || []).join('\n');
        return trimObservation(
          `تم ${action}. الملفات:\n${files}\n${res.note ? `ملاحظة: ${res.note}` : ''}`
        );
      }

      case 'export_app': {
        if (!this.bridge) throw new AgentError('لا يوجد جسر متصل.', { kind: 'bridge' });
        const kind = args.kind === 'apk' ? 'apk' : 'bundle';
        const files = args.files && typeof args.files === 'object' ? args.files : {};
        if (!Object.keys(files).length) throw new AgentError('export_app يحتاج files.', { kind: 'tool' });
        const res = await this.bridge.exportApp({
          kind,
          name: String(args.name || 'QaswaraApp'),
          files
        });
        if (res.ok === false) {
          const missing = (res.missing || []).join(', ');
          return `تعذّر إنشاء APK: ${res.message || 'أدوات Android غير مكتملة'} ${missing ? `(ينقص: ${missing})` : ''}\n` +
            `الحزمة البديلة: ${res.bundle || '(غير متوفرة)'}`;
        }
        return `تم التصدير (${res.kind}): ${res.path}${res.bytes ? ` — ${res.bytes} بايت` : ''}${res.note ? `\n${res.note}` : ''}`;
      }

      case 'audit_code': {
        if (!this.bridge) throw new AgentError('لا يوجد جسر متصل.', { kind: 'bridge' });
        const code = typeof args.code === 'string' ? args.code : '';
        const payload = code ? { code, lang: String(args.lang || 'text') } : { path: String(args.path || '.') };
        const res = await this.bridge.audit(payload);
        const findings = (res.findings || [])
          .slice(0, 12)
          .map((f) => `- [${f.severity}] سطر ${f.line ?? '?'}: ${f.rule}`)
          .join('\n');
        return `درجة الأمان: ${res.score}/100 — ${res.summary || ''}\n${findings || 'لا ملاحظات.'}`;
      }

      default:
        throw new AgentError(`أداة غير معروفة: ${tool}. استخدم فقط: ${this.tools.join(', ')}.`, { kind: 'tool' });
    }
  }
}

function summarizeArgs(tool, args) {
  if (tool === 'exec') {
    return { lang: args.lang || 'bash', code: previewCommand(args.code ?? args.command ?? '', 900), cwd: args.cwd || '' };
  }
  if (tool === 'write_file') {
    const content = String(args.content ?? '');
    return { path: args.path, bytes: content.length, preview: content.slice(0, 300) };
  }
  return { ...args };
}

export { redact };
