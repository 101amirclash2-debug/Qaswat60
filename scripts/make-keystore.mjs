/**
 * Regenerate the stable Android signing key (android/release.p12).
 * Only needed once; the file is committed so every CI build signs identically.
 *   npm run keystore        (needs openssl)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

fs.mkdirSync("android", { recursive: true });
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", "/tmp/wadi-key.pem",
  "-out", "/tmp/wadi-cert.pem", "-days", "10000", "-nodes",
  "-subj", "/CN=Qaswat60 Wadi/OU=Demo/O=Qaswat60/L=Sanaa/C=YE"], { stdio: "inherit" });
execFileSync("openssl", ["pkcs12", "-export", "-in", "/tmp/wadi-cert.pem", "-inkey", "/tmp/wadi-key.pem",
  "-out", "android/release.p12", "-name", "wadi", "-passout", "pass:qaswat60"], { stdio: "inherit" });
console.log("✓ android/release.p12 (alias wadi, store/key pass: qaswat60)");
