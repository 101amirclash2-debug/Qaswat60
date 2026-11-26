/**
 * Publish the built app into ./docs for GitHub Pages: keeps every asset path
 * relative so the site works at a subpath (https://user.github.io/repo/).
 */
import fs from "node:fs";
import path from "node:path";

fs.rmSync("docs", { recursive: true, force: true });
fs.cpSync("dist", "docs", { recursive: true });

const fix = (file, pairs) => {
  let s = fs.readFileSync(file, "utf8");
  for (const [a, b] of pairs) s = s.split(a).join(b);
  fs.writeFileSync(file, s);
};

fix("docs/index.html", [
  ['href="/manifest.webmanifest"', 'href="./manifest.webmanifest"'],
  ['href="/icons/', 'href="./icons/'],
  ['src="/standalone.js"', 'src="./standalone.js"'],
  ["/assets/", "./assets/"],
]);
fix("docs/manifest.webmanifest", [['"/icons/', '"icons/']]);
fs.writeFileSync("docs/.nojekyll", "");

console.log("✓ docs/ ready for GitHub Pages");
