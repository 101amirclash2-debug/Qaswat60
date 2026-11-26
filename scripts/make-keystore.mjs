/**
 * توليد مفتاح توقيع ثابت (مرة واحدة فقط) حتى تُثبّت التحديثات فوق النسخة السابقة.
 *   node scripts/make-keystore.mjs      (يحتاج openssl)
 * ملف تجريبي عام: كلمة المرور qaswat60 — استبدله بمفتاح خاص للنشر التجاري.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'android');
fs.mkdirSync(dir, { recursive: true });
const key = path.join(dir, 'release-key.pem');
const cert = path.join(dir, 'release-cert.pem');
const p12 = path.join(dir, 'release.p12');

execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key,
  '-out', cert, '-days', '10000', '-nodes',
  '-subj', '/CN=Qaswat60 Tijara/OU=Games/O=Qaswat60/L=Sanaa/C=YE'], { stdio: 'inherit' });
execFileSync('openssl', ['pkcs12', '-export', '-in', cert, '-inkey', key,
  '-out', p12, '-name', 'tijara', '-passout', 'pass:qaswat60'], { stdio: 'inherit' });
fs.rmSync(key); fs.rmSync(cert);
console.log('✓ android/release.p12  (alias: tijara, pass: qaswat60)');
