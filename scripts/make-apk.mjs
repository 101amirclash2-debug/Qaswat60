/**
 * تجارة — بناء APK حقيقي قابل للتثبيت بدون Gradle
 *
 *   npm run build:apk          (يحتاج JDK 17 + Android SDK build-tools + platform)
 *
 * المسار: HTML واحد مستقل → assets/www/index.html → WebView أصلية كاملة الشاشة
 * javac → d8 → aapt → zipalign → apksigner (توقيع v1+v2 بمفتاح ثابت)
 *
 * Env: ANDROID_HOME / ANDROID_SDK_ROOT، اختيارياً BUILD_TOOLS_VERSION.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PKG = 'com.qaswat.tijara';
const APP_NAME = 'تجارة';
const WORK = '.android-build';
const OUT = 'Tijara.apk';
const SINGLE = 'Tijara.html';

const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '/usr/local/lib/android/sdk';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const runQ = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' }).toString();
const fail = msg => { console.error('\n✖ ' + msg + '\n'); process.exit(1); };

if (!fs.existsSync(SDK)) fail('Android SDK غير موجود في ' + SDK + ' — اضبط ANDROID_HOME');
let buildTools;
const BT_ROOT = path.join(SDK, 'build-tools');
if (process.env.BUILD_TOOLS_VERSION && fs.existsSync(path.join(BT_ROOT, process.env.BUILD_TOOLS_VERSION))) {
  buildTools = path.join(BT_ROOT, process.env.BUILD_TOOLS_VERSION);
} else {
  const versions = fs.existsSync(BT_ROOT)
    ? fs.readdirSync(BT_ROOT).filter(d => fs.existsSync(path.join(BT_ROOT, d, 'aapt'))).sort()
    : [];
  if (!versions.length) fail('لا توجد build-tools تحتوي aapt في ' + BT_ROOT);
  buildTools = path.join(BT_ROOT, versions[versions.length - 1]);
}
const platRoot = path.join(SDK, 'platforms');
const platforms = fs.existsSync(platRoot) ? fs.readdirSync(platRoot).filter(d => /^android-\d+$/.test(d)).sort() : [];
if (!platforms.length) fail('لا توجد منصة أندرويد (android.jar) في ' + platRoot);
const platformJar = path.join(platRoot, platforms[platforms.length - 1], 'android.jar');

const tool = n => path.join(buildTools, n);
const has = p => fs.existsSync(p);
const AAPT = has(tool('aapt')) ? tool('aapt') : (has(tool('aapt2')) ? tool('aapt2') : null);
const ZIPALIGN = tool('zipalign'), D8 = tool('d8'), APKSIGNER = tool('apksigner');
if (!has(ZIPALIGN) || !has(D8) || !has(APKSIGNER) || !AAPT) fail('أدوات build-tools ناقصة في ' + buildTools);

console.log('→ SDK          ' + SDK);
console.log('→ build-tools  ' + path.basename(buildTools));
console.log('→ platform     ' + path.basename(platformJar));

/* ---------- 1. الملف المستقل ---------- */
if (!fs.existsSync(SINGLE)) fail('الملف ' + SINGLE + ' مفقود — شغّل: npm run build:single');
const singleSize = fs.statSync(SINGLE).size;
if (singleSize < 40000) fail('حجم الملف المستقل صغير جداً، يبدو أن التحزيم فشل');

/* ---------- 2. هيكل المشروع ---------- */
fs.rmSync(WORK, { recursive: true, force: true });
const src = path.join(WORK, 'src', PKG.replace(/\./g, '/'));
const res = path.join(WORK, 'res');
const assets = path.join(WORK, 'assets', 'www');
fs.mkdirSync(src, { recursive: true });
fs.mkdirSync(path.join(res, 'values'), { recursive: true });
fs.mkdirSync(assets, { recursive: true });
fs.copyFileSync(SINGLE, path.join(assets, 'index.html'));

