import type { VisualizerFactory } from '../runtime/types';

const FFT_SIZE = 1024;

const GlitchDatabend: VisualizerFactory = ({ container }) => {
  const wrapper = document.createElement('div');
  wrapper.className = 'w-full h-full relative bg-black';
  container.appendChild(wrapper);

  const canvas = document.createElement('canvas');
  canvas.className = 'absolute inset-0 w-full h-full';
  wrapper.appendChild(canvas);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  let frameCount = 0;

  // Generate color palette
  const palette = [
    [0, 255, 136],   // neon green
    [255, 0, 102],    // hot pink
    [0, 204, 255],    // cyan
    [255, 204, 0],    // amber
    [153, 0, 255],    // purple
    [255, 51, 0],     // red-orange
  ];

  return {
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
    },
    frame({ audio, settings }) {
      const w = canvas.width;
      const h = canvas.height;
      const s = settings;
      frameCount++;
      const frame = frameCount;

      const freqData = audio.spectrum({ fftSize: FFT_SIZE, smoothing: 0.4 });
      const timeData = audio.waveform({ fftSize: FFT_SIZE, smoothing: 0.4 });
      const bufferLength = freqData.length;

      // Band analysis
      const bassEnd = Math.floor(bufferLength * 0.08);
      const midEnd = Math.floor(bufferLength * 0.4);
      let bassSum = 0, midSum = 0, highSum = 0, totalSum = 0;
      for (let i = 0; i < bufferLength; i++) {
        totalSum += freqData[i];
        if (i < bassEnd) bassSum += freqData[i];
        else if (i < midEnd) midSum += freqData[i];
        else highSum += freqData[i];
      }
      const bass = (bassSum / bassEnd) / 255 * s.sensitivity;
      const mid = (midSum / (midEnd - bassEnd)) / 255 * s.sensitivity;
      const high = (highSum / (bufferLength - midEnd)) / 255 * s.sensitivity;
      const overall = (totalSum / bufferLength) / 255 * s.sensitivity;

      // --- Phase 1: Draw base scene (dark with waveform and frequency blocks) ---
      // Fade previous frame instead of clearing (creates trails)
      ctx.fillStyle = `rgba(0, 0, 0, ${0.15 + (1 - overall) * 0.3})`;
      ctx.fillRect(0, 0, w, h);

      // Draw frequency spectrum as vertical blocks that corrupt
      const blockCols = 64;
      const blockW = w / blockCols;
      for (let i = 0; i < blockCols; i++) {
        const freqIdx = Math.floor((i / blockCols) * bufferLength);
        const val = freqData[freqIdx] / 255;
        const blockH = val * h * 0.6 * s.scale;

        // Corrupt block position based on bass
        let bx = i * blockW;
        let by = h - blockH;
        if (bass > 0.4) {
          bx += (Math.random() - 0.5) * bass * 30;
          by += (Math.random() - 0.5) * bass * 20;
        }

        const col = palette[i % palette.length];
        const alpha = 0.3 + val * 0.7;
        ctx.fillStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${alpha})`;
        ctx.fillRect(bx, by, blockW - 1, blockH);

        // Duplicate/echo block on heavy bass
        if (bass > 0.5 && Math.random() < bass * 0.3) {
          ctx.fillStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${alpha * 0.4})`;
          const echoX = bx + (Math.random() - 0.5) * w * 0.3;
          ctx.fillRect(echoX, by, blockW - 1, blockH * 0.5);
        }
      }

      // Draw waveform as corrupted line
      ctx.beginPath();
      ctx.strokeStyle = `rgba(0, 255, 136, ${0.5 + mid * 0.5})`;
      ctx.lineWidth = 1 + mid * 3;
      const sliceWidth = w / FFT_SIZE;
      let x = 0;
      for (let i = 0; i < FFT_SIZE; i++) {
        const v = timeData[i] / 128.0;
        const y = (v * h) / 2;
        // Corrupt waveform positions on beats
        const corruptY = high > 0.3 && Math.random() < high * 0.1
          ? y + (Math.random() - 0.5) * 100
          : y;
        if (i === 0) ctx.moveTo(x, corruptY);
        else ctx.lineTo(x, corruptY);
        x += sliceWidth;
      }
      ctx.stroke();

      // --- Phase 2: Pixel manipulation (databend effects) ---
      if (overall > 0.15) {
        const imageData = ctx.getImageData(0, 0, w, h);
        const pixels = imageData.data;

        // Effect 1: Pixel sorting - sort rows by brightness on mid frequencies
        if (mid > 0.25) {
          const sortRows = Math.floor(mid * 30 * s.scale);
          for (let r = 0; r < sortRows; r++) {
            const row = Math.floor(Math.random() * h);
            const startX = Math.floor(Math.random() * w * 0.3);
            const length = Math.floor(Math.random() * w * 0.5 * mid) + 10;
            const endX = Math.min(startX + length, w);

            // Collect pixels in this row segment
            const rowPixels: { brightness: number; r: number; g: number; b: number; a: number }[] = [];
            for (let px = startX; px < endX; px++) {
              const idx = (row * w + px) * 4;
              const br = pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
              rowPixels.push({ brightness: br, r: pixels[idx], g: pixels[idx + 1], b: pixels[idx + 2], a: pixels[idx + 3] });
            }
            rowPixels.sort((a, b) => a.brightness - b.brightness);

            // Write back sorted pixels
            for (let px = 0; px < rowPixels.length; px++) {
              const idx = (row * w + startX + px) * 4;
              pixels[idx] = rowPixels[px].r;
              pixels[idx + 1] = rowPixels[px].g;
              pixels[idx + 2] = rowPixels[px].b;
              pixels[idx + 3] = rowPixels[px].a;
            }
          }
        }

        // Effect 2: Channel shift / chromatic aberration on bass
        if (bass > 0.3) {
          const shift = Math.floor(bass * 15 * s.scale);
          const tempR = new Uint8ClampedArray(pixels.length);
          const tempB = new Uint8ClampedArray(pixels.length);

          for (let i = 0; i < pixels.length; i += 4) {
            tempR[i] = pixels[i]; // red channel original
            tempB[i + 2] = pixels[i + 2]; // blue channel original
          }

          // Shift red channel right, blue channel left
          for (let y = 0; y < h; y++) {
            for (let px = 0; px < w; px++) {
              const idx = (y * w + px) * 4;
              const srcR = (y * w + Math.max(0, px - shift)) * 4;
              const srcB = (y * w + Math.min(w - 1, px + shift)) * 4;
              pixels[idx] = tempR[srcR]; // shifted red
              pixels[idx + 2] = tempB[srcB + 2]; // shifted blue
            }
          }
        }

        // Effect 3: Block displacement on high transients
        if (high > 0.35) {
          const numBlocks = Math.floor(high * 8 * s.scale);
          for (let b = 0; b < numBlocks; b++) {
            const bw = Math.floor(Math.random() * 120 + 20);
            const bh = Math.floor(Math.random() * 60 + 5);
            const srcX = Math.floor(Math.random() * (w - bw));
            const srcY = Math.floor(Math.random() * (h - bh));
            const dstX = srcX + Math.floor((Math.random() - 0.5) * 200 * high);
            const dstY = srcY + Math.floor((Math.random() - 0.5) * 100 * high);

            // Copy block to displaced position
            for (let row = 0; row < bh; row++) {
              const sy = srcY + row;
              const dy = dstY + row;
              if (sy < 0 || sy >= h || dy < 0 || dy >= h) continue;
              for (let col = 0; col < bw; col++) {
                const sx = srcX + col;
                const dx = dstX + col;
                if (sx < 0 || sx >= w || dx < 0 || dx >= w) continue;
                const sIdx = (sy * w + sx) * 4;
                const dIdx = (dy * w + dx) * 4;
                pixels[dIdx] = pixels[sIdx];
                pixels[dIdx + 1] = pixels[sIdx + 1];
                pixels[dIdx + 2] = pixels[sIdx + 2];
                pixels[dIdx + 3] = pixels[sIdx + 3];
              }
            }
          }
        }

        // Effect 4: Data corruption - randomly invert/xor pixel values
        if (overall > 0.4) {
          const corruptCount = Math.floor(overall * 500 * s.scale);
          for (let c = 0; c < corruptCount; c++) {
            const idx = Math.floor(Math.random() * (pixels.length / 4)) * 4;
            const mode = Math.random();
            if (mode < 0.33) {
              // Invert
              pixels[idx] = 255 - pixels[idx];
              pixels[idx + 1] = 255 - pixels[idx + 1];
              pixels[idx + 2] = 255 - pixels[idx + 2];
            } else if (mode < 0.66) {
              // XOR with pattern
              const pattern = Math.floor(Math.random() * 256);
              pixels[idx] ^= pattern;
              pixels[idx + 1] ^= pattern;
              pixels[idx + 2] ^= pattern;
            } else {
              // Channel swap
              const tmp = pixels[idx];
              pixels[idx] = pixels[idx + 2];
              pixels[idx + 2] = tmp;
            }
          }
        }

        // Effect 5: Horizontal tear lines
        if (bass > 0.35) {
          const tearCount = Math.floor(bass * 6);
          for (let t = 0; t < tearCount; t++) {
            const tearY = Math.floor(Math.random() * h);
            const tearH = Math.floor(Math.random() * 4) + 1;
            const tearShift = Math.floor((Math.random() - 0.5) * w * 0.3 * bass);

            for (let row = tearY; row < Math.min(tearY + tearH, h); row++) {
              const rowData = new Uint8ClampedArray(w * 4);
              for (let px = 0; px < w; px++) {
                const srcIdx = (row * w + px) * 4;
                rowData[px * 4] = pixels[srcIdx];
                rowData[px * 4 + 1] = pixels[srcIdx + 1];
                rowData[px * 4 + 2] = pixels[srcIdx + 2];
                rowData[px * 4 + 3] = pixels[srcIdx + 3];
              }
              for (let px = 0; px < w; px++) {
                let srcPx = px - tearShift;
                if (srcPx < 0) srcPx += w;
                if (srcPx >= w) srcPx -= w;
                const dstIdx = (row * w + px) * 4;
                pixels[dstIdx] = rowData[srcPx * 4];
                pixels[dstIdx + 1] = rowData[srcPx * 4 + 1];
                pixels[dstIdx + 2] = rowData[srcPx * 4 + 2];
                pixels[dstIdx + 3] = rowData[srcPx * 4 + 3];
              }
            }
          }
        }

        ctx.putImageData(imageData, 0, 0);
      }

      // --- Phase 3: Overlay effects (drawn on top) ---

      // VHS tracking lines
      if (frame % 3 === 0 || bass > 0.5) {
        const lineCount = bass > 0.5 ? 8 : 3;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.03 + bass * 0.05})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < lineCount; i++) {
          const ly = (frame * (2 + i) * s.speed) % h;
          ctx.beginPath();
          ctx.moveTo(0, ly);
          ctx.lineTo(w, ly);
          ctx.stroke();
        }
      }

      // Scanline overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
      for (let y = 0; y < h; y += 3) {
        ctx.fillRect(0, y, w, 1);
      }

      // Glitch text fragments on heavy beats
      if (bass > 0.6 && Math.random() < 0.3) {
        const glitchTexts = ['ERR0R', 'DATA_CORRUPT', '0xFF', 'NULL', 'BREAK', '////', '████', '▓▓▓▓', 'VOID', 'SEGFAULT'];
        const count = Math.floor(bass * 4);
        for (let i = 0; i < count; i++) {
          const text = glitchTexts[Math.floor(Math.random() * glitchTexts.length)];
          const col = palette[Math.floor(Math.random() * palette.length)];
          ctx.font = `${Math.floor(12 + Math.random() * 24)}px monospace`;
          ctx.fillStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${0.5 + Math.random() * 0.5})`;
          ctx.fillText(text, Math.random() * w, Math.random() * h);
        }
      }

      // Screen flash on very hard transients
      if (bass > 0.8 && Math.random() < 0.15) {
        ctx.fillStyle = `rgba(255, 255, 255, ${0.05 + bass * 0.1})`;
        ctx.fillRect(0, 0, w, h);
      }

      // Color tint bars (VHS artifact)
      if (overall > 0.3) {
        const barCount = Math.floor(overall * 3);
        for (let i = 0; i < barCount; i++) {
          const barY = Math.random() * h;
          const barH = Math.random() * 30 + 5;
          const col = palette[Math.floor(Math.random() * palette.length)];
          ctx.fillStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, 0.03)`;
          ctx.fillRect(0, barY, w, barH);
        }
      }
    },
    dispose() {
      wrapper.remove();
    },
  };
};

export default GlitchDatabend;
