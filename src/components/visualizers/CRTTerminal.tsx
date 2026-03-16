import React, { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function RetroTerminal({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const audioCtxRef = useRef<AudioContext>();
  const analyserRef = useRef<AnalyserNode>();
  const sourceRef = useRef<MediaStreamAudioSourceNode>();
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const timeDataArray = new Uint8Array(bufferLength);

    const resize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };
    window.addEventListener('resize', resize);
    resize();

    let frameCount = 0;

    const dataFeed: string[] = [];
    const generateLogLine = () => {
      const hex = Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0');
      const actions = ['ALLOC', 'READ', 'WRITE', 'JMP', 'EXEC', 'WARN', 'SYS', 'NET', 'MEM'];
      const action = actions[Math.floor(Math.random() * actions.length)].padEnd(5, ' ');
      const val = Math.random().toString(36).substring(2, 8).toUpperCase().padEnd(6, ' ');
      return `0x${hex} : ${action} : ${val}`;
    };

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settingsRef.current;
      frameCount++;

      analyser.getByteFrequencyData(dataArray);
      analyser.getByteTimeDomainData(timeDataArray);

      const bass = dataArray.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
      const mid = dataArray.slice(20, 60).reduce((a, b) => a + b, 0) / 40;

      // Colors (Default to bright CRT green)
      const hue = (120 + currentSettings.hueShift) % 360;
      const baseColor = `hsl(${hue}, 100%, 50%)`;
      const dimColor = `hsl(${hue}, 100%, 25%)`;
      const bgColor = `hsl(${hue}, 50%, 4%)`;

      // Clear background
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);

      // Setup CRT Glow
      ctx.shadowBlur = 10 + (bass / 255) * 20 * currentSettings.sensitivity;
      ctx.shadowColor = baseColor;
      ctx.fillStyle = baseColor;
      ctx.strokeStyle = baseColor;

      // Layout Math
      const p = 30; // padding
      const leftPanelW = Math.min(450, w * 0.4);
      const rightPanelW = w - leftPanelW - 3 * p;
      const rightPanelH = (h - 3 * p) / 2;

      const lpX = p;
      const lpY = p;
      const lpH = h - 2 * p;

      const rtX = lpX + leftPanelW + p;
      const rtY = p;
      const rtH = rightPanelH;

      const rbX = rtX;
      const rbY = rtY + rtH + p;
      const rbH = rightPanelH;

      // Helper to draw terminal panels
      const drawPanel = (x: number, y: number, width: number, height: number, title: string) => {
        ctx.setLineDash([8, 4]);
        ctx.strokeStyle = dimColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
        ctx.setLineDash([]);

        ctx.font = '14px monospace';
        const textWidth = ctx.measureText(` [ ${title} ] `).width;
        ctx.fillStyle = bgColor;
        ctx.fillRect(x + 20, y - 10, textWidth, 20);

        ctx.fillStyle = baseColor;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(` [ ${title} ] `, x + 20, y);
      };

      // 1a. Draw Top Left Panel (Scrolling Data Feed)
      const feedH = Math.max(100, lpH * 0.3);
      drawPanel(lpX, lpY, leftPanelW, feedH, 'DATA_FEED');

      // Update data feed based on sound
      const volume = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
      // Scroll speed based on volume and sensitivity
      const scrollThreshold = 0.8 - (volume / 255) * currentSettings.sensitivity * 0.5;
      if (Math.random() > scrollThreshold) {
        dataFeed.push(generateLogLine());
      }

      const maxFeedLines = Math.floor((feedH - 40) / 16);
      while (dataFeed.length > maxFeedLines) {
        dataFeed.shift();
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(lpX + 2, lpY + 2, leftPanelW - 4, feedH - 4);
      ctx.clip();

      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.shadowBlur = 0;

      for (let i = 0; i < dataFeed.length; i++) {
        // Fade out older lines
        const opacity = 0.3 + (i / dataFeed.length) * 0.7;
        ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${opacity})`;
        ctx.fillText(dataFeed[i], lpX + 20, lpY + 25 + i * 16);
      }
      ctx.restore();

      // 1b. Draw Bottom Left Panel (Vertical Frequency Spectrum)
      const specY = lpY + feedH + p;
      const specH = lpH - feedH - p;

      if (specH > 50) {
        drawPanel(lpX, specY, leftPanelW, specH, 'SPECTRUM_ANALYSIS');

        const CW = 14;
        const LH = 18;
        const startX = lpX + 30;
        const startY = specY + 40;
        const specInnerW = leftPanelW - 60;
        const specInnerH = specH - 60;
        const numBands = Math.floor(specInnerW / CW);
        const specRows = Math.floor(specInnerH / LH);

        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (numBands > 0 && specRows > 0) {
          for (let b = 0; b < numBands; b++) {
            const fi = Math.floor(b * (bufferLength * 0.6) / numBands);
            const val = Math.min(1, (dataArray[fi] / 255) * currentSettings.sensitivity);
            const filled = Math.round(val * (specRows - 1));

            for (let row = 0; row < specRows; row++) {
              const fromBottom = specRows - 1 - row;
              const y = startY + row * LH;
              const x = startX + b * CW;

              if (fromBottom < filled) {
                const intensity = fromBottom / (specRows - 1);
                // Shift hue slightly towards yellow for higher intensities, and increase lightness
                const h = hue + (intensity * 30);
                const l = 30 + intensity * 40;
                ctx.fillStyle = `hsl(${h}, 100%, ${l}%)`;
                ctx.shadowBlur = 2 + intensity * 10;
                ctx.fillText(intensity > 0.65 ? '#' : intensity > 0.35 ? '|' : '-', x, y);
              } else {
                ctx.fillStyle = `hsla(${hue}, 100%, 15%, 0.35)`;
                ctx.shadowBlur = 0;
                ctx.fillText(':', x, y);
              }
            }
          }
        }
      }

      // Restore shadow and fill style for the rest of the drawing
      ctx.shadowColor = baseColor;
      ctx.shadowBlur = 10 + (bass / 255) * 20 * currentSettings.sensitivity;
      ctx.fillStyle = baseColor;

      // 2. Draw Top Right Panel (Waveform)
      drawPanel(rtX, rtY, rightPanelW, rtH, 'WAVEFORM_DATA');

      ctx.save();
      ctx.beginPath();
      // Clip to panel bounds (with a small margin for the border)
      ctx.rect(rtX + 2, rtY + 2, rightPanelW - 4, rtH - 4);
      ctx.clip();

      ctx.beginPath();
      const sliceWidth = rightPanelW / bufferLength;
      let xPos = rtX;

      const waveformMultiplier = 4.0; // Amplify the waveform to make it less flat

      for (let i = 0; i < bufferLength; i++) {
        const v = timeDataArray[i] / 128.0;
        const yPos = rtY + rtH / 2 + (v - 1) * (rtH / 2) * currentSettings.sensitivity * waveformMultiplier;

        if (i === 0) ctx.moveTo(xPos, yPos);
        else ctx.lineTo(xPos, yPos);

        xPos += sliceWidth;
      }

      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Add blocky points to waveform for retro feel
      ctx.fillStyle = baseColor;
      for (let i = 0; i < bufferLength; i += 16) {
        const v = timeDataArray[i] / 128.0;
        const yPos = rtY + rtH / 2 + (v - 1) * (rtH / 2) * currentSettings.sensitivity * waveformMultiplier;
        ctx.fillRect(rtX + i * sliceWidth - 2, yPos - 2, 4, 4);
      }

      ctx.restore();

      // 3. Draw Bottom Right Panel (Frequencies)
      drawPanel(rbX, rbY, rightPanelW, rbH, 'FREQ_ANALYSIS');

      const numBars = 40;
      const barW = rightPanelW / numBars;
      const maxBlocks = Math.floor((rbH - 40) / 12); // 12px per block height

      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = '10px monospace';

      for (let i = 0; i < numBars; i++) {
        // Map to lower frequencies mostly
        const freqIndex = Math.floor(i * (bufferLength / 3) / numBars);
        const freq = dataArray[freqIndex];
        const blocks = Math.floor((freq / 255) * maxBlocks * currentSettings.sensitivity);

        const bx = rbX + i * barW + barW / 2;

        for (let b = 0; b < blocks; b++) {
          const by = rbY + rbH - 20 - b * 12;
          ctx.fillText('█', bx, by);
        }

        // Peak indicator
        if (blocks > 0) {
          ctx.fillText('-', bx, rbY + rbH - 20 - blocks * 12);
        }
      }

      // Blinking cursor
      if (frameCount % 60 < 30) {
        ctx.fillText('_', rbX + 20, rbY + rbH - 20);
      }

      // 4. CRT Effects Overlay
      ctx.shadowBlur = 0; // Turn off glow for overlays

      // Scanlines
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      for (let y = 0; y < h; y += 4) {
        ctx.fillRect(0, y, w, 2);
      }

      // Vignette
      const grad = ctx.createRadialGradient(w/2, h/2, h*0.4, w/2, h/2, w*0.8);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Screen Flicker
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.random() * 0.03})`;
      ctx.fillRect(0, 0, w, h);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
    };
  }, [stream]);

  return (
    <div ref={containerRef} className="w-full h-full bg-black overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
