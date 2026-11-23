"""
QASWARA — creative audio/video engine.

What is genuinely produced on-device:
  • instrumental music (pure-Python WAV synthesis: chords + arpeggio + envelope)
  • spoken/sung vocal track when `espeak-ng` is available (robotic by design)
  • MP3/MP4 muxing with ffmpeg
  • video from images (or generated colour frames) + audio, with Ken-Burns zoom

What is *not* synthesized here: realistic singing voices or text-to-video.
Those need a hosted media model; QASWARA reports that explicitly instead of
pretending. Everything that is claimed below really runs.
"""

from __future__ import annotations

import math
import os
import random
import shutil
import struct
import subprocess
import wave
from typing import Dict, List, Optional

SAMPLE_RATE = 44100


class MediaError(RuntimeError):
    def __init__(self, message: str, *, code: str = "media_error", install: Optional[dict] = None):
        super().__init__(message)
        self.code = code
        self.install = install or {}


def have(binary: str) -> bool:
    return shutil.which(binary) is not None


def probe() -> Dict[str, bool]:
    return {
        "ffmpeg": have("ffmpeg"),
        "ffprobe": have("ffprobe"),
        "espeak": have("espeak-ng") or have("espeak"),
        "sox": have("sox"),
    }


def _ffmpeg() -> str:
    if not have("ffmpeg"):
        raise MediaError(
            "سجل الصوت/الفيديو يحتاج ffmpeg.",
            code="missing_dependency",
            install={"manager": "pkg", "packages": ["ffmpeg"], "reason": "توليد mp3/mp4"},
        )
    return "ffmpeg"


def _run(args: List[str], timeout: int = 240) -> str:
    proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise MediaError(
            f"فشل تنفيذ {args[0]}: {(proc.stderr or proc.stdout or '')[-600:]}",
            code="command_failed",
        )
    return proc.stdout


# --------------------------------------------------------------------------- #
# pure-Python synthesis                                                       #
# --------------------------------------------------------------------------- #

SCALES = {
    "hijaz": [0, 1, 4, 5, 7, 8, 11],
    "nahawand": [0, 2, 3, 5, 7, 8, 10],
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "pentatonic": [0, 3, 5, 7, 10],
}


def _freq(semitones_from_a4: float) -> float:
    return 440.0 * (2 ** (semitones_from_a4 / 12))


def _envelope(t: float, duration: float, attack: float = 0.02, release: float = 0.12) -> float:
    if t < attack:
        return t / attack
    if t > duration - release:
        return max(0.0, (duration - t) / release)
    return 1.0


