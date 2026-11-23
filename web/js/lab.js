/**
 * QASWARA — Smart Files Lab (NotebookLM-style).
 *
 * Upload → store on the bridge → extract text (PDF/DOCX/XLSX/TXT/code/OCR) →
 * discuss, summarise, or run an interactive quiz whose questions are generated
 * as JSON and graded locally (no fake scoring).
 */

export function sanitizeName(name) {
  const base = String(name || 'file')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(-90);
  return base || 'file';
}

export function buildContext(items, { maxChars = 24000 } = {}) {
  const chunks = [];
  let used = 0;
  for (const item of items) {
    if (!item.text) continue;
    const header = `\n\n===== ملف: ${item.name} (${item.kind || '?'}) =====\n`;
    const room = maxChars - used - header.length;
    if (room < 400) break;
    const body = item.text.slice(0, room);
    chunks.push(header + body);
    used += header.length + body.length;
  }
  return { text: chunks.join(''), chars: used, files: items.filter((i) => i.text).length };
}

export function buildQuizPrompt(context, { count = 5, language = 'العربية' } = {}) {
  return `أنت الآن في «وضع اختبرني». اقرأ الملفات التالية واصنع اختباراً تفاعلياً.

القواعد:
- ${count} أسئلة، متزايدة الصعوبة، كلها مستخرجة من محتوى الملفات فقط.
- لكل سؤال ٤ خيارات (A-D) وإجابة صحيحة واحدة.
- أخرج **JSON فقط** بهذا الشكل بلا أي نص خارجه:
{"questions":[{"q":"نص السؤال","options":["أ","ب","ج","د"],"answer":0,"explain":"سبب مختصر"}]}
- answer هو فهرس الخيار الصحيح (0-3).
- اكتب باللغة: ${language}.

المحتوى:
${context}`;
}

export function parseQuiz(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return { ok: false, reason: 'لم أجد JSON في رد النموذج.' };
  let data;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    try {
      data = JSON.parse(raw.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return { ok: false, reason: 'صيغة JSON غير صالحة.' };
    }
  }
  const questions = Array.isArray(data?.questions) ? data.questions : [];
  const clean = questions
    .filter((q) => q && typeof q.q === 'string' && Array.isArray(q.options) && q.options.length >= 2)
    .map((q) => ({
      q: String(q.q).slice(0, 600),
      options: q.options.slice(0, 6).map((o) => String(o).slice(0, 400)),
      answer: Number.isInteger(q.answer) ? Math.max(0, Math.min(q.answer, q.options.length - 1)) : 0,
      explain: typeof q.explain === 'string' ? q.explain.slice(0, 400) : ''
    }));
  if (!clean.length) return { ok: false, reason: 'لم تُستخرج أسئلة صالحة.' };
  return { ok: true, questions: clean };
}

/** Local grading — the UI owns the score. */
export function gradeQuiz(questions, answers) {
  let correct = 0;
  const details = questions.map((question, index) => {
    const chosen = answers[index];
    const ok = chosen === question.answer;
    if (ok) correct += 1;
    return { index, ok, chosen, answer: question.answer, explain: question.explain };
  });
  return {
    correct,
    total: questions.length,
    percent: questions.length ? Math.round((correct / questions.length) * 100) : 0,
    details
  };
}

export function readFileAsBase64(file, scope = globalThis) {
  return new Promise((resolve, reject) => {
    const Reader = scope.FileReader;
    if (!Reader) {
      reject(new Error('قراءة الملفات غير مدعومة في هذه البيئة.'));
      return;
    }
    const reader = new Reader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(new Error(`تعذّر قراءة الملف: ${file?.name || ''}`));
    reader.readAsDataURL(file);
  });
}

export class FileLab {
  /**
   * @param {{bridge:object, onStatus?:Function, readFile?:Function}} deps
   */
  constructor({ bridge = null, onStatus = () => {}, readFile = readFileAsBase64 } = {}) {
    this.bridge = bridge;
    this.onStatus = onStatus;
    this.readFile = readFile;
    this.items = [];
  }

  clear() {
    this.items = [];
  }

  /**
   * Upload + extract every file. Text files work even without a bridge.
   * @param {File[]} files
   */
  async addFiles(files) {
    const added = [];
    for (const file of files) {
      const item = {
        name: file.name,
        size: file.size,
        kind: (file.name.split('.').pop() || '').toLowerCase(),
        text: '',
        path: '',
        note: '',
        status: 'reading'
      };
      try {
        const isText = /\.(txt|md|csv|json|ya?ml|toml|ini|log|py|js|mjs|ts|tsx|jsx|java|kt|c|h|cpp|rs|go|rb|php|sql|sh|bash|html?|css|xml|svg)$/i.test(
          file.name
        ) || /^text\//.test(file.type || '');
        if (isText) {
          item.text = (await file.text()).slice(0, 400000);
          item.note = 'قُرئ في المتصفح';
          item.status = 'ready';
        } else if (this.bridge) {
          this.onStatus?.(`جارٍ رفع ${file.name}…`);
          const base64 = await this.readFile(file);
          const path = `uploads/${Date.now()}_${sanitizeName(file.name)}`;
          await this.bridge.uploadFile(path, base64, { mime: file.type || 'application/octet-stream' });
          item.path = path;
          this.onStatus?.(`جارٍ استخراج نص ${file.name}…`);
          const extracted = await this.bridge.extractFile(path);
          if (extracted.ok === false) {
            item.note = extracted.message || 'لا نص قابل للاستخراج';
            item.status = 'unsupported';
          } else {
            item.text = extracted.text || '';
            item.note = extracted.note || (extracted.truncated ? 'اقتُطع النص — ملف كبير' : '');
            item.status = item.text ? 'ready' : 'empty';
          }
        } else {
          item.note = 'يحتاج الجسر لاستخراج النص من PDF/Office/الصور (شغّله من Termux).';
          item.status = 'needs_bridge';
        }
      } catch (err) {
        item.note = err?.message || 'فشل';
        item.status = 'error';
      }
      this.items.push(item);
      added.push(item);
    }
    return added;
  }

  get ready() {
    return this.items.filter((i) => i.status === 'ready' && i.text);
  }

  context(options = {}) {
    return buildContext(this.ready, options);
  }
}
