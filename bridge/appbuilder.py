"""
QASWARA — app export (bundle always, APK when the toolchain exists).

A phone cannot download the Android SDK reliably, so QASWARA is honest about
it:
  • `bundle`  → a self-contained ZIP/PWA that always works (offline HTML).
  • `apk`     → a real WebView APK, built only if javac + aapt2 + d8 +
                apksigner + android.jar are all present on the device; the
                missing pieces are reported one by one with install hints.
  • CI        → `.github/workflows/android.yml` builds a signed debug APK on
                every push, so the APK path is verifiable off-device.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from typing import Dict, List, Optional

PACKAGE = "com.qaswara.agent"
APP_LABEL = "Qaswara"
MIN_SDK = 24
TARGET_SDK = 35


def _which(*names: str) -> Optional[str]:
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    return None


def find_android_jar() -> Optional[str]:
    for base in (
        os.environ.get("ANDROID_HOME"),
        os.environ.get("ANDROID_SDK_ROOT"),
        "/data/data/com.termux/files/usr/opt/android-sdk",
        os.path.expanduser("~/Android/Sdk"),
    ):
        if not base:
            continue
        platforms = os.path.join(base, "platforms")
        if os.path.isdir(platforms):
            for version in sorted(os.listdir(platforms), reverse=True):
                jar = os.path.join(platforms, version, "android.jar")
                if os.path.isfile(jar):
                    return jar
    return None


def toolchain() -> Dict[str, Optional[str]]:
    return {
        "java": _which("java"),
        "javac": _which("javac"),
        "aapt2": _which("aapt2", "aapt"),
        "d8": _which("d8", "dx"),
        "apksigner": _which("apksigner"),
        "zipalign": _which("zipalign"),
        "keytool": _which("keytool"),
        "androidJar": find_android_jar(),
    }


def missing_tools() -> List[str]:
    return [name for name, path in toolchain().items() if not path]


def write_bundle(out_dir: str, name: str, files: Dict[str, str]) -> Dict[str, object]:
    """Self-contained web app ZIP (index.html + assets + README)."""
    os.makedirs(out_dir, exist_ok=True)
    safe = "".join(ch for ch in (name or "qaswara_app") if ch.isalnum() or ch in "_-")[:48] or "qaswara_app"
    path = os.path.join(out_dir, f"{safe}.zip")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename, content in files.items():
            clean = str(filename).replace("..", "_").lstrip("/")
            zf.writestr(clean, str(content))
        zf.writestr(
            "README.txt",
            "QASWARA app bundle\n"
            "------------------\n"
            "1) افتح index.html في المتصفح (يعمل بلا إنترنت).\n"
            "2) من Chrome: إضافة إلى الشاشة الرئيسية لتثبيته كتطبيق.\n"
            "3) لتغليفه كـ APK: ادفع المشروع إلى GitHub — سير العمل android.yml يبني Qaswara.apk.\n",
        )
    return {"ok": True, "kind": "bundle", "path": path, "bytes": os.path.getsize(path), "files": len(files) + 1}


MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="{package}" android:versionCode="1" android:versionName="2.0.0">
  <uses-permission android:name="android.permission.INTERNET"/>
  <uses-permission android:name="android.permission.CAMERA"/>
  <uses-permission android:name="android.permission.RECORD_AUDIO"/>
  <application android:label="{label}" android:theme="@android:style/Theme.NoTitleBar"
      android:usesCleartextTraffic="true" android:allowBackup="true">
    <activity android:name=".MainActivity" android:exported="true"
        android:configChanges="orientation|keyboardHidden|screenSize">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>
"""

MAIN_ACTIVITY = """package {package};

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.PermissionRequest;

public class MainActivity extends Activity {{
  private WebView web;

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle state) {{
    super.onCreate(state);
    web = new WebView(this);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setAllowFileAccess(true);
    settings.setAllowContentAccess(true);
    web.setWebViewClient(new WebViewClient());
    web.setWebChromeClient(new WebChromeClient() {{
      @Override
      public void onPermissionRequest(final PermissionRequest request) {{
        request.grant(request.getResources());
      }}
    }});
    web.loadUrl("file:///android_asset/www/index.html");
    setContentView(web);
  }}

  @Override
  public void onBackPressed() {{
    if (web != null && web.canGoBack()) web.goBack();
    else super.onBackPressed();
  }}
}}
"""