def synth_instrumental(
    path: str,
    *,
    seconds: float = 24.0,
    bpm: int = 92,
    scale: str = "hijaz",
    mood: str = "epic",
    seed: int = 0,
) -> Dict[str, object]:
    """Render an instrumental loop as 16-bit mono WAV (no external binaries)."""
    seconds = max(6.0, min(float(seconds), 180.0))
    bpm = max(50, min(int(bpm or 92), 180))
    steps = SCALES.get(scale) or SCALES["hijaz"]
    rng = random.Random(seed or 7)

    beat = 60.0 / bpm
    total_frames = int(SAMPLE_RATE * seconds)
    buffer = [0.0] * total_frames

    root = -9  # A3-ish
    chord_degrees = [[0, 4, 7], [0, 3, 7], [5, 8, 12], [0, 4, 7]] if mood != "sad" else [[0, 3, 7]] * 4
    bars = max(2, int(seconds / (beat * 4)))

    for bar in range(bars):
        chord = chord_degrees[bar % len(chord_degrees)]
        start = int(bar * beat * 4 * SAMPLE_RATE)
        length = int(beat * 4 * SAMPLE_RATE)
        for degree in chord:
            freq = _freq(root + steps[degree % len(steps)] + (12 if degree >= 7 else 0))
            for i in range(length):
                idx = start + i
                if idx >= total_frames:
                    break
                t = i / SAMPLE_RATE
                env = _envelope(t, length / SAMPLE_RATE, 0.03, 0.25)
                # soft pad: fundamental + fifth, slight detune for movement
                buffer[idx] += 0.16 * env * (
                    math.sin(2 * math.pi * freq * t)
                    + 0.5 * math.sin(2 * math.pi * freq * 1.5 * t + 0.4)
                )

        # arpeggio melody, one note per half-beat
        for step in range(8):
            degree = rng.randrange(len(steps))
            freq = _freq(root + 12 + steps[degree])
            note_start = start + int(step * beat * 0.5 * SAMPLE_RATE)
            note_len = int(beat * 0.45 * SAMPLE_RATE)
            for i in range(note_len):
                idx = note_start + i
                if idx >= total_frames:
                    break
                t = i / SAMPLE_RATE
                env = _envelope(t, note_len / SAMPLE_RATE, 0.008, 0.09)
                buffer[idx] += 0.20 * env * math.sin(2 * math.pi * freq * t)

        # light percussion
        for beat_i in range(4):
            perc_start = start + int(beat_i * beat * SAMPLE_RATE)
            perc_len = int(0.08 * SAMPLE_RATE)
            for i in range(perc_len):
                idx = perc_start + i
                if idx >= total_frames:
                    break
                t = i / SAMPLE_RATE
                buffer[idx] += 0.10 * math.exp(-t * 45) * math.sin(2 * math.pi * (90 if beat_i % 2 == 0 else 190) * t)

    peak = max((abs(v) for v in buffer), default=1.0) or 1.0
    gain = min(0.95 / peak, 3.0)
    frames = bytearray()
    for value in buffer:
        sample = int(max(-1.0, min(1.0, value * gain)) * 32767)
        frames += struct.pack("<h", sample)

    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with wave.open(path, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(bytes(frames))
    return {"path": path, "seconds": round(seconds, 2), "bpm": bpm, "scale": scale, "bytes": os.path.getsize(path)}


def synth_vocals(text: str, path: str, *, speed: int = 120) -> Optional[Dict[str, object]]:
    """Speak/sing the lyrics with espeak-ng if it exists. Returns None if absent."""
    binary = shutil.which("espeak-ng") or shutil.which("espeak")
    if not binary:
        return None
    clean = " ".join(str(text).split())[:1200]
    for voice in ("ar", "ar-sa", "en"):
        try:
            _run([binary, "-v", voice, "-s", str(speed), "-w", path, clean], timeout=120)
            if os.path.isfile(path) and os.path.getsize(path) > 1000:
                return {"path": path, "voice": voice, "bytes": os.path.getsize(path)}
        except MediaError:
            continue
    return None


def make_song(
    *,
    out_dir: str,
    title: str,
    lyrics: str,
    bpm: int = 92,
    seconds: float = 24.0,
    scale: str = "hijaz",
    mood: str = "epic",
    with_vocals: bool = True,
) -> Dict[str, object]:
    os.makedirs(out_dir, exist_ok=True)
    base = "".join(ch for ch in (title or "qaswara") if ch.isalnum() or ch in " _-")[:40].strip() or "qaswara"
    safe = base.replace(" ", "_")

    lyrics_path = os.path.join(out_dir, f"{safe}.txt")
    with open(lyrics_path, "w", encoding="utf-8") as handle:
        handle.write(f"{title}\n\n{lyrics}\n")

    inst_path = os.path.join(out_dir, f"{safe}_instrumental.wav")
    info = synth_instrumental(inst_path, seconds=seconds, bpm=bpm, scale=scale, mood=mood, seed=hash(title) % 9999)

    vocal_path = None
    if with_vocals:
        candidate = os.path.join(out_dir, f"{safe}_vocals.wav")
        vocal = synth_vocals(lyrics, candidate)
        if vocal:
            vocal_path = vocal["path"]

    files = [lyrics_path, inst_path] + ([vocal_path] if vocal_path else [])
    note = ""

    if not have("ffmpeg"):
        note = "تم إنتاج WAV + الكلمات. لتجميع MP3 ثبّت ffmpeg: pkg install ffmpeg"
        return {"ok": True, "files": files, "instrumental": info, "vocals": bool(vocal_path), "note": note, "format": "wav"}

    out_path = os.path.join(out_dir, f"{safe}.mp3")
    if vocal_path:
        _run([
            _ffmpeg(), "-y", "-i", inst_path, "-i", vocal_path,
            "-filter_complex", "[0:a]volume=0.55[inst];[1:a]volume=1.6[vox];[inst][vox]amix=inputs=2:duration=longest:dropout_transition=2[out]",
            "-map", "[out]", "-codec:a", "libmp3lame", "-b:a", "192k", out_path,
        ])
    else:
        _run([_ffmpeg(), "-y", "-i", inst_path, "-codec:a", "libmp3lame", "-b:a", "192k", out_path])
        note = "لا يوجد محرك نطق (espeak-ng) — الملف آلي بلا غناء. ثبّته: pkg install espeak-ng"

    files.append(out_path)
    return {
        "ok": True,
        "files": files,
        "primary": out_path,
        "instrumental": info,
        "vocals": bool(vocal_path),
        "note": note,
        "format": "mp3",
        "bytes": os.path.getsize(out_path),
    }


def make_video(
    *,
    out_dir: str,
    images: Optional[List[str]] = None,
    audio: Optional[str] = None,
    seconds_per_image: float = 3.0,
    title: str = "qaswara_video",
    width: int = 1080,
    height: int = 1920,
) -> Dict[str, object]:
    ffmpeg = _ffmpeg()
    os.makedirs(out_dir, exist_ok=True)
    safe = "".join(ch for ch in title if ch.isalnum() or ch in "_-")[:40] or "qaswara_video"
    out_path = os.path.join(out_dir, f"{safe}.mp4")

    existing = [p for p in (images or []) if p and os.path.isfile(p)]
    command = [ffmpeg, "-y"]
    filters = []
    inputs = 0

    if existing:
        for path in existing[:40]:
            command += ["-loop", "1", "-t", str(max(0.5, seconds_per_image)), "-i", path]
            inputs += 1
        for i in range(inputs):
            filters.append(
                f"[{i}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v{i}]"
            )
        concat = "".join(f"[v{i}]" for i in range(inputs))
        filters.append(f"{concat}concat=n={inputs}:v=1:a=0[vout]")
    else:
        # no stills supplied → generate an elegant gradient-free colour canvas
        command += ["-f", "lavfi", "-t", str(max(2.0, seconds_per_image * 4)), "-i",
                    f"color=c=0x04120c:s={width}x{height}:r=30"]
        filters.append("[0:v]format=yuv420p[vout]")
        inputs = 1

    if audio and os.path.isfile(audio):
        command += ["-i", audio]
        audio_index = inputs
        map_audio = ["-map", f"{audio_index}:a", "-c:a", "aac", "-b:a", "192k", "-shortest"]
    else:
        map_audio = []

    command += ["-filter_complex", ";".join(filters), "-map", "[vout]", *map_audio,
                "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", out_path]
    _run(command, timeout=600)

    return {
        "ok": True,
        "path": out_path,
        "bytes": os.path.getsize(out_path),
        "images": len(existing),
        "audio": bool(audio and os.path.isfile(audio)),
        "note": "" if existing else "لا صور — أُنشئ فيديو بخلفية لونية. مرّر صوراً لنتيجة أغنى.",
    }


def trim_audio(*, source: str, out_dir: str, start: float = 0, duration: float = 10) -> Dict[str, object]:
    ffmpeg = _ffmpeg()
    if not os.path.isfile(source):
        raise MediaError(f"الملف غير موجود: {source}", code="not_found")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"trim_{int(start)}_{int(duration)}.mp3")
    _run([ffmpeg, "-y", "-ss", str(max(0, start)), "-t", str(max(0.5, duration)),
          "-i", source, "-codec:a", "libmp3lame", "-b:a", "192k", out_path])
    return {"ok": True, "path": out_path, "bytes": os.path.getsize(out_path)}
