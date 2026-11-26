/**
 * تجارة — حزم التطبيق في ملف HTML واحد مستقل (يلزمه WebView على file://)
 *
 *   node scripts/bundle-single.mjs
 *
 * لا تُستخدم ES modules داخل التطبيق (سكربتات كلاسيكية) لأن WebView يحجب
 * تحميل الوحدات عبر file://. الناتج بلا أي طلبات شبكية: CSS/JS/الأيقونة
 * كلها مُضمّنة، فيعمل دون إنترنت تماماً.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WEB = path.join(ROOT, 'web');
const OUT = process.argv[2] || path.join(ROOT, 'Tijara.html');

let html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const readWeb = rel => fs.readFileSync(path.join(WEB, rel.replace(/^\.\//, '')), 'utf8');

// 1) CSS → <style>
html = html.replace(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
  (_m, href) => '<style>\n' + readWeb(href) + '\n</style>');

// 2) JS → <script> (مع الحفاظ على ترتيب التحميل)
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g,
  (_m, src) => '<script>\n' + readWeb(src) + '\n</script>');

// 3) الأيقونة → data URI
const iconPath = path.join(WEB, 'icons', 'icon-192.png');
if (fs.existsSync(iconPath)) {
  const uri = 'data:image/png;base64,' + fs.readFileSync(iconPath).toString('base64');
  html = html.replace(/<link[^>]+rel="icon"[^>]*>/g, '<link rel="icon" href="' + uri + '">');
} else {
  html = html.replace(/<link[^>]+rel="icon"[^>]*>/g, '');
}

// 4) وسم المزامنة / أي روابط خارجية
html = html.replace(/<link[^>]+rel="(manifest|preload|modulepreload)"[^>]*>/g, '');
html = html.replace('</head>', '  <meta name="tijara-build" content="single-file offline build">\n</head>');

// تحقّق من عدم وجود وسم إغلاق داخل كود JS (كان سيكسر التحزيم)
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 7) throw new Error('عدد السكربتات المتوقّع 7، وُجد ' + scripts.length);

fs.writeFileSync(OUT, html);
console.log('✓ ' + path.relative(ROOT, OUT) + '  ' + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB  (offline, ' + scripts.length + ' scripts inlined)');
