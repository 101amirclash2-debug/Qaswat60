# قسورة | QASWARA

**الوكيل التنفيذي المستقل** — عقول سحابية متعددة + جسر محلي حقيقي على هاتفك (Samsung S23 Ultra + Termux).
قسورة ليس روبوت دردشة: يخطّط، ينفّذ، يقرأ نتيجة التنفيذ، يصلح الخطأ، ويعيد المحاولة حتى تُنجز المهمة — أو يقول لك بدقة ما الذي ينقصه.

> لا وضع محاكاة، ولا نتائج مختلقة. كل ملف، كل أمر، كل صورة، كل أغنية، كل استجابة نموذج — حقيقية ومصدرها الجسر أو مزوّد العقل.

---

## 1) التثبيت بأمر واحد (Termux)

```bash
pkg update -y && pkg install -y git python && git clone --depth 1 https://github.com/101amirclash2-debug/Qaswat60.git ~/Qaswat60 && cd ~/Qaswat60 && bash termux-setup.sh --extras
```

ثم افتح `http://127.0.0.1:8080/` على الهاتف (يفتح تلقائياً)، وانقر ⚙ وألصق مفتاح API لأحد المزوّدين:
Google Gemini (طبقة مجانية)، Groq، OpenAI، DeepSeek، أو OpenRouter (Claude / DeepSeek-R1 / Llama).

المتطلبات: Termux + Python 3.11+. لا يحتاج root.
اختياري لكنه يفتح قدرات كاملة: `termux-api`، `ffmpeg`، `tesseract`، `poppler`، `reportlab`، `pypdf`، `openpyxl`، و**Shizuku** (`rish`) لالتقاط الشاشة والأزرار.

---

## 2) الميزات الاثنتا عشرة

| # | الميزة | كيف تعمل فعلياً |
|---|--------|------------------|
| 1 | **هوية قسورة** + أسلوب ولهجة وصوت | ٥ أساليب (رسمي/تقني/إبداعي/مختصر/عامي) و٧ لهجات (فصحى، يمني-عدني، خليجي، مصري، شامي، عراقي، مغربي). نطق عبر `speechSynthesis` مع اختيار الصوت والسرعة 0.5×–2.0× والحِدّة. |
| 2 | **🧠 طريقة التفكير** | لوحة حية تُظهر: التحليل ← الأمر المختار ← النتيجة/الخطأ ← تجاوز العقبة ← التسليم، لحظة بلحظة من حلقة الوكيل. |
| 3 | **وعي ذاتي وتشخيص وتثبيت تلقائي** | `GET /device` يفحص الأدوات والمكتبات والصلاحيات؛ وعند نقص أداة يعيد الجسر خطأً فيه `install` فيثبّتها الوكيل ويعيد المحاولة تلقائياً، أو يشرح لك السبب بدقة. |
| 4 | **🔴 قسورة لايف** | كاميرا أمامية/خلفية أو مشاركة شاشة أو `rish screencap`، وإطارات JPEG حقيقية إلى نموذج بصري للتحليل والترجمة الفورية، مع نطق الرد وإمكانية المقاطعة. |
| 5 | **كلمة التنبيه والزر السريع** | `SpeechRecognition` مستمر على «يا قسورة» (قابلة للتغيير) + `tools/hotkey.sh` يفتح الواجهة من أي تطبيق عبر Shizuku عند ضغط Volume-Up. اختصار لوحة المفاتيح: Ctrl/⌘+K للميكروفون. |
| 6 | **المكالمات والرسائل** | `POST /phone`: بحث في جهات الاتصال (`termux-contact-list`) ثم مكالمة (`termux-telephony-call` / `am start -a CALL`) أو SMS (`termux-sms-send`) أو فتح واتساب برسالة جاهزة. كل إجراء خارجي يمرّ بتأكيد. |
| 7 | **مختبر الملفات + اختبرني** | رفع PDF/Word/Excel/CSV/نص/كود/صورة/صوت → استخراج نص حقيقي (OOXML، pdftotext/pypdf، Tesseract) → مناقشة وتلخيص واستخراج جداول، واختبار JSON يُصحّح محلياً بدرجة ونسبة. |
| 8 | **Auto-Genius** | تصنيف المهمة (رؤية/برمجة/استدلال/كتابة/سريع) واختيار النموذج الأنسب تلقائياً مع إمكانية التبديل اليدوي من الشريط العلوي في أي لحظة. |
| 9 | **الاستوديو الإبداعي** | صورة عالية الدقة (نموذج صور)، أغنية (تلحين WAV بلغة Python خالصة + غناء espeak + مزج `ffmpeg` إلى MP3)، فيديو MP4، ومستندات PDF/Word/Excel/CSV/MD/HTML/RTF/ZIP. |
| 10 | **استوديو التطبيقات + APK + Artemis** | معاينة حية داخل iframe معزول، تدقيق Artemis (صياغة + أسرار + ثغرات + درجة 0–100)، حزمة ZIP جاهزة دائماً، وبناء APK حقيقي عند توفر أدوات Android، وإلا تقرير صادق بما ينقص. |
| 11 | **ذاكرة موحّدة + خصوصية** | ذاكرة الجهاز + `SQLite + FTS5` على الجسر مع بحث ومزامنة، ومساحة عمل `/sdcard/Qaswara_Workspace`، ودرع «Secret Scrubber» يحجب ١٠ أنواع من الأسرار قبل أي إرسال، ومفتاح إنترنت بعزل فوري بعد تأكيد. |
| 12 | **تثبيت وCI** | `termux-setup.sh` (فحص، تثبيت الناقص، رمز، تشغيل) وGitHub Actions تنشر `Qaswara.apk` من `web/` تلقائياً. |

