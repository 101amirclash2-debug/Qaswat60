/** Derive the Android launcher icon set from public/icons/icon-512.png */
import fs from "node:fs";
import sharp from "sharp";

const sizes = [48, 72, 96, 144, 192];
fs.mkdirSync("android/icons", { recursive: true });
for (const size of sizes) {
  await sharp("public/icons/icon-512.png")
    .resize(size, size, { kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toFile(`android/icons/icon-${size}.png`);
}
console.log(`✓ android/icons  (${sizes.join(", ")} px)`);