const mipmaps = [['mipmap-mdpi', 48], ['mipmap-hdpi', 72], ['mipmap-xhdpi', 96],
                 ['mipmap-xxhdpi', 144], ['mipmap-xxxhdpi', 192]];
for (const [dir, size] of mipmaps) {
  fs.mkdirSync(path.join(res, dir), { recursive: true });
  const from = path.join('android', 'icons', 'icon-' + size + '.png');
  if (!fs.existsSync(from)) fail('أيقونة مفقودة: ' + from + ' (شغّل: python3 scripts/make_icons.py)');
  fs.copyFileSync(from, path.join(res, dir, 'ic_launcher.png'));
}

/* ---------- 3. Manifest والموارد ---------- */
fs.writeFileSync(path.join(WORK, 'AndroidManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${PKG}" android:versionCode="1" android:versionName="1.0">
  <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="33" />
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
  <uses-permission android:name="android.permission.VIBRATE" />
  <uses-permission android:name="android.permission.WAKE_LOCK" />
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
  <uses-feature android:name="android.hardware.microphone" android:required="false" />
  <application
      android:label="@string/app_name"
      android:icon="@mipmap/ic_launcher"
      android:roundIcon="@mipmap/ic_launcher"
      android:theme="@style/AppTheme"
      android:supportsRtl="true"
      android:usesCleartextTraffic="true"
      android:hardwareAccelerated="true"
      android:allowBackup="true">
    <activity
        android:name=".MainActivity"
        android:exported="true"
        android:screenOrientation="portrait"
        android:launchMode="singleTask"
        android:configChanges="orientation|screenSize|smallestScreenSize|keyboardHidden|uiMode|density">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
`);
fs.writeFileSync(path.join(res, 'values', 'strings.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources><string name="app_name">${APP_NAME}</string></resources>\n`);
fs.writeFileSync(path.join(res, 'values', 'styles.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <style name="AppTheme" parent="@android:style/Theme.Material.NoActionBar">
    <item name="android:windowBackground">@color/bg</item>
    <item name="android:statusBarColor">@color/bg</item>
    <item name="android:navigationBarColor">@color/bg</item>
    <item name="android:windowLightStatusBar">false</item>
    <item name="android:colorAccent">#e9c46a</item>
  </style>
  <color name="bg">#05130f</color>
</resources>
`);

/* ---------- 4. نشاط WebView الأصلي ---------- */
fs.writeFileSync(path.join(src, 'MainActivity.java'), `package ${PKG};

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {
  private WebView web;

  @SuppressLint("SetJavaScriptEnabled")
  @Override protected void onCreate(Bundle state) {
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
    if (Build.VERSION.SDK_INT >= 21) s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

    web.setWebViewClient(new WebViewClient());
    web.setWebChromeClient(new WebChromeClient() {
      @Override public void onPermissionRequest(final PermissionRequest request) {
        runOnUiThread(new Runnable() {
          public void run() {
            String[] res = request.getResources();
            String[] grant = new String[res.length];
            int n = 0;
            for (String r : res) {
              // نمنح المايك فقط (دردشة صوتية WebRTC) ولا نمنح الكاميرا
              if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) grant[n++] = r;
            }
            if (n > 0) {
              String[] ok = new String[n];
              System.arraycopy(grant, 0, ok, 0, n);
              request.grant(ok);
            } else request.deny();
          }
        });
      }
    });
    web.setBackgroundColor(0xFF05130F);
    web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
    web.addJavascriptInterface(new TijaraBridge(), "Tijara");
    setContentView(web);
    web.loadUrl("file:///android_asset/www/index.html");
  }

  private final class TijaraBridge {
    private static final String PREFS = "tijara_store";

    @JavascriptInterface public void vibrate(int ms) {
      try { android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE); if (v != null) v.vibrate(ms); } catch (Throwable t) {}
    }
    @JavascriptInterface public void toast(String msg) { Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show(); }
    @JavascriptInterface public String version() { return "تجارة 1.0"; }

    // حفظ أصلي موثوق: بعض أجهزة WebView تحجب localStorage على file://
    @JavascriptInterface public synchronized String load(String key) {
      try { return getSharedPreferences(PREFS, MODE_PRIVATE).getString(key, null); } catch (Throwable t) { return null; }
    }
    @JavascriptInterface public synchronized void save(String key, String value) {
      try { getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(key, value).apply(); } catch (Throwable t) {}
    }
    @JavascriptInterface public synchronized void remove(String key) {
      try { getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(key).apply(); } catch (Throwable t) {}
    }
  }

  @Override public void onBackPressed() {
    if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
  }
  @Override protected void onPause() { super.onPause(); if (web != null) web.onPause(); }
  @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
}
`);

/* ---------- 5. Java → DEX ---------- */
const classes = path.join(WORK, 'classes');
fs.mkdirSync(classes, { recursive: true });
run('javac', ['-source', '8', '-target', '8', '-bootclasspath', platformJar,
  '-d', classes, path.join(src, 'MainActivity.java')]);
const classFiles = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.class')) classFiles.push(p);
  }
})(classes);
if (!classFiles.length) fail('لم يُنتج javac أي ملف class');
run(D8, ['--lib', platformJar, '--min-api', '21', '--output', WORK, ...classFiles]);

/* ---------- 6. حزم الموارد والأصول ---------- */
const unsigned = path.join(WORK, 'app-unsigned.apk');
if (AAPT.endsWith('aapt')) {
  run(AAPT, ['package', '-f', '-M', path.join(WORK, 'AndroidManifest.xml'),
    '-S', res, '-A', path.join(WORK, 'assets'), '-I', platformJar, '-F', unsigned]);
} else {
  const compiled = path.join(WORK, 'compiled.zip');
  run(AAPT, ['compile', '--dir', res, '-o', compiled]);
  run(AAPT, ['link', '-o', unsigned, '-I', platformJar,
    '--manifest', path.join(WORK, 'AndroidManifest.xml'),
    '-A', path.join(WORK, 'assets'), compiled]);
}
run('zip', ['-qj', unsigned, path.join(WORK, 'classes.dex')]);

/* ---------- 7. محاذاة + توقيع ثابت ---------- */
const aligned = path.join(WORK, 'app-aligned.apk');
run(ZIPALIGN, ['-f', '-p', '4', unsigned, aligned]);
const p12 = path.join('android', 'release.p12');
if (!fs.existsSync(p12)) fail('مفتاح التوقيع مفقود — شغّل: npm run keystore');
const keystore = path.join(WORK, 'release.keystore');
run('keytool', ['-importkeystore', '-noprompt',
  '-srckeystore', p12, '-srcstoretype', 'PKCS12', '-srcstorepass', 'qaswat60', '-srcalias', 'tijara',
  '-destkeystore', keystore, '-deststoretype', 'PKCS12', '-deststorepass', 'qaswat60', '-destkeypass', 'qaswat60']);
fs.rmSync(OUT, { force: true });
run(APKSIGNER, ['sign', '--ks', keystore, '--ks-pass', 'pass:qaswat60',
  '--key-pass', 'pass:qaswat60', '--ks-key-alias', 'tijara',
  '--min-sdk-version', '21', '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
  '--out', OUT, aligned]);

/* ---------- 8. التحقق ---------- */
runQ(APKSIGNER, ['verify', '--verbose', OUT]);
const verify = runQ(APKSIGNER, ['verify', OUT]);
console.log('  apksigner: ' + (verify.trim() || 'verified'));
console.log('  badging  : ' + runQ(AAPT, ['dump', 'badging', OUT]).split('\n')[0]);
console.log('\n✓ ' + OUT + '  ' + (fs.statSync(OUT).size / 1048576).toFixed(2) + ' MB  (' + PKG + ')');
console.log('  التطبيق المضمّن: ' + (singleSize / 1024).toFixed(1) + ' KB · يعمل دون إنترنت');
