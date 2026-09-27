import { mountCanvas2D } from '../lib/canvas2d';
import type { VisualizerFactory } from '../runtime/types';

const CHARS = ' `.-\':_,^=;><+!rc*/z?sLTv)J7(|Fi{C}fI31tlu[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@█';

const Ascii: VisualizerFactory = ({ container }) => {
  const c = mountCanvas2D(container);
  const canvas = c.canvas;
  const ctx = c.ctx;

  const history: number[][] = [];
  let cols = 80;
  let rows = 30;
  let fontSize = 10;
  let lineHeight = 18;
  let charWidth = 8;

  return {
    resize(w, h, dpr) {
      c.resize(w, h, dpr);
      const targetCols = 80;
      charWidth = Math.max(8, Math.floor(canvas.width / targetCols));
      fontSize = Math.floor(charWidth * 1.6);
      lineHeight = Math.floor(fontSize * 1.1);
      cols = Math.floor(canvas.width / charWidth);
      rows = Math.floor(canvas.height / lineHeight);
      history.length = 0;
    },
    frame({ audio, settings }) {
      const s = settings;
      const dataArray = audio.spectrum({ fftSize: 256, smoothing: 0.8 });
      const bufferLength = dataArray.length;

      const row: number[] = [];
      for (let i = 0; i < cols; i++) {
        const idx = Math.floor((i / cols) * bufferLength);
        row.push(Math.min(1, (dataArray[idx] / 255) * s.sensitivity));
      }

      history.unshift(row);
      const maxRows = Math.floor(rows * s.scale);
      if (history.length > maxRows) history.length = maxRows;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${fontSize}px monospace`;
      ctx.textBaseline = 'top';

      const time = Date.now() * 0.001 * s.speed;

      for (let y = 0; y < history.length; y++) {
        const rowData = history[y];
        const fade = 1 - (y / history.length) * 0.6;
        for (let x = 0; x < cols; x++) {
          const val = x < rowData.length ? rowData[x] : 0;
          if (val < 0.02) continue;

          const charIdx = Math.floor(val * (CHARS.length - 1));
          const ch = CHARS[charIdx];

          const hue = ((x / cols) * 120 + s.hueShift + time * 30) % 360;
          const lightness = 40 + val * 40;
          const alpha = (0.3 + val * 0.7) * fade;

          ctx.fillStyle = `hsla(${hue},85%,${lightness}%,${alpha})`;
          ctx.fillText(ch, x * charWidth, y * lineHeight);
        }
      }
    },
    dispose() {
      canvas.remove();
    },
  };
};

export default Ascii;
