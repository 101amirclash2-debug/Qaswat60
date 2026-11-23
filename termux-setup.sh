#!/data/data/com.termux/files/usr/bin/bash
# ---------------------------------------------------------------------------
# قسورة | QASWARA — إعداد وتشغيل لمرة واحدة على Termux (Android)
#
#   bash termux-setup.sh              تشغيل عادي
#   bash termux-setup.sh --extras     تثبيت أدوات إضافية (ffmpeg, termux-api, jq…)
#   bash termux-setup.sh --port 8080  تغيير المنفذ
#   bash termux-setup.sh --no-auth    تعطيل رمز الجسر (جهاز شخصي فقط)
#
# ينشئ مساحة العمل /sdcard/Qaswara_Workspace، يثبّت ما ينقص، يشغّل الجسر،
# ويطبع الرمز والرابط. لا يحتاج root ولا يرفع شيئاً إلى السحابة.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${QASWARA_WORKSPACE:-/sdcard/Qaswara_Workspace}"
STATE_DIR="${QASWARA_STATE:-$HOME/.qaswara}"
PORT="${QASWARA_PORT:-8080}"
HOST="${QASWARA_HOST:-127.0.0.1}"
EXTRAS=0
NO_AUTH=0

while [ $# -gt 0 ]; do
  case "$1" in
    --extras) EXTRAS=1 ;;
    --no-auth) NO_AUTH=1 ;;
    --port) shift; PORT="${1:-8080}" ;;
    --host) shift; HOST="${1:-127.0.0.1}" ;;
    --workspace) shift; WORKSPACE="${1:-$WORKSPACE}" ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *) echo "خيار غير معروف: $1" >&2; exit 2 ;;
  esac
  shift
done

say()  { printf '\033[1;32m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✕\033[0m %s\n' "$*" >&2; exit 1; }

if ! command -v python3 >/dev/null 2>&1; then
  warn "python3 غير مثبّت — سأثبّته الآن…"
  pkg update -y >/dev/null 2>&1 || true
  pkg install -y python
fi

# Storage permission is needed for /sdcard/Qaswara_Workspace
if [ ! -d /sdcard ]; then
  warn "لا يمكن الوصول إلى /sdcard. شغّل: termux-setup-storage ثم أعد هذا السكربت."
fi
mkdir -p "$WORKSPACE" 2>/dev/null || {
  warn "تعذّر إنشاء $WORKSPACE — سأستخدم $HOME/Qaswara_Workspace بدلاً منه."
  WORKSPACE="$HOME/Qaswara_Workspace"
  mkdir -p "$WORKSPACE"
}
mkdir -p "$STATE_DIR" "$WORKSPACE/artifacts" "$WORKSPACE/exports" "$WORKSPACE/uploads" "$WORKSPACE/captures"
chmod 700 "$STATE_DIR"

if [ "$EXTRAS" -eq 1 ]; then
  say "تثبيت الأدوات الإضافية (قد يستغرق دقائق)…"
  pkg update -y >/dev/null 2>&1 || true
  for pkg_name in termux-api jq ffmpeg tesseract poppler git; do
    pkg install -y "$pkg_name" >/dev/null 2>&1 && say "ثُبّت $pkg_name" || warn "تعذّر تثبيت $pkg_name (يمكنك تثبيته لاحقاً: pkg install $pkg_name)"
  done
  pip install --quiet --upgrade reportlab pypdf openpyxl 2>/dev/null && say "ثُبّتت مكتبات PDF/Office" || warn "تعذّر تثبيت مكتبات Python الإضافية (اختيارية)."
  warn "لمنح صلاحيات الهاتف: افتح تطبيق Termux:API وامنح جهات الاتصال/الهاتف/SMS."
  warn "لتفعيل Shizuku: ثبّت Shizuku وشغّله، ثم في Termux: rish"
fi

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true

TOKEN="${QASWARA_TOKEN:-}"
if [ -z "$TOKEN" ] && [ "$NO_AUTH" -eq 0 ]; then
  if [ -f "$STATE_DIR/bridge_token" ]; then
    TOKEN="$(cat "$STATE_DIR/bridge_token")"
  else
    TOKEN="$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')"
  fi
  printf '%s\n' "$TOKEN" > "$STATE_DIR/bridge_token"
  chmod 600 "$STATE_DIR/bridge_token"
fi

say "مساحة العمل : $WORKSPACE"
say "ملفات الحالة: $STATE_DIR"
say "العنوان     : http://$HOST:$PORT/"
if [ -n "$TOKEN" ]; then
  say "رمز الجسر    : $TOKEN"
  say "انسخه إلى ⚙ الإعدادات في الواجهة (أو افتح الواجهة من هذا الهاتف مباشرة — يُحقن تلقائياً)."
fi

if command -v termux-open-url >/dev/null 2>&1; then
  termux-open-url "http://$HOST:$PORT/" >/dev/null 2>&1 || true
fi

cd "$REPO_DIR"
say "تشغيل قسورة… (اترك هذه النافذة مفتوحة، أو استخدم: tmux)"
ARGS=(--host "$HOST" --port "$PORT" --workspace "$WORKSPACE" --state-dir "$STATE_DIR")
if [ -n "$TOKEN" ]; then
  ARGS+=(--token "$TOKEN")
else
  ARGS+=(--no-auth)
fi
exec python3 bridge/qaswara_bridge.py "${ARGS[@]}"
