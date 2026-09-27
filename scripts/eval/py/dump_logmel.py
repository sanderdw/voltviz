"""Dump beat_this's own log-mel spectrogram and small0 beat activations for the first
`seconds` of a file, for the TypeScript parity check (scripts/eval/neural-parity.ts)."""
import sys, json
import numpy as np, soxr, torch
from beat_this.preprocessing import load_audio, LogMelSpect
from beat_this.inference import load_model
path, out, seconds = sys.argv[1], sys.argv[2], float(sys.argv[3])
y, sr = load_audio(path)
if y.ndim == 2: y = y.mean(1)
y = y[: int(seconds * sr)]
y22 = soxr.resample(y, in_rate=sr, out_rate=22050)
spect = LogMelSpect()(torch.tensor(y22, dtype=torch.float32)).numpy().astype(np.float32)
spect.tofile(out + ".logmel.f32")
m = load_model("small0", "cpu").eval()
with torch.no_grad():
    o = m(torch.tensor(spect[-500:][None]))
torch.sigmoid(o["beat"][0]).numpy().astype(np.float32).tofile(out + ".beat.f32")
json.dump({"frames": int(spect.shape[0]), "mels": int(spect.shape[1])}, open(out + ".json", "w"))
print("frames", spect.shape)