---

## 3) البنية

```
web/                 واجهة PWA (بلا أي مكتبات خارجية)
  index.html         شاشة قسورة: شريط علوي، لوحة تفكير، مختبرات، استوديوهات
  styles.css         OLED أسود + زمردي (S23 Ultra أولاً)
  js/app.js          التنسيق: جلسات، إعدادات، صوت، لايف، ملفات، استوديو
  js/agent.js        حلقة ReAct: JSON واحد/دورة + ١٥ أداة + إصلاح ذاتي
  js/providers.js    Gemini native + OpenAI-compatible (صور/نص)
  js/tools.js        BridgeClient مع تصنيف أخطاء (offline/auth/policy/…)
  js/live.js         كاميرا/شاشة/التقاط الجسر + تمرير الإطارات للنموذج البصري
  js/lab.js          استخراج الملفات + بناء الاختبار + التصحيح المحلي
  js/studio.js       صور/أغاني/فيديو/مستندات/تطبيقات/Artemis
  js/voice.js        TTS/STT/كلمة تنبيه + مقاطعة
  js/memory.js       استخراج أوامر التدريب + دمج ذاكرة الجسر
  js/privacy.js      Scrubber + مفتاح الإنترنت
  js/persona.js      الأساليب واللهجات
bridge/              جسر Python 3 (stdlib فقط)
  qaswara_bridge.py  HTTP + Token + CORS + Rate limit + SQLite/FTS5
  policy.py          قائمة منع الأوامر + allowlist للحزم + تحقق المدخلات
  office.py          PDF/XLSX/DOCX/CSV/MD/HTML/RTF/ZIP + استخراج
  media.py           تلحين WAV، espeak، ffmpeg (mp3/mp4/trim)
  appbuilder.py      حزمة PWA + بناء APK (javac/aapt2/d8/apksigner)
  audit.py           Artemis: صياغة + أسرار + حقن + درجة
android/             مشروع WebView لإنتاج Qaswara.apk
.github/workflows/   بناء APK + اختبارات الواجهة والجسر
tests/               96 اختبار JS + 90 اختبار Python
```

---

## 4) واجهات الجسر

| المسار | الوظيفة |
|--------|---------|
| `GET /health` | الحالة العامة (عام بلا رمز) |
| `GET /device` | الأدوات، مكتبات Python، القدرات، وما ينقصك وكيف تثبّته |
| `POST /execute` | تنفيذ bash/sh/python/node مع مهلة وحدود مخرجات |
| `POST /install` | تثبيت `pkg` / `pip` ضمن allowlist |
| `POST /files/read\|write\|list\|upload` | ملفات مساحة العمل (رفع ثنائي base64) |
| `GET /files/raw?path=…&token=…` | بث الصوت/الفيديو/الصورة/APK للمتصفح |
| `GET\|POST\|DELETE /memory`، `POST /memory/search` | ذاكرة SQLite + FTS5 |
| `POST /phone` | contacts / call / sms / whatsapp / battery / notify / clipboard |
| `POST /capture` | لقطة شاشة عبر Shizuku أو root، أو خطأ صادق بالبديل |
| `POST /extract` | نص من PDF/Office/صور (OCR) |
| `POST /office` | إنشاء pdf/xlsx/docx/csv/md/html/rtf/zip |
| `POST /media` | song / video / trim |
| `POST /app/export` | bundle (ZIP) أو apk |
| `POST /audit` | Artemis على كود أو ملف |

كل الطلبات (عدا `/health` والملفات الثابتة) تحتاج `X-Qaswara-Token` (يُقبل `X-Jarvis-Token` للتوافق). الرمز يُحقن تلقائياً في الصفحة عند فتح الواجهة من نفس الجهاز.

---

## 5) الاختبارات

```bash
npm install        # jsdom للاختبارات فقط
npm test           # 96 اختبار واجهة/منطق
npm run test:bridge # 90 اختبار جسر ومنطق تنفيذ
```

---

## 6) الأمان

راجع [docs/SECURITY.md](docs/SECURITY.md). الخلاصة: رمز على كل طلب، allowlist للحزم، منع الأوامر المدمّرة، حدود حجم ومعدل، تنظيف بيئة الأسرار، وتأكيد إلزامي لكل إجراء خارجي (مكالمة/رسالة/تثبيت) في وضع «تأكيد».

## 7) الترخيص

الاستخدام الشخصي. لا تُشغّل الجسر على `0.0.0.0` بدون رمز قوي، ولا تفتحه على شبكة غير موثوقة.
