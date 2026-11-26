/** QR code pointing at the rolling APK release, embedded in the site + README. */
import fs from "node:fs";
import QRCode from "qrcode";

const URL = process.env.APK_URL || "https://github.com/101amirclash2-debug/Qaswat60/releases/tag/apk-latest";
fs.mkdirSync("docs", { recursive: true });
await QRCode.toFile("docs/apk-qr.png", URL, {
  width: 512,
  margin: 2,
  errorCorrectionLevel: "M",
  color: { dark: "#0b1a12ff", light: "#eaf6e3ff" },
});
await QRCode.toFile("public/apk-qr.png", URL, {
  width: 512,
  margin: 2,
  errorCorrectionLevel: "M",
  color: { dark: "#0b1a12ff", light: "#eaf6e3ff" },
});
console.log("✓ docs/apk-qr.png + public/apk-qr.png ->", URL);
