/**
 * Bundles dist/ into ONE self-contained .html file:
 * CSS + JS inlined, and every /scene/*.jpg replaced with a data URI.
 * The result runs by double-clicking (file://) on desktop or phone.
 *
 *   npm run build && node scripts/bundle-single.mjs wadi-al-jabal.html
 */
import fs from "node:fs";
import path from "node:path";

const dist = "dist";
const outFile = process.argv[2] || "wadi-al-jabal.html";

let html = fs.readFileSync(path.join(dist, "index.html"), "utf8");

const readAsset = (href) => {
  const clean = href.replace(/^\//, "").replace(/^\.\//, "");
  return fs.readFileSync(path.join(dist, clean), "utf8");
};

// inline stylesheets
html = html.replace(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_m, href) => {
  return `<style>\n${readAsset(href)}\n</style>`;
});

// inline module scripts
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (_m, src) => {
  const code = readAsset(src);
  return `<script type="module">\n${code}\n</script>`;
});

// collect image data URIs
const sceneDir = "public/scene";
const images = {};
let bytes = 0;
for (const f of fs.readdirSync(sceneDir).filter((f) => f.endsWith(".jpg"))) {
  const buf = fs.readFileSync(path.join(sceneDir, f));
  bytes += buf.length;
  images[`/scene/${f}`] = `data:image/jpeg;base64,${buf.toString("base64")}`;
}

// swap in every reference (html, css and js are all in one string now)
for (const [url, uri] of Object.entries(images)) {
  html = html.split(url).join(uri);
}

// drop preloads/links that no longer resolve
html = html.replace(/<link[^>]+rel="(modulepreload|preload)"[^>]*>/g, "");
// the manifest/sw only work over http(s): keep a tiny inline guard instead
html = html.replace(/<link[^>]*rel="manifest"[^>]*>/g, "");
html = html.replace(/<script src="\/standalone\.js"><\/script>/g, "");

fs.writeFileSync(outFile, html);
const kb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`✓ ${outFile}  ${kb(fs.statSync(outFile).size)}  (images ${kb(bytes)})`);
