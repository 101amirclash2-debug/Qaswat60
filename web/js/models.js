/**
 * QASWARA — model catalog helpers and the "Auto-Genius" router.
 *
 * Auto-Genius never hides the choice from the user: the top bar always shows
 * which model actually answered, and routing is a pure function that the tests
 * pin down.
 */

import { MODEL_CHOICES, AUTO_MODEL_ID, AUTO_ROUTES, PROVIDERS, providerFor } from './config.js';

export { MODEL_CHOICES, AUTO_MODEL_ID };

export function choiceById(id) {
  return MODEL_CHOICES.find((c) => c.id === id) || null;
}

/** Rank a request by intent so routing is explainable. */
export function classifyTask(text, { hasImage = false, hasFile = false } = {}) {
  if (hasImage) return 'vision';
  const value = String(text || '').toLowerCase();
  if (/كود|برمج|برنامج|سكربت|خطأ|bug|debug|refactor|python|javascript|typescript|function|api|sql|regex/i.test(value)) {
    return 'code';
  }
  if (/لماذا|فسّر|فسر|حلّل|حلل|استنتج|قارن|plan|architect|معماري|رياضي|logic|reason|prove|أثبت/i.test(value)) {
    return 'reasoning';
  }
  if (/اكتب|صياغة|مقال|قصة|رسالة|تقرير|translate|ترجم|summar|لخّص|شعر/i.test(value)) {
    return 'writing';
  }
  if (hasFile) return 'reasoning';
  if (value.length < 90) return 'quick';
  return 'default';
}

/**
 * Pick a model for the request.
 * @returns {{choiceId:string, reason:string, provider:string, model:string, candidates:string[]}}
 */
export function routeModel({ text, settings, hasImage = false, hasFile = false }) {
  const task = classifyTask(text, { hasImage, hasFile });
  const candidates = [...(AUTO_ROUTES[task] || AUTO_ROUTES.default)];
  const picked = choiceById(candidates[0]) || MODEL_CHOICES[0];
  return {
    task,
    choiceId: picked.id,
    provider: picked.provider,
    model: picked.model,
    reason: `مهمة «${taskLabel(task)}» → ${picked.label}`,
    candidates
  };
}

export function taskLabel(task) {
  return {
    vision: 'بصرية',
    code: 'برمجة',
    reasoning: 'تفكير عميق',
    writing: 'كتابة',
    quick: 'سريعة',
    default: 'عامة'
  }[task] || 'عامة';
}

/** Settings patch for applying a model choice. */
export function applyChoice(settings, choiceId) {
  const choice = choiceById(choiceId);
  if (!choice) return { ...settings, autoModel: false };
  return {
    ...settings,
    autoModel: false,
    modelChoice: choice.id,
    provider: choice.provider,
    model: choice.model
  };
}

export function modelLabel(settings) {
  if (settings.autoModel) return 'Auto-Genius';
  const choice = choiceById(settings.modelChoice);
  if (choice && choice.model === settings.model && choice.provider === settings.provider) return choice.label;
  return `${providerFor(settings).label} · ${settings.model}`;
}

/** Providers that can actually run right now (key present). */
export function usableProviders(settings, keys = {}) {
  return Object.values(PROVIDERS)
    .filter((p) => (p.id === settings.provider ? Boolean(settings.apiKey) : Boolean(keys[p.id])))
    .map((p) => p.id);
}
