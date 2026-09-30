# /// script
# requires-python = ">=3.10,<3.12"
# dependencies = [
#   "cython", "numpy<2", "scipy", "mido", "setuptools",
#   "madmom @ git+https://github.com/CPJKU/madmom",
#   "torch", "torchaudio", "beat_this @ git+https://github.com/CPJKU/beat_this",
# ]
# [tool.uv]
# no-build-isolation-package = ["madmom"]
# ///
"""
Independent reference beat annotations for the VoltViz audio-engine evaluation.

Two state-of-the-art offline trackers with unrelated architectures (non-causal, full-excerpt
knowledge):
  * primary:     madmom RNN + DBN beat tracker (Boeck et al.), downbeats from madmom's
                 RNN + DBN downbeat tracker
  * cross-check: beat_this (Foscarin et al., ISMIR 2024), a transformer trained on a different
                 and much larger dataset collection
A 10 s window counts as unambiguous ("agree") when the two agree on the beat positions
(F-measure >= 0.9 at +-70 ms). Only unambiguous windows are used for gated metrics.
"agreeAnyLevel" relaxes this to the same beats at a different metrical level (one tracker at
half or double the other's tempo, e.g. 77 vs 154 BPM on a rock ballad); the genre evaluation
gates on those windows because the expected pulse is set per excerpt.

Informational extras (not used for gating):
  * grid fit: linear regression of the beat times (a steady tempo is a straight line)
  * folded 2-8 kHz transient and 40-120 Hz kick-body envelopes around the reference beats.
    These physical checks are unreliable on dance music (pickup hits just before the beat and
    loud off-beat hats), which is why the engine takes its beat phase from the
    150 Hz - 6 kHz band; see the report.
(librosa was evaluated as a cross-check but lost the beat after ~30 s on dance music.)

Only an excerpt is analysed (default: the first 120 s). Long files need several GB of RAM in
madmom's multi-resolution STFT; 2-minute excerpts peak below 1 GB.

Usage:  uv run scripts/eval/reference.py <audio file> <out.json> [--start S] [--seconds N] [--source LABEL]
(ffmpeg must be on PATH; madmom needs cython/numpy present at build time, see header.)
"""
import argparse
import json
import subprocess

import numpy as np

SR = 44100
WINDOW = 10.0
TOL = 0.07


def load_mono(path: str, start: float, seconds: float) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(seconds), "-i", path,
         "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def f_measure(ref: np.ndarray, est: np.ndarray, tol: float = TOL) -> float:
    if len(ref) == 0 and len(est) == 0:
        return 1.0
    if len(ref) == 0 or len(est) == 0:
        return 0.0
    used = np.zeros(len(est), dtype=bool)
    hits = 0
    for r in ref:
        idx = np.searchsorted(est, r)
        best, best_d = -1, tol + 1
        for j in (idx - 1, idx):
            if 0 <= j < len(est) and not used[j]:
                d = abs(est[j] - r)
                if d <= tol and d < best_d:
                    best, best_d = j, d
        if best >= 0:
            used[best] = True
            hits += 1
    p = hits / len(est)
    r = hits / len(ref)
    return 0.0 if p + r == 0 else 2 * p * r / (p + r)


def transient_envelope(audio: np.ndarray) -> np.ndarray:
    """2-8 kHz amplitude envelope (1 ms smoothing): kick clicks / attacks show up as sharp peaks."""
    from scipy.signal import butter, hilbert, sosfiltfilt
    sos = butter(4, [2000, 8000], btype="bandpass", fs=SR, output="sos")
    env = np.abs(hilbert(sosfiltfilt(sos, audio.astype(np.float64))))
    k = SR // 1000
    return np.convolve(env, np.ones(k) / k, mode="same")


def fold_offset_ms(env: np.ndarray, beats: np.ndarray) -> float | None:
    """Offset (ms) of the peak of the envelope folded around the given beats (+- half a beat)."""
    if len(beats) < 3:
        return None
    half = int(np.median(np.diff(beats)) * SR / 2)
    acc = np.zeros(2 * half)
    used = 0
    for b in beats:
        c = int(round(b * SR))
        if c - half < 0 or c + half > len(env):
            continue
        acc += env[c - half:c + half]
        used += 1
    if used < 3:
        return None
    return round(float(np.argmax(acc) - half) * 1000 / SR, 1)


def kick_envelope(audio: np.ndarray) -> np.ndarray:
    """40-120 Hz amplitude envelope with 20 ms smoothing (kick body)."""
    from scipy.signal import butter, hilbert, sosfiltfilt
    sos = butter(4, [40, 120], btype="bandpass", fs=SR, output="sos")
    env = np.abs(hilbert(sosfiltfilt(sos, audio.astype(np.float64))))
    k = int(SR * 0.02)
    return np.convolve(env, np.ones(k) / k, mode="same")


def kick_rise_offset_ms(env: np.ndarray, beats: np.ndarray) -> float | None:
    """Offset (ms) of the steepest 30 ms rise of the folded kick envelope (out of the sidechain gap)."""
    if len(beats) < 3:
        return None
    half = int(np.median(np.diff(beats)) * SR / 2)
    acc = np.zeros(2 * half)
    for b in beats:
        c = int(round(b * SR))
        if c - half < 0 or c + half > len(env):
            continue
        acc += env[c - half:c + half]
    lag = int(SR * 0.03)
    rise = acc[lag:] - acc[:-lag]
    return round(float(np.argmax(rise) + lag / 2 - half) * 1000 / SR, 1)


