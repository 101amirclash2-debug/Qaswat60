import sharp from 'sharp';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#63b1e8"/><stop offset="0.62" stop-color="#cfe6f0"/><stop offset="1" stop-color="#e8f3dd"/>
    </linearGradient>
    <linearGradient id="mtn" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8b8f7d"/><stop offset="0.55" stop-color="#6d7a5f"/><stop offset="1" stop-color="#41553a"/>
    </linearGradient>
    <linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#9fd977"/><stop offset="1" stop-color="#3f7f34"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#sky)"/>
  <path d="M0 320 L96 176 L168 246 L244 120 L330 240 L392 186 L512 320 L512 512 L0 512 Z" fill="url(#mtn)"/>
  <path d="M244 120 L330 240 L286 300 L206 214 Z" fill="#a7ae96" opacity="0.5"/>
  <path d="M0 372 C120 340 210 356 300 340 C370 328 440 336 512 322 L512 512 L0 512 Z" fill="#2f5a2b"/>
  <g fill="url(#leaf)">
    <path d="M232 512 C218 430 236 360 268 306 C286 372 286 448 268 512 Z"/>
    <path d="M268 512 C258 420 286 352 330 312 C344 388 330 462 300 512 Z" opacity="0.92"/>
    <path d="M196 512 C178 436 188 372 214 330 C230 392 226 458 214 512 Z" opacity="0.85"/>
  </g>
  <g stroke="#e9f6d6" stroke-width="5" fill="none" opacity="0.55">
    <path d="M236 500 C232 430 244 372 264 330"/><path d="M272 500 C272 430 292 372 326 332"/>
  </g>
  <circle cx="382" cy="118" r="34" fill="#fff6d2" opacity="0.85"/>
  <circle cx="382" cy="118" r="62" fill="#fff2c0" opacity="0.22"/>
</svg>`;
for (const size of [192, 512, 180]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
}
console.log('icons written');