def build_webview_apk(out_dir: str, web_files: Dict[str, str]) -> Dict[str, object]:
    """
    Build a minimal WebView APK. Never lies: if anything is missing it returns
    ok=False with the exact missing pieces and still writes a usable bundle.
    """
    os.makedirs(out_dir, exist_ok=True)
    bundle = write_bundle(out_dir, "Qaswara", web_files)
    tools = toolchain()
    missing = [name for name, path in tools.items() if not path]
    if missing:
        return {
            "ok": False,
            "kind": "apk",
            "code": "missing_toolchain",
            "missing": missing,
            "bundle": bundle["path"],
            "message": (
                "بناء APK على الهاتف يحتاج أدوات Android SDK غير المثبّتة: "
                + ", ".join(missing)
                + ". حُفظ بدلاً منها حزمة PWA كاملة تعمل فوراً، "
                "وسير عمل GitHub (android.yml) يبني Qaswara.apk تلقائياً."
            ),
        }

    work = tempfile.mkdtemp(prefix="qaswara_apk_")
    try:
        src = os.path.join(work, "src", *PACKAGE.split("."))
        os.makedirs(src, exist_ok=True)
        with open(os.path.join(src, "MainActivity.java"), "w", encoding="utf-8") as handle:
            handle.write(MAIN_ACTIVITY.format(package=PACKAGE))

        manifest = os.path.join(work, "AndroidManifest.xml")
        with open(manifest, "w", encoding="utf-8") as handle:
            handle.write(MANIFEST.format(package=PACKAGE, label=APP_LABEL))

        assets_www = os.path.join(work, "assets", "www")
        os.makedirs(assets_www, exist_ok=True)
        for filename, content in web_files.items():
            target = os.path.join(assets_www, str(filename).replace("..", "_").lstrip("/"))
            os.makedirs(os.path.dirname(target) or assets_www, exist_ok=True)
            with open(target, "w", encoding="utf-8") as handle:
                handle.write(str(content))

        classes = os.path.join(work, "classes")
        os.makedirs(classes, exist_ok=True)
        subprocess.run(
            [tools["javac"], "-source", "17", "-target", "17", "-classpath", tools["androidJar"],
             "-d", classes, os.path.join(src, "MainActivity.java")],
            check=True, capture_output=True, text=True, timeout=300,
        )

        dex_dir = os.path.join(work, "dex")
        os.makedirs(dex_dir, exist_ok=True)
        subprocess.run(
            [tools["d8"], "--lib", tools["androidJar"], "--output", dex_dir,
             os.path.join(classes, PACKAGE.replace(".", "/"), "MainActivity.class")],
            check=True, capture_output=True, text=True, timeout=300,
        )

        unaligned = os.path.join(work, "app-unaligned.apk")
        use_aapt2 = os.path.basename(tools["aapt2"]).startswith("aapt2")
        if use_aapt2:
            flat = os.path.join(work, "res.zip")
            subprocess.run([tools["aapt2"], "link", "-o", unaligned, "-I", tools["androidJar"],
                            "--manifest", manifest, "-A", os.path.join(work, "assets"),
                            "--min-sdk-version", str(MIN_SDK), "--target-sdk-version", str(TARGET_SDK),
                            "--version-code", "1", "--version-name", "2.0.0"],
                           check=True, capture_output=True, text=True, timeout=300)
        else:
            subprocess.run([tools["aapt2"], "package", "-f", "-M", manifest,
                            "-I", tools["androidJar"], "-A", os.path.join(work, "assets"),
                            "-F", unaligned],
                           check=True, capture_output=True, text=True, timeout=300)

        with zipfile.ZipFile(unaligned, "a") as zf:
            zf.write(os.path.join(dex_dir, "classes.dex"), "classes.dex")

        aligned = os.path.join(work, "app-aligned.apk")
        if tools.get("zipalign"):
            subprocess.run([tools["zipalign"], "-f", "4", unaligned, aligned],
                           check=True, capture_output=True, text=True, timeout=180)
        else:
            aligned = unaligned

        keystore = os.path.join(work, "debug.keystore")
        if tools.get("keytool"):
            subprocess.run(
                [tools["keytool"], "-genkeypair", "-v", "-keystore", keystore, "-storepass", "qaswara",
                 "-keypass", "qaswara", "-alias", "qaswara", "-keyalg", "RSA", "-keysize", "2048",
                 "-validity", "10000", "-dname", "CN=Qaswara, OU=Agent, O=Qaswara, L=Sanaa, C=YE"],
                check=True, capture_output=True, text=True, timeout=180,
            )
            signed = os.path.join(out_dir, "Qaswara.apk")
            subprocess.run(
                [tools["apksigner"], "sign", "--ks", keystore, "--ks-pass", "pass:qaswara",
                 "--key-pass", "pass:qaswara", "--out", signed, aligned],
                check=True, capture_output=True, text=True, timeout=300,
            )
        else:
            signed = os.path.join(out_dir, "Qaswara-unsigned.apk")
            shutil.copyfile(aligned, signed)

        return {
            "ok": True,
            "kind": "apk",
            "path": signed,
            "bytes": os.path.getsize(signed),
            "signed": bool(tools.get("keytool")),
            "bundle": bundle["path"],
            "note": "APK تجريبي (debug) — ثبّته من /sdcard/Download أو عبر مدير الملفات.",
        }
    except subprocess.CalledProcessError as err:
        return {
            "ok": False,
            "kind": "apk",
            "code": "build_failed",
            "bundle": bundle["path"],
            "message": f"فشل البناء: {(err.stderr or err.stdout or '')[-800:]}",
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)
