"""Export beat_this (small0) to the ONNX file shipped in public/models/.

The model is traced with a fixed input of 500 log-mel frames (10 s at 50 fps): the engine
always analyses the latest 10 s window, and tracing bakes the rotary-embedding tables in for
that length. The output is the sigmoid beat/downbeat probability per frame.

    uv run --with torch --with onnx --with "beat_this @ git+https://github.com/CPJKU/beat_this" \
        scripts/eval/py/export_beat_model.py public/models/beat_this_small0.onnx
"""
import sys

import numpy as np
import torch
from beat_this.inference import load_model

out = sys.argv[1]
model = load_model("small0", "cpu").eval()


class Wrap(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, spect):
        o = self.m(spect)
        return torch.sigmoid(o["beat"]), torch.sigmoid(o["downbeat"])


w = Wrap(model).eval()
x = torch.randn(1, 500, 128)
torch.onnx.export(w, (x,), out, input_names=["spect"], output_names=["beat", "downbeat"], opset_version=17, dynamo=False)

import onnxruntime as ort  # noqa: E402

sess = ort.InferenceSession(out, providers=["CPUExecutionProvider"])
with torch.no_grad():
    ref = w(x)[0].numpy()
got = sess.run(None, {"spect": x.numpy()})[0]
print("exported", out, "max abs diff vs torch:", float(np.abs(ref - got).max()))
