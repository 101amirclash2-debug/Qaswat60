/**
 * QASWARA — style and dialect engine.
 *
 * The default is the "high formal professional" register. Dialects are a
 * *comprehension + reply* setting: QASWARA always understands every Arabic
 * dialect, and switches its own voice/text register to the selected one.
 */

export const STYLES = {
  formal: {
    id: 'formal',
    label: 'رسمي احترافي رفيع',
    short: 'رسمي',
    prompt:
      'اكتب بأسلوب رسمي احترافي رفيع: جمل مكتملة، مصطلحات دقيقة، بلا عامية ولا حشو. ' +
      'ابدأ بالنتيجة ثم التفاصيل، واستخدم عناوين وقوائم منظمة. خاطب المستخدم بـ«حضرتك» عند الحاجة للاحترام.'
  },
  technical: {
    id: 'technical',
    label: 'تقني دقيق',
    short: 'تقني',
    prompt:
      'اكتب بأسلوب هندسي تقني: مصطلحات دقيقة، مسارات وأوامر داخل كتل كود، أرقام وإصدارات صريحة، ' +
      'خطوات مرقّمة، واذكر الافتراضات والقيود بوضوح. تجنّب المجاز.'
  },
  creative: {
    id: 'creative',
    label: 'إبداعي حيوي',
    short: 'إبداعي',
    prompt:
      'اكتب بأسلوب إبداعي حيوي: صور بلاغية محسوبة، إيقاع جذاب، تشبيهات عملية، ' +
      'مع الحفاظ على الدقة. للقصص والأغاني: حافظ على البنية (مقدمة/حبكة/خاتمة أو مقطع/لازمة).'
  },
  concise: {
    id: 'concise',
    label: 'مختصر تنفيذي',
    short: 'مختصر',
    prompt:
      'اكتب بأقصى اختصار مفيد: نقاط قصيرة، بلا مقدمات ولا اعتذارات ولا تكرار. ' +
      'الحد الأقصى المعتاد ٥ نقاط أو ١٢٠ كلمة إلا إن طلب المستخدم تفصيلاً.'
  },
  colloquial: {
    id: 'colloquial',
    label: 'عامي ودود',
    short: 'عامي',
    prompt:
      'اكتب بعامية قريبة من لهجة المستخدم، بأسلوب ودود مباشر وواضح، بلا تكلّف، ' +
      'مع الحفاظ على دقة المعلومات والأوامر التقنية.'
  }
};

export const DIALECTS = {
  standard: { id: 'standard', label: 'الفصحى', sample: 'حاضر، بدأت التنفيذ الآن.', hint: 'بالعربية الفصحى.' },
  yemeni: { id: 'yemeni', label: 'يمني / عدني', sample: 'تمام، بديت الحين.', hint: 'باللهجة اليمنية/العدنية (مفردات مثل: تمام، الحين، عاد، شوف).' },
  gulf: { id: 'gulf', label: 'خليجي', sample: 'أبشر، بديت الحين.', hint: 'باللهجة الخليجية (مفردات مثل: أبشر، عيل، شلون، الحين).' },
  egyptian: { id: 'egyptian', label: 'مصري', sample: 'تمام يا فندم، بدأت حالًا.', hint: 'باللهجة المصرية (مفردات مثل: خالص، دلوقتي، كده، يا فندم).' },
  levantine: { id: 'levantine', label: 'شامي', sample: 'تمام، بلّشت هلق.', hint: 'باللهجة الشامية (مفردات مثل: هلق، منيح، كتير، شو).' },
  iraqi: { id: 'iraqi', label: 'عراقي', sample: 'زين، بديت هسه.', hint: 'باللهجة العراقية (مفردات مثل: زين، هسه، شلون، هواية).' },
  maghrebi: { id: 'maghrebi', label: 'مغاربي', sample: 'واخا، بديت دابا.', hint: 'باللهجة المغاربية (مفردات مثل: واخا، دابا، بزاف، مزيان).' }
};

export const STYLE_IDS = Object.keys(STYLES);
export const DIALECT_IDS = Object.keys(DIALECTS);

export function styleFor(id) {
  return STYLES[id] || STYLES.formal;
}

export function dialectFor(id) {
  return DIALECTS[id] || DIALECTS.standard;
}

/**
 * Prompt block injected into every system prompt.
 * @param {{style?:string, dialect?:string}} settings
 */
export function buildPersonaBlock({ style = 'formal', dialect = 'standard' } = {}) {
  const s = styleFor(style);
  const d = dialectFor(dialect);
  const dialectLine =
    d.id === 'standard'
      ? 'أجب بالفصحى السليمة، مع فهم كل اللهجات العربية إن كتب بها المستخدم.'
      : `أجب ${d.hint} وافهم كل اللهجات العربية الأخرى (يمنية/عدنية، خليجية، مصرية، شامية، عراقية، مغاربية) وردّ على لهجة المستخدم إن غيّرها.`;

  return `# الأسلوب واللهجة
${s.prompt}
${dialectLine}
لا تخلط بين الفصحى والعامية في الرد نفسه، ولا تشرح أنك «تستخدم لهجة» — تكلّم بها مباشرة.`;
}

/** Short human summary used in the UI chip. */
export function personaChip(settings) {
  return `${styleFor(settings.style).short} · ${dialectFor(settings.dialect).label}`;
}
