import { STATIONS } from "../data/stations.js";

const DIAGRAMS = {
  soil: `
  <svg viewBox="0 0 300 150" role="img" aria-label="مقطع عمودي في التربة">
    <defs>
      <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8d6a45"/><stop offset="1" stop-color="#4a3524"/>
      </linearGradient>
    </defs>
    <rect x="10" y="10" width="280" height="130" rx="8" fill="url(#sg)"/>
    <path d="M10 44 Q80 36 150 46 T290 40" stroke="#b98a5b" stroke-width="2" fill="none" opacity=".85"/>
    <text x="286" y="38" text-anchor="end" font-size="8" fill="#e8d3b3" font-family="Tajawal">سطح مفكّك · غني بالحصى</text>
    <path d="M10 86 Q90 78 170 88 T290 82" stroke="#6f8f4a" stroke-width="2" fill="none" stroke-dasharray="4 4" opacity=".9"/>
    <text x="286" y="80" text-anchor="end" font-size="8" fill="#cbe3a8" font-family="Tajawal">جذور المواجلة والجذامير</text>
    <path d="M28 44 Q40 110 34 136" stroke="#7fb454" stroke-width="2" fill="none"/>
    <path d="M28 44 l-8 14 M28 44 l9 12 M34 88 l-12 8 M34 88 l12 6" stroke="#7fb454" stroke-width="1.4" fill="none"/>
    <text x="64" y="122" font-size="7.5" fill="#dfeac9" font-family="Tajawal">جذور ليست عميقة لكنها كثيفة أفقياً</text>
    <g fill="#c9b08a"><circle cx="210" cy="60" r="2.6"/><circle cx="236" cy="72" r="3.4"/><circle cx="258" cy="56" r="2"/><circle cx="196" cy="94" r="2.4"/><circle cx="230" cy="104" r="2"/></g>
    <text x="286" y="118" text-anchor="end" font-size="8" fill="#e8d3b3" font-family="Tajawal">حصى صغير مدحرج</text>
    <g stroke="#3f7fc4" stroke-width="1.4" opacity=".8" fill="none">
      <path d="M150 100 l-3 8 l3 9"/><path d="M170 104 l-3 8 l3 9"/><path d="M190 100 l-3 8 l3 9"/>
    </g>
    <text x="150" y="134" font-size="8" fill="#a8cfee" font-family="Tajawal" text-anchor="middle">حركة الرطوبة النازلة</text>
  </svg>`,
  leaf: `
  <svg viewBox="0 0 300 150" role="img" aria-label="رسم تشريحي لورقة الموز">
    <path d="M150 138 L150 40" stroke="#7fb454" stroke-width="3"/>
    <path d="M150 44 C120 34 96 46 78 62 C104 60 128 56 150 46 Z" fill="#5f9c3c" opacity=".95"/>
    <path d="M150 44 C180 34 204 46 222 62 C196 60 172 56 150 46 Z" fill="#79b94c" opacity=".95"/>
    <path d="M150 70 C118 66 92 80 74 96 C104 92 130 88 150 74 Z" fill="#4f8a35" opacity=".95"/>
    <path d="M150 70 C182 66 208 80 226 96 C196 92 170 88 150 74 Z" fill="#8ac75a" opacity=".95"/>
    <path d="M150 96 C126 94 106 106 92 120 C116 116 136 112 150 100 Z" fill="#467a30" opacity=".95"/>
    <path d="M150 96 C174 94 194 106 208 120 C184 116 164 112 150 100 Z" fill="#6fae49" opacity=".95"/>
    <g stroke="#d8ecc0" stroke-width=".8" opacity=".85" fill="none">
      <path d="M150 60 C126 62 104 72 92 82"/><path d="M150 60 C174 62 196 72 208 82"/>
      <path d="M150 80 C128 84 112 96 102 108"/><path d="M150 80 C172 84 188 96 198 108"/>
    </g>
    <text x="150" y="16" text-anchor="middle" font-size="8" fill="#dff0d0" font-family="Tajawal">العرق الوسطي · نصل واحد</text>
    <g font-size="7.5" fill="#cfe6bc" font-family="Tajawal">
      <text x="18" y="60">سطح لامع شمعي</text>
      <line x1="16" y1="64" x2="72" y2="58" stroke="#cfe6bc" stroke-width=".6"/>
      <text x="282" y="128" text-anchor="end">أوردة متوازية</text>
      <line x1="278" y1="124" x2="200" y2="106" stroke="#cfe6bc" stroke-width=".6"/>
      <text x="18" y="132">حافة اصفرّت مع العمر</text>
      <line x1="16" y1="128" x2="86" y2="118" stroke="#cfe6bc" stroke-width=".6"/>
    </g>
    <circle cx="150" cy="40" r="3.4" fill="#c9e6a4"/>
    <text x="160" y="36" font-size="7" fill="#c9e6a4" font-family="Tajawal">قاعدة الورقة</text>
  </svg>`,
  root: `
  <svg viewBox="0 0 300 150" role="img" aria-label="مقطع في الغطاء العشبي">
    <path d="M0 44 Q70 36 150 44 T300 40 L300 150 L0 150 Z" fill="#4a3524"/>
    <path d="M0 44 Q70 36 150 44 T300 40 L300 60 Q200 54 100 62 T0 58 Z" fill="#5d8760" opacity=".55"/>
    <g stroke="#8ac75a" stroke-width="2.4" fill="none" stroke-linecap="round">
      <path d="M40 46 C34 24 44 14 40 2"/><path d="M52 46 C58 22 50 12 58 4"/>
      <path d="M70 46 C64 26 72 16 68 8"/><path d="M96 46 C102 26 94 14 102 6"/>
      <path d="M118 46 C112 24 120 16 116 6"/><path d="M148 46 C154 24 146 12 154 4"/>
      <path d="M176 46 C170 24 178 16 174 8"/><path d="M204 46 C210 26 202 14 208 6"/>
      <path d="M230 46 C224 24 232 16 228 6"/><path d="M258 46 C264 26 256 14 262 8"/>
    </g>
    <g stroke="#c9a94e" stroke-width="2" fill="none" stroke-linecap="round">
      <path d="M84 46 C80 22 90 12 86 0"/><path d="M140 46 C146 22 138 12 144 2"/>
      <path d="M192 46 C186 22 196 14 190 4"/><path d="M246 46 C252 22 244 12 250 2"/>
    </g>
    <g fill="#d9c07a"><ellipse cx="86" cy="6" rx="4" ry="8"/><ellipse cx="144" cy="7" rx="4" ry="9"/><ellipse cx="190" cy="8" rx="3.6" ry="7"/><ellipse cx="250" cy="7" rx="4" ry="8"/></g>
    <g stroke="#a9d07f" stroke-width="1.2" fill="none" opacity=".9">
      <path d="M96 60 C92 82 108 92 96 108"/><path d="M96 108 l-10 6 M96 108 l12 8 M96 84 l-14 4 M96 84 l14 2"/>
      <path d="M204 60 C210 82 194 92 206 108"/><path d="M206 108 l-12 6 M206 108 l10 8 M206 84 l-14 2 M206 84 l14 4"/>
    </g>
    <text x="150" y="142" text-anchor="middle" font-size="8" fill="#d8c9a8" font-family="Tajawal">شبكة جذور ليفية تثبّت الطبقة السطحية</text>
    <text x="150" y="126" text-anchor="middle" font-size="7.5" fill="#b9d99a" font-family="Tajawal">أعشاب: 0.4–1.2 م · سيقان صلبة تمرّر الهواء</text>
  </svg>`,
  layers: `
  <svg viewBox="0 0 300 150" role="img" aria-label="طبقات الغطاء النباتي">
    <rect x="0" y="0" width="300" height="150" fill="none"/>
    <line x1="14" y1="126" x2="286" y2="126" stroke="#8d6a45" stroke-width="2"/>
    <g fill="#2b5726" opacity=".92">
      <circle cx="60" cy="40" r="20"/><circle cx="84" cy="48" r="16"/><circle cx="200" cy="36" r="22"/><circle cx="228" cy="46" r="17"/>
    </g>
    <g stroke="#5a4a36" stroke-width="3">
      <path d="M60 126 L60 44"/><path d="M200 126 L200 40"/>
    </g>
    <g fill="#6aae45" opacity=".95">
      <path d="M110 118 C104 96 112 84 110 74 C120 82 124 96 120 118 Z"/>
      <path d="M146 118 C140 94 150 82 146 70 C158 80 162 98 158 118 Z"/>
      <path d="M170 118 C166 100 174 88 170 80 C180 88 182 102 180 118 Z"/>
    </g>
    <g stroke="#9ad06d" stroke-width="1.6" fill="none">
      <path d="M20 126 C26 116 22 110 28 104"/><path d="M36 126 C42 118 38 112 44 108"/>
      <path d="M246 126 C252 118 248 110 254 104"/><path d="M266 126 C272 118 268 112 274 108"/>
    </g>
    <g font-size="7.5" fill="#dff0d0" font-family="Tajawal">
      <text x="14" y="22">مظلة الأشجار · 8–14 م</text>
      <text x="286" y="66" text-anchor="end">حقل الموز · 2–4 م</text>
      <text x="286" y="112" text-anchor="end">غطاء عشبي · أقل من 1 م</text>
    </g>
    <g stroke="#cfe6bc" stroke-width=".6" stroke-dasharray="3 3">
      <line x1="14" y1="30" x2="286" y2="30"/><line x1="14" y1="74" x2="286" y2="74"/>
    </g>
  </svg>`,
  peaks: `
  <svg viewBox="0 0 300 150" role="img" aria-label="خطوط الارتفاع والحاجز المناخي">
    <defs>
      <linearGradient id="pk" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8a8b80"/><stop offset="1" stop-color="#3e5340"/>
      </linearGradient>
    </defs>
    <path d="M8 134 L70 44 L104 84 L140 22 L178 78 L214 40 L270 134 Z" fill="url(#pk)"/>
    <path d="M140 22 L178 78 L150 134 L104 84 Z" fill="#6f7a63" opacity=".35"/>
    <g stroke="#cfe0c0" stroke-width=".7" opacity=".55" fill="none">
      <path d="M104 84 Q120 104 118 134"/><path d="M150 46 Q140 90 132 134"/><path d="M170 66 Q176 102 168 134"/>
    </g>
    <g fill="none" stroke="#e8d9a8" stroke-width="1.1">
      <path d="M30 106 Q120 96 196 88"/>
      <path d="M24 118 Q118 108 200 100"/>
      <path d="M52 92 Q126 84 190 76"/>
    </g>
    <text x="150" y="16" text-anchor="middle" font-size="8" fill="#e7f2dc" font-family="Tajawal">قمم 250–600 م فوق أرضية الوادي</text>
    <path d="M20 60 C70 48 100 52 132 40" stroke="#a8cfee" stroke-width="1.6" fill="none" stroke-dasharray="5 4"/>
    <g fill="#bfe0fa" opacity=".9"><circle cx="96" cy="46" r="1.6"/><circle cx="112" cy="50" r="1.4"/><circle cx="126" cy="43" r="1.5"/></g>
    <text x="18" y="76" font-size="7" fill="#bfe0fa" font-family="Tajawal">هواء رطب صاعد</text>
    <g stroke="#9ed0f0" stroke-width="1" opacity=".8">
      <path d="M108 78 l-3 8"/><path d="M120 84 l-3 8"/><path d="M96 86 l-3 7"/>
    </g>
    <text x="286" y="144" text-anchor="end" font-size="7" fill="#cfe0c0" font-family="Tajawal">منحدرات تتجاوز 45°</text>
    <path d="M8 134 L286 134" stroke="#2d3f31" stroke-width="1"/>
    <text x="14" y="144" font-size="7" fill="#e8d9a8" font-family="Tajawal">أرضية الواحة</text>
  </svg>`,
};

