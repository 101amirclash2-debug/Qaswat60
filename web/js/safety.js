/**
 * Client-side risk assessment for commands the agent wants to run.
 *
 * This is the *last* line of defence, not the only one: the Termux bridge
 * enforces its own deny-list (bridge/policy.py) because a prompt-injected
 * model can talk the UI into "auto" mode.
 */

const RULES = [
  // ---- critical: can brick the phone or wipe user data -------------------
  {
    level: 'high',
    re: /\brm\s+(-[a-zA-Z]+\s+)*-[a-zA-Z]*r[a-zA-Z]*f?[a-zA-Z]*\s+(\/|\/\*|~|\$HOME)\s*(;|&|\||$)/,
    reason: 'حذف جذري لمجلد النظام أو مجلد المستخدم'
  },
  {
    level: 'high',
    re: /\brm\s+(-[a-zA-Z]+\s+)*-[a-zA-Z]*r[a-zA-Z]*f?[a-zA-Z]*\s+\/(data|system|vendor|product|storage|sdcard|etc|usr|bin|boot|dev)\b/,
    reason: 'حذف جذري لقسم نظام/بيانات الهاتف'
  },
  { level: 'high', re: /\bmkfs(\.[a-z0-9]+)?\b/, reason: 'تهيئة قرص — تدمير كامل للبيانات' },
  { level: 'high', re: /\bdd\b[^\n]*\bof=\/dev\/(block|sd|mmcblk)/, reason: 'كتابة مباشرة على أقسام الجهاز' },
  { level: 'high', re: /:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:/, reason: 'fork bomb — تجميد النظام' },
  { level: 'high', re: /\b(shutdown|reboot|poweroff|halt)\b/, reason: 'إعادة تشغيل/إطفاء الجهاز' },
  { level: 'high', re: /\bsu\b(\s+-c)?\s*$/, reason: 'تصعيد صلاحيات الجذر' },
  { level: 'high', re: /\bchmod\s+(-R\s+)?(777|666)\s+\/(\s|$)/, reason: 'فتح صلاحيات جذر النظام' },
  { level: 'high', re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, reason: 'تنفيذ كود من الإنترنت مباشره بدون مراجعة' },
  { level: 'high', re: /\bbase64\s+(-d|--decode)\b[^\n|]*\|\s*(ba|z)?sh\b/, reason: 'تنفيذ كود مشفّر (تخفّي)' },
  { level: 'high', re: /\bpm\s+(uninstall|clear)\b/, reason: 'حذف تطبيقات / مسح بياناتها' },
  { level: 'high', re: /\bsettings\s+put\s+(secure|global)\b/, reason: 'تعديل إعدادات النظام المحمية' },
  { level: 'high', re: />\s*\/(system|vendor|product)\b/, reason: 'الكتابة على قسم النظام' },
  { level: 'high', re: /\biptables\b|\bnft\b/, reason: 'تعديل جدار الحماية' },

  // ---- elevated: destructive or privilege-widening -----------------------
  { level: 'medium', re: /\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*\b/, reason: 'حذف recursive/force' },
  { level: 'medium', re: /\bsudo\b/, reason: 'صلاحيات مرتفعة' },
  { level: 'medium', re: /\b(pip3?|npm|pnpm|yarn)\s+(install|i)\b/, reason: 'تثبيت حزم من الشبكة (تشغيل كود خارجي)' },
  { level: 'medium', re: /\bgit\s+push\b[^\n]*--force/, reason: 'كتابة تاريخ Git بالقوة' },
  { level: 'medium', re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/, reason: 'إسقاط تعديلات غير محفوظة' },
  { level: 'medium', re: /\bcurl\b[^\n]*(\s-d\b|\s--data\b|-F\b|--upload-file)/, reason: 'إرسال بيانات للخارج' },
  { level: 'medium', re: /(~\/\.ssh|\/data\/data|\/data\/system|\/sdcard\/Android\/data)/, reason: 'وصول لبيانات حساسة' },
  { level: 'medium', re: /\btermux-[a-z-]+\b/, reason: 'تحكم بأجهزة/بيانات الهاتف عبر Termux:API' },
  { level: 'medium', re: /\b(crontab|at)\b/, reason: 'جدولة مهام دائمة' },
  { level: 'medium', re: /\bpm\s+(install|enable|disable)\b/, reason: 'تغيير حزم النظام' },
  { level: 'medium', re: /\bmv\b[^\n]*\s\/(sdcard|storage|data)\b/, reason: 'نقل ملفات خارج مساحة العمل' }
];

const SEVERITY = { low: 0, medium: 1, high: 2 };

/** Truncate a command for display in a confirmation dialog. */
export function previewCommand(code, max = 1600) {
  const text = String(code ?? '');
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} حرفاً محجوباً)` : text;
}

/**
 * @returns {{level:'low'|'medium'|'high', reasons:string[]}}
 */
export function assessCommand({ code = '' } = {}) {
  const text = String(code);
  const hits = RULES.filter((r) => r.re.test(text));
  const level = hits.reduce(
    (acc, h) => (SEVERITY[h.level] > SEVERITY[acc] ? h.level : acc),
    'low'
  );
  return { level, reasons: [...new Set(hits.map((h) => h.reason))] };
}

/**
 * Decide what the UI should do with a proposed command.
 * @returns {'block'|'ask'|'run'}
 */
export function decideExecution({ mode, level }) {
  if (mode === 'locked') return 'block';
  if (level === 'high') return mode === 'auto' ? 'ask' : 'ask';
  if (mode === 'auto') return 'run';
  return 'ask';
}

export function riskLabel(level) {
  return { low: 'منخفضة', medium: 'متوسطة', high: 'عالية' }[level] || 'غير معروفة';
}