def level_agreement(a: np.ndarray, b: np.ndarray) -> float:
    """Agreement allowing one tracker at half the other's tempo (either parity)."""
    return max(f_measure(a, b), f_measure(a[::2], b), f_measure(a[1::2], b),
               f_measure(a, b[::2]), f_measure(a, b[1::2]))


def regression_grid(beats: np.ndarray) -> dict:
    k = np.arange(len(beats))
    slope, intercept = np.polyfit(k, beats, 1)
    res = beats - (slope * k + intercept)
    return {"bpm": round(float(60 / slope), 4), "residualStdMs": round(float(res.std() * 1000), 2),
            "residualMaxMs": round(float(np.abs(res).max() * 1000), 2)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--seconds", type=float, default=120.0)
    ap.add_argument("--source", default=None, help="label of the audio source")
    args = ap.parse_args()
    src, out = args.src, args.out
    audio = load_mono(src, args.start, args.seconds)
    duration = len(audio) / SR
    print(f"decoded {duration:.1f}s", flush=True)

    from madmom.audio.signal import Signal
    from madmom.features.beats import DBNBeatTrackingProcessor, RNNBeatProcessor
    from madmom.features.downbeats import DBNDownBeatTrackingProcessor, RNNDownBeatProcessor

    sig = Signal(audio, sample_rate=SR, num_channels=1)
    act = RNNBeatProcessor()(sig)
    print("madmom beat activations done", flush=True)
    mm_beats = DBNBeatTrackingProcessor(fps=100, min_bpm=55, max_bpm=215, transition_lambda=100)(act)
    print(f"madmom beats: {len(mm_beats)}", flush=True)

    dact = RNNDownBeatProcessor()(sig)
    db = DBNDownBeatTrackingProcessor(beats_per_bar=[4], fps=100, min_bpm=55, max_bpm=215)(dact)
    mm_downbeats = db[db[:, 1] == 1, 0]
    print(f"madmom downbeats: {len(mm_downbeats)}", flush=True)

    from beat_this.inference import Audio2Beats
    bt_beats, bt_downbeats = Audio2Beats(checkpoint_path="final0", device="cpu", dbn=False)(audio, SR)
    bt_beats = np.asarray(bt_beats, dtype=float)
    bt_downbeats = np.asarray(bt_downbeats, dtype=float)
    print(f"beat_this beats: {len(bt_beats)}", flush=True)

    tr_env = transient_envelope(audio)
    k_env = kick_envelope(audio)
    grid = regression_grid(mm_beats)

    windows = []
    t = 0.0
    while t + WINDOW <= duration + 1e-6:
        a = mm_beats[(mm_beats >= t) & (mm_beats < t + WINDOW)]
        b = bt_beats[(bt_beats >= t) & (bt_beats < t + WINDOW)]
        f = f_measure(a, b)
        fl = level_agreement(a, b)
        bpm = float(60.0 / np.median(np.diff(a))) if len(a) >= 3 else None
        bt_bpm = float(60.0 / np.median(np.diff(b))) if len(b) >= 3 else None
        seg = audio[int(t * SR):int((t + WINDOW) * SR)]
        rms_db = float(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9))
        offs = [float(x - a[np.argmin(np.abs(a - x))]) * 1000 for x in b] if len(a) else []
        windows.append({"start": round(t, 3), "end": round(t + WINDOW, 3), "bpm": bpm,
                        "crossCheckBpm": bt_bpm,
                        "agreement": round(f, 4),
                        "agreementAnyLevel": round(fl, 4),
                        "crossCheckOffsetMs": round(float(np.median(offs)), 1) if offs else None,
                        "transientFoldMs": fold_offset_ms(tr_env, a),
                        "kickRiseMs": kick_rise_offset_ms(k_env, a),
                        "agree": bool(f >= 0.9 and bpm is not None),
                        "agreeAnyLevel": bool(fl >= 0.9 and bpm is not None),
                        "rmsDb": round(rms_db, 2)})
        t += WINDOW

    agree = sum(w["agree"] for w in windows)
    agree_any = sum(w["agreeAnyLevel"] for w in windows)
    print(f"grid: {grid['bpm']:.3f} BPM, residual std {grid['residualStdMs']:.1f} ms", flush=True)
    print(f"windows agreed: {agree}/{len(windows)} (any metrical level: {agree_any})", flush=True)

    json.dump({
        **({"source": args.source} if args.source else {}),
        "excerpt": {"start": args.start, "seconds": args.seconds},
        "duration": round(duration, 3),
        "sampleRate": SR,
        "tools": {"primary": "madmom RNNBeatProcessor + DBNBeatTrackingProcessor (downbeats: RNNDownBeatProcessor + DBN)",
                  "crossCheck": "beat_this final0 checkpoint (transformer, ISMIR 2024), no DBN",
                  "agreement": "per 10 s window, F-measure(madmom, beat_this) >= 0.9 at +-70 ms",
                  "agreementAnyLevel": "same, also allowing either tracker at half the other's tempo"},
        "windowSeconds": WINDOW,
        "grid": grid,
        "transientFoldMs": fold_offset_ms(tr_env, mm_beats),
        "kickRiseMs": kick_rise_offset_ms(k_env, mm_beats),
        "beats": [round(float(x), 3) for x in mm_beats],
        "downbeats": [round(float(x), 3) for x in mm_downbeats],
        "crossCheckBeats": [round(float(x), 3) for x in bt_beats],
        "crossCheckDownbeats": [round(float(x), 3) for x in bt_downbeats],
        "windows": windows,
    }, open(out, "w"), separators=(",", ":"))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