export class InfoPanel {
  constructor({ onNext, onClose }) {
    this.root = document.getElementById("panel");
    this.img = document.getElementById("panel-img");
    this.tag = document.getElementById("panel-tag");
    this.eyebrow = document.getElementById("panel-eyebrow");
    this.title = document.getElementById("panel-title");
    this.desc = document.getElementById("panel-desc");
    this.points = document.getElementById("panel-points");
    this.meta = document.getElementById("panel-meta");
    this.diagram = document.getElementById("panel-diagram");
    this.count = document.getElementById("panel-count");
    this.nextBtn = document.getElementById("panel-next");
    this.current = 0;
    this.onNext = onNext;
    this.onClose = onClose;

    document.getElementById("panel-close").addEventListener("click", () => {
      this.hide();
      this.onClose?.();
    });
    this.nextBtn.addEventListener("click", () => {
      this.onNext?.();
    });
  }

  get isOpen() {
    return !this.root.classList.contains("hidden");
  }

  show(index) {
    const s = STATIONS[index];
    if (!s) return;
    this.current = index;
    this.img.src = s.img;
    this.img.alt = s.name;
    this.tag.textContent = s.tag;
    this.eyebrow.textContent = s.eyebrow;
    this.title.textContent = s.name;
    this.desc.textContent = s.desc;
    this.points.innerHTML = s.points.map((p) => `<li>${p}</li>`).join("");
    this.meta.innerHTML = s.meta
      .map(([k, v]) => `<div class="meta-cell"><span>${k}</span><b>${v}</b></div>`)
      .join("");
    this.diagram.innerHTML = `<div class="diagram">${DIAGRAMS[s.diagram] || ""}</div>`;
    this.count.textContent = `${index + 1} / ${STATIONS.length}`;
    this.nextBtn.textContent = index === STATIONS.length - 1 ? "العودة إلى البداية ↺" : "المحطة التالية ←";
    this.root.classList.remove("hidden");
    this.root.querySelector(".panel-scroll").scrollTop = 0;
  }

  hide() {
    this.root.classList.add("hidden");
  }
}
