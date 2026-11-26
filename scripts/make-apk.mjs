/**
 * Build a real, installable, offline Android APK from the web app.
 *
 *   npm run build:apk        (needs JDK 17+ and Android SDK build-tools + platform)
 *
 * Why no Gradle: this uses the SDK command line tools directly
 * (javac -> d8 -> aapt -> zipalign -> apksigner), which keeps the build
 * ~20 s and dependency-free.
 *
 * The web app is embedded as ONE self-contained HTML file inside
 * assets/www/index.html, because Android WebView blocks ES-module scripts
 * loaded over file:// (they need CORS). An inlined single-file build has no
 * external requests at all, so it runs fully offline.
 *
 * Env: ANDROID_HOME / ANDROID_SDK_ROOT, optionally BUILD_TOOLS_VERSION.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PKG = "com.qaswat60.wadi";
const APP_NAME = "واحة الجبل";
const WORK = ".android-build";
const OUT = "wadi-al-jabal.apk";

const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "/usr/local/lib/android/sdk";
const BT_ROOT = path.join(SDK, "build-tools");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const runQ = (cmd, args) => execFileSync(cmd, args, { stdio: "pipe" }).toString();

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(SDK)) fail(`Android SDK not found at ${SDK}. Set ANDROID_HOME.`);

// --- pick build-tools (highest available, or BUILD_TOOLS_VERSION)
let buildTools;
if (process.env.BUILD_TOOLS_VERSION && fs.existsSync(path.join(BT_ROOT, process.env.BUILD_TOOLS_VERSION))) {
  buildTools = path.join(BT_ROOT, process.env.BUILD_TOOLS_VERSION);
} else {
  const versions = fs.existsSync(BT_ROOT)
    ? fs.readdirSync(BT_ROOT).filter((d) => fs.existsSync(path.join(BT_ROOT, d, "aapt"))).sort()
    : [];
  if (!versions.length) fail(`No build-tools with 'aapt' in ${BT_ROOT}`);
  buildTools = path.join(BT_ROOT, versions[versions.length - 1]);
}

// --- pick newest platform
const platRoot = path.join(SDK, "platforms");
const platforms = fs.existsSync(platRoot) ? fs.readdirSync(platRoot).sort() : [];
if (!platforms.length) fail(`No Android platform (android.jar) in ${platRoot}`);
const platformJar = path.join(platRoot, platforms[platforms.length - 1], "android.jar");

const tool = (name) => path.join(buildTools, name);
const has = (p) => fs.existsSync(p);
const ZIPALIGN = has(tool("zipalign")) ? tool("zipalign") : null;
const AAPT = has(tool("aapt")) ? tool("aapt") : null;
const AAPT2 = has(tool("aapt2")) ? tool("aapt2") : null;
const D8 = has(tool("d8")) ? tool("d8") : null;
const APKSIGNER = has(tool("apksigner")) ? tool("apksigner") : null;
if (!ZIPALIGN || !D8 || !APKSIGNER) fail(`build-tools incomplete in ${buildTools}`);

console.log(`→ SDK       ${SDK}`);
console.log(`→ build-tools ${path.basename(buildTools)}`);
console.log(`→ platform  ${path.basename(platformJar)}`);

// --- 1. single-file web build (must exist: npm run build:single)
const single = "wadi-al-jabal.html";
if (!fs.existsSync(single)) fail("wadi-al-jabal.html missing — run: npm run build:single");
const singleSize = fs.statSync(single).size;
if (singleSize < 1_000_000) fail("single-file build looks too small");

// --- 2. scaffold the Android project
fs.rmSync(WORK, { recursive: true, force: true });
const src = path.join(WORK, "src", PKG.replace(/\./g, "/"));
const res = path.join(WORK, "res");
const assets = path.join(WORK, "assets", "www");
fs.mkdirSync(src, { recursive: true });
fs.mkdirSync(path.join(res, "values"), { recursive: true });
fs.mkdirSync(assets, { recursive: true });

fs.copyFileSync(single, path.join(assets, "index.html"));

// launcher icons (pre-generated PNGs live in android/icons, optional override)
const iconSrc = "android/icons";
const mipmaps = [
  ["mipmap-mdpi", 48],
  ["mipmap-hdpi", 72],
  ["mipmap-xhdpi", 96],
  ["mipmap-xxhdpi", 144],
  ["mipmap-xxxhdpi", 192],
];
for (const [dir, size] of mipmaps) {
  fs.mkdirSync(path.join(res, dir), { recursive: true });
  const from = path.join(iconSrc, `icon-${size}.png`);
  if (!fs.existsSync(from)) fail(`missing launcher icon ${from} (run: npm run icons)`);
  fs.copyFileSync(from, path.join(res, dir, "ic_launcher.png"));
}

// --- 3. manifest
fs.writeFileSync(
  path.join(WORK, "AndroidManifest.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${PKG}"
    android:versionCode="1"
    android:versionName="1.0">

  <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="33" />
  <uses-feature android:glEsVersion="0x00020000" android:required="true" />
  <uses-permission android:name="android.permission.WAKE_LOCK" />

  <application
      android:label="@string/app_name"
      android:hardwareAccelerated="true"
      android:icon="@mipmap/ic_launcher"
      android:roundIcon="@mipmap/ic_launcher"
      android:allowBackup="true"
      android:supportsRtl="true">
    <activity
        android:name=".MainActivity"
        android:screenOrientation="sensorLandscape"
        android:configChanges="orientation|screenSize|keyboardHidden|uiMode"
        android:launchMode="singleTask"
        android:exported="true"
        android:theme="@android:style/Theme.NoTitleBar.Fullscreen">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
`
);

fs.writeFileSync(
  path.join(res, "values", "strings.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources><string name="app_name">${APP_NAME}</string></resources>
`
);

// --- 4. activity: full-screen immersive WebView on the embedded build
fs.writeFileSync(
  path.join(src, "MainActivity.java"),
  `package ${PKG};

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
  private WebView web;

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setAllowFileAccess(true);
    s.setAllowFileAccessFromFileURLs(true);
    s.setAllowUniversalAccessFromFileURLs(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setLoadWithOverviewMode(true);
    s.setUseWideViewPort(true);
    s.setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);

    web.setWebChromeClient(new WebChromeClient());
    web.setWebViewClient(new WebViewClient());
    web.setBackgroundColor(0xFF0A1410);
    web.setLayerType(View.LAYER_TYPE_HARDWARE, null);

    setContentView(web);
    goImmersive();
    web.loadUrl("file:///android_asset/www/index.html");
  }

  private void goImmersive() {
    View decor = getWindow().getDecorView();
    int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_FULLSCREEN;
    if (Build.VERSION.SDK_INT >= 19) flags |= View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
    decor.setSystemUiVisibility(flags);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) goImmersive();
  }

  @Override
  protected void onPause() {
    super.onPause();
    if (web != null) web.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (web != null) web.onResume();
  }

  @Override
  public void onBackPressed() {
    if (web != null && web.canGoBack()) web.goBack();
    else super.onBackPressed();
  }
}
`
);

// --- 5. compile java -> dex
const classes = path.join(WORK, "classes");
fs.mkdirSync(classes, { recursive: true });
run("javac", [
  "-source", "8", "-target", "8",
  "-bootclasspath", platformJar,
  "-d", classes,
  path.join(src, "MainActivity.java"),
]);
run(D8, ["--lib", platformJar, "--min-api", "21", "--output", WORK,
  path.join(classes, PKG.replace(/\./g, "/"), "MainActivity.class")]);

// --- 6. resources + package
const unsigned = path.join(WORK, "app-unsigned.apk");
if (AAPT) {
  run(AAPT, ["package", "-f", "-M", path.join(WORK, "AndroidManifest.xml"),
    "-S", res, "-A", path.join(WORK, "assets"), "-I", platformJar, "-F", unsigned]);
} else if (AAPT2) {
  // fallback path: aapt2 link
  const compiled = path.join(WORK, "compiled.zip");
  run(AAPT2, ["compile", "--dir", res, "-o", compiled]);
  run(AAPT2, ["link", "-o", unsigned, "-I", platformJar, "--manifest",
    path.join(WORK, "AndroidManifest.xml"), "-A", path.join(WORK, "assets"), compiled]);
} else {
  fail("neither aapt nor aapt2 found");
}

run("zip", ["-qj", unsigned, path.join(WORK, "classes.dex")]);

// --- 7. align + sign
const aligned = path.join(WORK, "app-aligned.apk");
run(ZIPALIGN, ["-f", "-p", "4", unsigned, aligned]);

const keystore = path.join(WORK, "release.jks");
run("keytool", ["-genkeypair", "-keystore", keystore,
  "-storepass", "qaswat60", "-keypass", "qaswat60", "-alias", "wadi",
  "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-noprompt",
  "-dname", "CN=Qaswat60, OU=Wadi, O=Qaswat60, L=Sanaa, C=YE"]);

fs.rmSync(OUT, { force: true });
run(APKSIGNER, ["sign", "--ks", keystore, "--ks-pass", "pass:qaswat60",
  "--key-pass", "pass:qaswat60", "--ks-key-alias", "wadi",
  "--out", OUT, aligned]);

// --- 8. verify
runQ(APKSIGNER, ["verify", "--print-certs", OUT]);
const size = fs.statSync(OUT).size;
console.log(`\n✓ ${OUT}  ${(size / 1048576).toFixed(2)} MB  (${PKG})`);
console.log(`  embedded app: ${(singleSize / 1048576).toFixed(2)} MB single-file build`);
