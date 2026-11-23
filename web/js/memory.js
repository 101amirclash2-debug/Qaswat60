/**
 * Long-term memory and persona.
 *
 * Two layers:
 *  1. Device (localStorage) — always available, survives offline, user-owned.
 *  2. Bridge (`/memory`) — a SQLite mirror the agent can query across installs
 *     and that survives clearing browser storage. Optional: the app works
 *     without it and syncs when the bridge is reachable.
 */

export const KIND_LABELS = {
  rule: 'قاعدة',
  preference: 'تفضيل',
  skill: 'مهارة',
  project: 'مشروع',
  fact: 'معلومة'
};

export const KIND_ORDER = ['rule', 'preference', 'skill', 'project', 'fact'];

/**
 * Detect "train me" commands. Anchored on purpose: an explicit instruction must
 * be its own message, so ordinary conversation about memory is never captured.
 *
 * @returns {{kind:string, content:string, trigger:string}|null}
 */
export function detectTrainingIntent(text) {
  const value = String(text || '').trim();
  if (!value || value.length < 5) return null;

  const patterns = [
    { kind: 'rule', re: /^(?:تذكر|تذكّر)\s*(?:دائماً|دائما|دوماً|دومًا)?\s*(?:أن|ان|بأن|بأنّ)?\s*[:،,\-]?\s*([\s\S]{4,600})$/ },
    { kind: 'rule', re: /^(?:always\s+remember|remember\s+always|remember)\s*[:,\-]?\s*([\s\S]{4,600})$/i },
    { kind: 'skill', re: /^(?:أضف|اضف)\s*(?:هذه\s*)?المهارة[^:：\n]*[:：]?\s*([\s\S]{4,600})$/ },
    { kind: 'skill', re: /^(?:add|learn)\s+this\s+skill[^:：\n]*[:：]?\s*([\s\S]{4,600})$/i },
    { kind: 'fact', re: /^(?:احفظ|سجّل|سجل)\s*(?:هذه\s*المعلومة|هذه المعلومه|معلومة|أن|ان)?\s*[:،,\-]?\s*([\s\S]{4,600})$/ },
    { kind: 'fact', re: /^(?:save|note)\s+this\s*[:,\-]?\s*([\s\S]{4,600})$/i },
    { kind: 'preference', re: /^(?:تفضيلي|تفضيلاتي|أفضل|افضل)\s*[:،,\-]\s*([\s\S]{4,600})$/ },
    { kind: 'preference', re: /^(?:my\s+preference)\s*[:,\-]\s*([\s\S]{4,600})$/i },
    { kind: 'project', re: /^(?:مشروعي|مشروع)\s*[:،,\-]\s*([\s\S]{4,600})$/ },
    { kind: 'project', re: /^(?:my\s+project)\s*[:,\-]\s*([\s\S]{4,600})$/i }
  ];

  for (const { kind, re } of patterns) {
    const m = value.match(re);
    if (m) {
      const content = m[1].replace(/^[:\-،,\s]+/, '').trim();
      if (content.length >= 4) {
        return { kind, content, trigger: value.slice(0, Math.max(0, value.length - content.length)).trim() };
      }
    }
  }
  return null;
}

function scoreMemory(item, query) {
  if (!query) return 0;
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2);
  if (!words.length) return 0;
  const haystack = item.content.toLowerCase();
  return words.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0);
}

/**
 * Build the block injected into every system prompt.
 * Budget-aware: rules first (always), then the most relevant memories.
 */
export function buildMemoryDigest({ personaRules = '', memories = [], query = '', maxChars = 2400 } = {}) {
  const parts = [];
  let used = 0;

  const rules = String(personaRules || '').trim();
  if (rules) {
    const block = `# قواعد دائمة من المستخدم (أولوية عالية، لا تخالفها):\n${rules.slice(0, Math.floor(maxChars * 0.5))}`;
    parts.push(block);
    used += block.length;
  }

  const ranked = [...memories]
    .map((m) => ({ m, s: scoreMemory(m, query) }))
    .sort((a, b) => (b.s - a.s) || (b.m.createdAt - a.m.createdAt));

  if (ranked.length) {
    const lines = [];
    for (const { m } of ranked) {
      const line = `- [${KIND_LABELS[m.kind] || 'معلومة'}] ${m.content.replace(/\s+/g, ' ').slice(0, 400)}`;
      if (used + line.length + 12 > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    if (lines.length) {
      parts.push(`# ذاكرة طويلة المدى (${lines.length}/${memories.length} عنصر):\n${lines.join('\n')}`);
    }
  }

  return parts.join('\n\n');
}

/** Merge bridge memories into local ones without creating duplicates. */
export function mergeMemories(local = [], remote = []) {
  const byContent = new Map(local.map((m) => [m.content.trim().toLowerCase(), m]));
  const merged = [...local];
  for (const item of remote) {
    const content = String(item.content || '').trim();
    if (!content) continue;
    const key = content.toLowerCase();
    if (byContent.has(key)) continue;
    merged.push({
      id: String(item.id ?? `remote_${byContent.size}`),
      kind: KIND_ORDER.includes(item.kind) ? item.kind : 'fact',
      content,
      source: 'bridge',
      createdAt: Number(item.created_at ?? item.createdAt) || Date.now(),
      synced: true
    });
    byContent.set(key, merged[merged.length - 1]);
  }
  return merged;
}
