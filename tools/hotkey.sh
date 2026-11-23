#!/data/data/com.termux/files/usr/bin/bash
# ---------------------------------------------------------------------------
# قسورة | QASWARA — زر الجهاز السريع (Volume-Up مرتين / ضغطة طويلة)
#
#   bash tools/hotkey.sh            مراقبة زر رفع الصوت وفتح قسورة
#   bash tools/hotkey.sh --stop     إيقاف المراقبة
#
# يعمل عبر Shizuku (rish) لأن قراءة أحداث الأزرار تحتاج صلاحية شل النظام.
# الفكرة: نراقب getevent، وعند ضغط VOLUME_UP نفتح واجهة قسورة فوراً من أي تطبيق.
# ---------------------------------------------------------------------------
set -uo pipefail

URL="${QASWARA_URL:-http://127.0.0.1:8080/}"
PIDFILE="${TMPDIR:-/tmp}/qaswara_hotkey.pid"

open_qaswara() {
  if command -v rish >/dev/null 2>&1; then
    rish -c "am start -a android.intent.action.VIEW -d '$URL'" >/dev/null 2>&1 && return 0
    # محاولة نافذة عائمة إن كان الجهاز يدعم freeform
    rish -c "am start --windowingMode 5 -a android.intent.action.VIEW -d '$URL'" >/dev/null 2>&1 && return 0
  fi
  if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "$URL" >/dev/null 2>&1 && return 0
  fi
  printf 'تعذّر الفتح: ثبّت Shizuku وشغّل rish، أو termux-api.\n' >&2
  return 1
}

if [ "${1:-}" = "--stop" ]; then
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
    echo "أُوقفت مراقبة الزر."
  else
    echo "لا مراقبة تعمل."
  fi
  exit 0
fi

if ! command -v rish >/dev/null 2>&1; then
  echo "⚠️  rish غير مثبت. فعّل Shizuku أولاً (https://shizuku.rikka.app) ثم شغّل rish." >&2
fi

echo "▸ يراقب زر رفع الصوت… (اضغط Volume-Up لفتح قسورة) — للإيقاف: bash tools/hotkey.sh --stop"
echo $$ > "$PIDFILE"

rish -c "getevent -ql /dev/input/event*" 2>/dev/null | while read -r line; do
  case "$line" in
    *KEY_VOLUMEUP*DOWN*|*KEY_VOLUMEUP*\ 00000001*)
      open_qaswara
      sleep 1
      ;;
  esac
done
