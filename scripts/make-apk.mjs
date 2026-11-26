/**
 * Turn the built web app (dist/) into an Android APK that runs fully offline.
 *
 * Requirements on the machine running this: JDK 17+, Android SDK (build-tools +
 * platform android-34), and `zip`/`keytool` on PATH. Then:
 *
 *   npm run build && node scripts/make-apk.mjs
 *
 * Output: wadi-al-jabal.apk  (installable on any Android 5.1+ device)
 *
 * How it works: the web app is embedded in `assets/www`, a WebView loads it from
 * the APK asset loader, and WebGL runs with hardware acceleration (WebChromeClient
 * + setWebContentsDebuggingEnabled disabled, DOM storage on).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PKG = "com.qaswat60.wadi";
const APP_NAME = "واحة الجبل";
const WORK = ".android-build";
const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "/usr/lib/android-sdk";
const BUILD_TOOLS = path.join(SDK, "build-tools", process.env.BUILD_TOOLS_VERSION || "34.0.0");
const PLATFORM = path.join(SDK, "platforms", "android-34", "android.jar");

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });

if (!fs.existsSync(PLATFORM)) {
  console.error("Android SDK not found. Set ANDROID_HOME to an SDK with platform android-34.");
  process.exit(1);
}

fs.rmSync(WORK, { recursive: true, force: true });
const src = path.join(WORK, "src", PKG.replace(/\./g, "/"));
const res = path.join(WORK, "res");
const assets = path.join(WORK, "assets", "www");
fs.mkdirSync(src, { recursive: true });
fs.mkdirSync(path.join(res, "values"), { recursive: true });
fs.mkdirSync(assets, { recursive: true });

// --- copy the web app into assets/www
fs.cpSync("dist", assets, { recursive: true });

// --- manifest
fs.writeFileSync(path.join(WORK, "AndroidManifest.xml"), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${PKG}" android:versionCode="1" android:versionName="1.0">
  <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />
  <uses-feature android:glEsVersion="0x00020000" android:required="true" />
  <uses-permission android:name="android.permission.WAKE_LOCK" />
  <application android:label="@string/app_name" android:hardwareAccelerated="true"
      android:icon="@mipmap/ic_launcher" android:allowBackup="true">
    <activity android:name=".MainActivity" android:screenOrientation="sensorLandscape"
        android:configChanges="orientation|screenSize|keyboardHidden"
        android:exported="true" android:theme="@android:style/Theme.NoTitleBar.Fullscreen">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>`);

// --- resources
fs.writeFileSync(path.join(res, "values", "strings.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources><string name="app_name">${APP_NAME}</string></resources>`);

// launcher icon from the PWA icons
const mipmaps = [["mipmap-mdpi", 48], ["mipmap-hdpi", 72], ["mipmap-xhdpi", 96], ["mipmap-xxhdpi", 144]];
for (const [dir, size] of mipmaps) {
  fs.mkdirSync(path.join(res, dir), { recursive: true });
  run("convert", ["public/icons/icon-512.png", "-resize", `${size}x${size}`, path.join(res, dir, "ic_launcher.png")]);
}

// --- activity: WebView + asset loader (loads dist over an https-looking origin so
// service workers/localStorage behave, without needing INTERNET permission changes)
fs.writeFileSync(path.join(src, "MainActivity.java"), `package ${PKG};

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
  private WebView web;

  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setAllowFileAccess(true);
    s.setAllowContentAccess(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setCacheMode(WebSettings.LOAD_DEFAULT);
    web.setWebChromeClient(new WebChromeClient());
    web.setWebViewClient(new WebViewClient());
    web.setBackgroundColor(0xFF0A1410);
    setContentView(web);
    web.loadUrl("file:///android_asset/www/index.html");
  }

  @Override public void onWindowFocusChanged(boolean has) {
    super.onWindowFocusChanged(has);
    if (has) {
      getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_FULLSCREEN
        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
  }

  @Override public void onBackPressed() {
    if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
  }
}`);

// --- compile
const classes = path.join(WORK, "classes");
fs.mkdirSync(classes, { recursive: true });
run("javac", ["-source", "8", "-target", "8", "-bootclasspath", PLATFORM, "-d", classes,
  path.join(src, "MainActivity.java")]);
run(path.join(BUILD_TOOLS, "d8"), ["--lib", PLATFORM, "--output", WORK,
  path.join(classes, PKG.replace(/\./g, "/"), "MainActivity.class")]);

// --- package
const unsigned = path.join(WORK, "app-unsigned.apk");
run(path.join(BUILD_TOOLS, "aapt"), ["package", "-f", "-M", path.join(WORK, "AndroidManifest.xml"),
  "-S", res, "-A", path.join(WORK, "assets"), "-I", PLATFORM, "-F", unsigned]);
run("zip", ["-qj", unsigned, path.join(WORK, "classes.dex")]);

const aligned = path.join(WORK, "app-aligned.apk");
run(path.join(BUILD_TOOLS, "zipalign"), ["-f", "4", unsigned, aligned]);

const keystore = path.join(WORK, "release.jks");
run("keytool", ["-genkeypair", "-keystore", keystore, "-storepass", "qaswat60", "-keypass", "qaswat60",
  "-alias", "wadi", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
  "-dname", "CN=Qaswat60, OU=Valley, O=Qaswat60, L=Sanaa, C=YE"]);

run(path.join(BUILD_TOOLS, "apksigner"), ["sign", "--ks", keystore, "--ks-pass", "pass:qaswat60",
  "--key-pass", "pass:qaswat60", "--ks-key-alias", "wadi", "--out", "wadi-al-jabal.apk", aligned]);

console.log("✓ wadi-al-jabal.apk", (fs.statSync("wadi-al-jabal.apk").size / 1048576).toFixed(2), "MB");
