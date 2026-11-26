/** Zip dist/ (multi-file web app, needs a static server) for hosting anywhere. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
execFileSync("zip", ["-qr", "-9", "wadi-al-jabal-web.zip", "dist", "-x", "*.DS_Store"], { stdio: "inherit" });
console.log("✓ wadi-al-jabal-web.zip", (fs.statSync("wadi-al-jabal-web.zip").size / 1048576).toFixed(2), "MB");
