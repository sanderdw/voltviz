import { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function AudioDebug({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
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

    // Main analyser for display (smooth for visuals)
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.7;
    analyserRef.current = analyser;

    // Separate analyser for kick detection (minimal smoothing for transient response)
    const kickAnalyser = audioCtx.createAnalyser();
    kickAnalyser.fftSize = 1024;
    kickAnalyser.smoothingTimeConstant = 0.2;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    source.connect(kickAnalyser);
    sourceRef.current = source;

    // Stereo channel splitting for phase/correlation panel
    const splitter = audioCtx.createChannelSplitter(2);
    source.connect(splitter);
    const analyserL = audioCtx.createAnalyser();
    analyserL.fftSize = 2048;
    analyserL.smoothingTimeConstant = 0;
    const analyserR = audioCtx.createAnalyser();
    analyserR.fftSize = 2048;
    analyserR.smoothingTimeConstant = 0;
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);
    const stereoN = analyserL.fftSize;
    const bufL = new Float32Array(stereoN);
    const bufR = new Float32Array(stereoN);

    const bufferLength = analyser.frequencyBinCount;
    const freqData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(analyser.fftSize);

    const kickBufferLength = kickAnalyser.frequencyBinCount;
    const kickFreqData = new Uint8Array(kickBufferLength);
    const prevKickFreqData = new Float32Array(kickBufferLength);

    let kickHistory: number[] = [];
    let lastKickTime = 0;
    let kickCount = 0;
    let kickTimestamps: number[] = [];
    let fluxHistory: number[] = [];
    const KICK_COOLDOWN = 120;
    const HISTORY_SIZE = 90;
    const FLUX_HISTORY_SIZE = 60;

    // Spectrogram state
    let spectrogramImageData: ImageData | null = null;
    let spectrogramW = 0;
    let spectrogramH = 0;

    // Stereo correlation state
    let smoothedCorrelation = 0;

    const resize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };
    window.addEventListener('resize', resize);
    resize();

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const s = settingsRef.current;
      const now = performance.now();

      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);

      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, w, h);

      const sampleRate = audioCtx.sampleRate;
      const binHz = sampleRate / analyser.fftSize;

      // Frequency band boundaries (in bins)
      const subBassEnd = Math.min(Math.floor(60 / binHz), bufferLength);
      const bassEnd = Math.min(Math.floor(250 / binHz), bufferLength);
      const midEnd = Math.min(Math.floor(2000 / binHz), bufferLength);
      const highMidEnd = Math.min(Math.floor(6000 / binHz), bufferLength);

      // Compute band energies
      const bandEnergy = (start: number, end: number) => {
        let sum = 0;
        for (let i = start; i < end; i++) sum += freqData[i];
        return end > start ? (sum / (end - start)) / 255 : 0;
      };

      const subBass = bandEnergy(0, subBassEnd) * s.sensitivity;
      const bass = bandEnergy(subBassEnd, bassEnd) * s.sensitivity;
      const mid = bandEnergy(bassEnd, midEnd) * s.sensitivity;
      const highMid = bandEnergy(midEnd, highMidEnd) * s.sensitivity;
      const high = bandEnergy(highMidEnd, bufferLength) * s.sensitivity;

      // RMS & Peak
      let rmsSum = 0;
      let peak = 0;
      for (let i = 0; i < timeData.length; i++) {
        const v = (timeData[i] - 128) / 128;
        rmsSum += v * v;
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      const rms = Math.sqrt(rmsSum / timeData.length) * s.sensitivity;
      peak *= s.sensitivity;

      // Kick detection using spectral flux in bass range
      kickAnalyser.getByteFrequencyData(kickFreqData);
      const kickSampleRate = audioCtx.sampleRate;
      const kickBinHz = kickSampleRate / kickAnalyser.fftSize;
      const kickBassEnd = Math.min(Math.floor(150 / kickBinHz), kickBufferLength);

      // Spectral flux: sum of positive differences in bass bins (onset = energy appearing)
      let flux = 0;
      for (let i = 1; i < kickBassEnd; i++) {
        const diff = kickFreqData[i] - prevKickFreqData[i];
        if (diff > 0) flux += diff;
      }
      flux /= kickBassEnd * 255;

      // Store current frame for next comparison
      for (let i = 0; i < kickBufferLength; i++) {
        prevKickFreqData[i] = kickFreqData[i];
      }

      fluxHistory.push(flux);
      if (fluxHistory.length > FLUX_HISTORY_SIZE) fluxHistory.shift();

      // Adaptive threshold: median + factor * deviation
      const sortedFlux = [...fluxHistory].sort((a, b) => a - b);
      const medianFlux = sortedFlux[Math.floor(sortedFlux.length / 2)] || 0;
      const meanFlux = fluxHistory.reduce((a, b) => a + b, 0) / fluxHistory.length;
      const stdFlux = Math.sqrt(fluxHistory.reduce((a, b) => a + (b - meanFlux) ** 2, 0) / fluxHistory.length);
      const kickThreshold = medianFlux + stdFlux * 1.2 + 0.02;

      const isKick = flux > kickThreshold && (now - lastKickTime) > KICK_COOLDOWN;

      if (isKick) {
        lastKickTime = now;
        kickCount++;
        kickTimestamps.push(now);
        // Keep last 30 seconds of timestamps
        while (kickTimestamps.length > 0 && now - kickTimestamps[0] > 30000) {
          kickTimestamps.shift();
        }
      }

      kickHistory.push(isKick ? 1 : 0);
      if (kickHistory.length > HISTORY_SIZE) kickHistory.shift();

      // BPM estimation from kick intervals
      let bpmEstimate = 0;
      if (kickTimestamps.length >= 4) {
        const intervals: number[] = [];
        for (let i = 1; i < kickTimestamps.length; i++) {
          intervals.push(kickTimestamps[i] - kickTimestamps[i - 1]);
        }
        // Filter out outliers (keep intervals between 300ms and 1000ms = 60-200 BPM range)
        const validIntervals = intervals.filter(v => v >= 300 && v <= 1000);
        if (validIntervals.length >= 3) {
          const avgInterval = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
          bpmEstimate = Math.round(60000 / avgInterval);
        }
      }

      const kickBassEnergy = flux;
      const avgBassEnergy = meanFlux;

      const kickFlash = Math.max(0, 1 - (now - lastKickTime) / 200);

      // Layout
      const margin = 16;
      const panelW = (w - margin * 3) / 2;
      const panelH = (h - margin * 5) / 4;

      // Panel backgrounds
      const drawPanel = (x: number, y: number, pw: number, ph: number, title: string, flash = false) => {
        ctx.fillStyle = flash ? `rgba(255, 50, 50, ${0.1 + kickFlash * 0.15})` : 'rgba(20, 20, 30, 0.8)';
        ctx.fillRect(x, y, pw, ph);
        ctx.strokeStyle = flash ? `rgba(255, 80, 80, ${0.4 + kickFlash * 0.6})` : 'rgba(80, 80, 120, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, pw, ph);
        ctx.fillStyle = flash ? '#ff6666' : '#888899';
        ctx.font = '11px monospace';
        ctx.fillText(title, x + 8, y + 14);
      };

      // 1. Frequency Spectrum (top-left)
      drawPanel(margin, margin, panelW, panelH, 'FREQUENCY SPECTRUM');
      const specX = margin + 8;
      const specY = margin + 24;
      const specW = panelW - 16;
      const specH = panelH - 32;

      const barCount = Math.min(bufferLength, Math.floor(specW / 3));
      const barW = specW / barCount;
      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor((i / barCount) * bufferLength);
        const val = Math.min(1, (freqData[idx] / 255) * s.sensitivity);
        const barH = val * specH;
        const freq = idx * binHz;

        let hue: number;
        if (freq < 60) hue = 0;
        else if (freq < 250) hue = 30;
        else if (freq < 2000) hue = 120;
        else if (freq < 6000) hue = 200;
        else hue = 280;

        hue = (hue + s.hueShift) % 360;
        ctx.fillStyle = `hsla(${hue}, 80%, ${40 + val * 30}%, ${0.6 + val * 0.4})`;
        ctx.fillRect(specX + i * barW, specY + specH - barH, barW - 1, barH);
      }

      // Frequency labels
      ctx.fillStyle = '#555566';
      ctx.font = '9px monospace';
      const freqLabels = [60, 250, 2000, 6000, 16000];
      for (const freq of freqLabels) {
        const bin = Math.floor(freq / binHz);
        const xPos = specX + (bin / bufferLength) * specW;
        if (xPos < specX + specW) {
          ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : `${freq}`, xPos, specY + specH + 10);
        }
      }

      // 2. Waveform (top-right)
      drawPanel(margin * 2 + panelW, margin, panelW, panelH, 'WAVEFORM');
      const waveX = margin * 2 + panelW + 8;
      const waveY = margin + 24;
      const waveW = panelW - 16;
      const waveH = panelH - 32;

      ctx.strokeStyle = `hsla(${(180 + s.hueShift) % 360}, 80%, 60%, 0.8)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const sliceWidth = waveW / timeData.length;
      for (let i = 0; i < timeData.length; i++) {
        const v = (timeData[i] - 128) / 128;
        const y = waveY + waveH / 2 - v * (waveH / 2) * s.sensitivity;
        if (i === 0) ctx.moveTo(waveX, y);
        else ctx.lineTo(waveX + i * sliceWidth, y);
      }
      ctx.stroke();

      // Zero line
      ctx.strokeStyle = 'rgba(80, 80, 120, 0.3)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(waveX, waveY + waveH / 2);
      ctx.lineTo(waveX + waveW, waveY + waveH / 2);
      ctx.stroke();

      // 3. Kick Detection (middle-left)
      drawPanel(margin, margin * 2 + panelH, panelW, panelH, 'KICK DETECTION', true);
      const kickX = margin + 8;
      const kickY = margin * 2 + panelH + 24;
      const kickW = panelW - 16;
      const kickH = panelH - 32;

      // Kick indicator circle
      const circleR = Math.min(kickH * 0.3, 40);
      const circleX = kickX + circleR + 10;
      const circleY = kickY + kickH / 2;

      ctx.beginPath();
      ctx.arc(circleX, circleY, circleR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 50, 50, ${kickFlash * 0.9})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 80, 80, ${0.3 + kickFlash * 0.7})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      if (kickFlash > 0.5) {
        ctx.beginPath();
        ctx.arc(circleX, circleY, circleR + 8, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 50, 50, ${kickFlash * 0.4})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.fillStyle = kickFlash > 0.5 ? '#ffffff' : '#ff6666';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('KICK', circleX, circleY + 5);
      ctx.textAlign = 'left';

      // Kick history graph
      const histX = kickX + circleR * 2 + 40;
      const histW = kickW - circleR * 2 - 50;
      const histH = kickH * 0.5;
      const histY = kickY + kickH / 2 - histH / 2;

      ctx.strokeStyle = 'rgba(80, 80, 120, 0.3)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(histX, histY, histW, histH);

      // Draw spectral flux history
      const maxFlux = Math.max(...fluxHistory, 0.01);
      ctx.strokeStyle = `hsla(${(20 + s.hueShift) % 360}, 80%, 50%, 0.6)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < fluxHistory.length; i++) {
        const x = histX + (i / FLUX_HISTORY_SIZE) * histW;
        const y = histY + histH - (fluxHistory[i] / maxFlux) * histH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Draw threshold line
      ctx.strokeStyle = 'rgba(255, 80, 80, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      const threshY = histY + histH - (kickThreshold / maxFlux) * histH;
      ctx.beginPath();
      ctx.moveTo(histX, threshY);
      ctx.lineTo(histX + histW, threshY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Kick markers
      for (let i = 0; i < kickHistory.length; i++) {
        if (kickHistory[i]) {
          const x = histX + (i / HISTORY_SIZE) * histW;
          ctx.fillStyle = 'rgba(255, 50, 50, 0.7)';
          ctx.fillRect(x - 1, histY, 2, histH);
        }
      }

      // Stats
      ctx.fillStyle = '#aaaacc';
      ctx.font = '11px monospace';
      const statsX = histX;
      ctx.fillText(`Kicks: ${kickCount}`, statsX, histY + histH + 16);
      ctx.fillText(`BPM: ~${bpmEstimate}`, statsX + 100, histY + histH + 16);
      ctx.fillText(`Threshold: ${kickThreshold.toFixed(3)}`, statsX + 200, histY + histH + 16);

      // 4. Band Energy (middle-right)
      drawPanel(margin * 2 + panelW, margin * 2 + panelH, panelW, panelH, 'FREQUENCY BANDS');
      const bandX = margin * 2 + panelW + 8;
      const bandY = margin * 2 + panelH + 24;
      const bandW = panelW - 16;
      const bandH = panelH - 32;

      const bands = [
        { label: 'Sub Bass (20-60Hz)', value: subBass, hue: 0 },
        { label: 'Bass (60-250Hz)', value: bass, hue: 30 },
        { label: 'Mid (250-2kHz)', value: mid, hue: 120 },
        { label: 'High Mid (2k-6kHz)', value: highMid, hue: 200 },
        { label: 'High (6k+)', value: high, hue: 280 },
      ];

      const barGap = 8;
      const bandBarH = (bandH - barGap * (bands.length - 1)) / bands.length;
      for (let i = 0; i < bands.length; i++) {
        const by = bandY + i * (bandBarH + barGap);
        const val = Math.min(1, bands[i].value);
        const hue = (bands[i].hue + s.hueShift) % 360;

        // Background
        ctx.fillStyle = 'rgba(40, 40, 60, 0.5)';
        ctx.fillRect(bandX + 140, by, bandW - 140, bandBarH);

        // Bar
        ctx.fillStyle = `hsla(${hue}, 70%, 50%, ${0.5 + val * 0.5})`;
        ctx.fillRect(bandX + 140, by, (bandW - 140) * val, bandBarH);

        // Label
        ctx.fillStyle = '#888899';
        ctx.font = '10px monospace';
        ctx.fillText(bands[i].label, bandX, by + bandBarH / 2 + 4);

        // Value
        ctx.fillStyle = '#aaaacc';
        ctx.fillText(`${(val * 100).toFixed(0)}%`, bandX + bandW - 30, by + bandBarH / 2 + 4);
      }

      // 5. Metrics Panel (bottom-left)
      drawPanel(margin, margin * 3 + panelH * 2, panelW, panelH, 'AUDIO METRICS');
      const metX = margin + 8;
      const metY = margin * 3 + panelH * 2 + 28;

      ctx.font = '12px monospace';
      const metrics = [
        { label: 'RMS Level', value: `${(rms * 100).toFixed(1)}%`, bar: rms },
        { label: 'Peak Level', value: `${(peak * 100).toFixed(1)}%`, bar: peak },
        { label: 'Sample Rate', value: `${sampleRate} Hz`, bar: -1 },
        { label: 'FFT Size', value: `${analyser.fftSize}`, bar: -1 },
        { label: 'Freq Bins', value: `${bufferLength}`, bar: -1 },
        { label: 'Bin Width', value: `${binHz.toFixed(1)} Hz`, bar: -1 },
        { label: 'Sensitivity', value: `${s.sensitivity.toFixed(1)}x`, bar: -1 },
      ];

      for (let i = 0; i < metrics.length; i++) {
        const my = metY + i * 22;
        ctx.fillStyle = '#777788';
        ctx.fillText(metrics[i].label, metX, my);
        ctx.fillStyle = '#ccccdd';
        ctx.fillText(metrics[i].value, metX + 130, my);

        if (metrics[i].bar >= 0) {
          const mbarX = metX + 220;
          const mbarW = panelW - 250;
          const mbarH = 10;
          ctx.fillStyle = 'rgba(40, 40, 60, 0.5)';
          ctx.fillRect(mbarX, my - 9, mbarW, mbarH);
          const val = Math.min(1, metrics[i].bar);
          const hue = val > 0.8 ? 0 : val > 0.5 ? 40 : 120;
          ctx.fillStyle = `hsla(${(hue + s.hueShift) % 360}, 70%, 50%, 0.8)`;
          ctx.fillRect(mbarX, my - 9, mbarW * val, mbarH);
        }
      }

      // 6. Kick Timeline (bottom-right)
      drawPanel(margin * 2 + panelW, margin * 3 + panelH * 2, panelW, panelH, 'ENERGY OVER TIME');
      const tlX = margin * 2 + panelW + 8;
      const tlY = margin * 3 + panelH * 2 + 28;
      const tlW = panelW - 16;
      const tlH = panelH - 40;

      // Draw dynamic energy graph (multiple bands stacked)
      const drawEnergyLine = (values: number[], hue: number, label: string, yOffset: number, lineH: number) => {
        ctx.strokeStyle = `hsla(${(hue + s.hueShift) % 360}, 70%, 60%, 0.7)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const segW = tlW / values.length;
        for (let i = 0; i < values.length; i++) {
          const x = tlX + i * segW;
          const y = yOffset + lineH - Math.min(1, values[i]) * lineH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = `hsla(${(hue + s.hueShift) % 360}, 70%, 60%, 0.6)`;
        ctx.font = '9px monospace';
        ctx.fillText(label, tlX + 2, yOffset + 10);
      };

      // Use fluxHistory for the energy graph
      drawEnergyLine(fluxHistory, 20, 'SPECTRAL FLUX (BASS)', tlY, tlH * 0.45);

      // Current value indicators
      ctx.fillStyle = '#666677';
      ctx.font = '10px monospace';
      ctx.fillText(`Flux: ${kickBassEnergy.toFixed(4)}`, tlX + tlW - 140, tlY + 12);
      ctx.fillText(`Mean: ${avgBassEnergy.toFixed(4)}`, tlX + tlW - 140, tlY + 24);

      // Overall energy meter at bottom
      const meterY = tlY + tlH * 0.55;
      const meterH = tlH * 0.4;
      ctx.fillStyle = 'rgba(40, 40, 60, 0.3)';
      ctx.fillRect(tlX, meterY, tlW, meterH);

      // Segmented meter
      const segments = 40;
      const segGap = 2;
      const segW2 = (tlW - segGap * (segments - 1)) / segments;
      const overallEnergy = Math.min(1, rms * 2);
      const litSegments = Math.floor(overallEnergy * segments);

      for (let i = 0; i < segments; i++) {
        const sx = tlX + i * (segW2 + segGap);
        const lit = i < litSegments;
        let hue: number;
        if (i < segments * 0.6) hue = 120;
        else if (i < segments * 0.8) hue = 60;
        else hue = 0;
        hue = (hue + s.hueShift) % 360;
        ctx.fillStyle = lit ? `hsla(${hue}, 80%, 50%, 0.9)` : 'rgba(40, 40, 60, 0.4)';
        ctx.fillRect(sx, meterY + 4, segW2, meterH - 8);
      }

      ctx.fillStyle = '#777788';
      ctx.font = '9px monospace';
      ctx.fillText('OVERALL LEVEL', tlX, meterY + meterH + 12);
      ctx.fillText(`${(overallEnergy * 100).toFixed(0)}%`, tlX + tlW - 30, meterY + meterH + 12);

      // 7. Spectrogram (bottom-left)
      drawPanel(margin, margin * 4 + panelH * 3, panelW, panelH, 'SPECTROGRAM');
      const sgX = margin + 8;
      const sgY = margin * 4 + panelH * 3 + 24;
      const sgW = Math.floor(panelW - 16);
      const sgH = Math.floor(panelH - 32);

      if (sgW > 0 && sgH > 0) {
        if (!spectrogramImageData || spectrogramW !== sgW || spectrogramH !== sgH) {
          spectrogramImageData = ctx.createImageData(sgW, sgH);
          spectrogramW = sgW;
          spectrogramH = sgH;
        }

        const data = spectrogramImageData.data;
        const rowBytes = sgW * 4;

        // Shift all pixels left by 1 column
        for (let row = 0; row < sgH; row++) {
          const rowStart = row * rowBytes;
          data.copyWithin(rowStart, rowStart + 4, rowStart + rowBytes);
        }

        // Write new column on the right edge (log-frequency mapping)
        const minFreq = 20;
        const maxFreq = sampleRate / 2;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);

        for (let py = 0; py < sgH; py++) {
          const t = 1 - py / (sgH - 1);
          const logFreq = logMin + t * (logMax - logMin);
          const freq = Math.pow(10, logFreq);
          const bin = Math.min(Math.round(freq / binHz), bufferLength - 1);
          const intensity = Math.min(1, (freqData[bin] / 255) * s.sensitivity);

          let r: number, g: number, b: number;
          if (intensity < 0.2) {
            const it = intensity / 0.2;
            r = Math.floor(it * 40); g = 0; b = Math.floor(it * 80);
          } else if (intensity < 0.45) {
            const it = (intensity - 0.2) / 0.25;
            r = Math.floor(40 + it * 215); g = 0; b = Math.floor(80 - it * 80);
          } else if (intensity < 0.7) {
            const it = (intensity - 0.45) / 0.25;
            r = 255; g = Math.floor(it * 255); b = 0;
          } else {
            const it = (intensity - 0.7) / 0.3;
            r = 255; g = 255; b = Math.floor(it * 255);
          }

          const idx = (py * sgW + (sgW - 1)) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 255;
        }

        ctx.putImageData(spectrogramImageData, sgX, sgY);

        // Frequency labels on left edge
        ctx.fillStyle = '#555566';
        ctx.font = '9px monospace';
        const sgFreqLabels = [100, 1000, 5000, 10000];
        for (const freq of sgFreqLabels) {
          const t2 = (Math.log10(freq) - logMin) / (logMax - logMin);
          const ly = sgY + sgH - t2 * sgH;
          if (ly > sgY && ly < sgY + sgH - 8) {
            ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : `${freq}`, sgX + 2, ly + 3);
          }
        }
      }

      // 8. Stereo Phase / Correlation (bottom-right)
      drawPanel(margin * 2 + panelW, margin * 4 + panelH * 3, panelW, panelH, 'STEREO PHASE / CORRELATION');
      const phX = margin * 2 + panelW + 8;
      const phY = margin * 4 + panelH * 3 + 24;
      const phW = panelW - 16;
      const phH = panelH - 32;

      if (phW > 0 && phH > 0) {
        analyserL.getFloatTimeDomainData(bufL);
        analyserR.getFloatTimeDomainData(bufR);

        // Mono detection + correlation calculation
        let sumLR = 0, sumL2 = 0, sumR2 = 0;
        let monoDetected = true;
        for (let i = 0; i < stereoN; i++) {
          sumLR += bufL[i] * bufR[i];
          sumL2 += bufL[i] * bufL[i];
          sumR2 += bufR[i] * bufR[i];
          if (Math.abs(bufR[i] - bufL[i]) > 1e-5) monoDetected = false;
        }
        const rmsR2 = Math.sqrt(sumR2 / stereoN);
        if (rmsR2 < 1e-5) monoDetected = true;

        const denom = Math.sqrt(sumL2 * sumR2);
        const correlation = denom > 1e-10 ? sumLR / denom : 0;
        smoothedCorrelation += (correlation - smoothedCorrelation) * 0.15;

        // Lissajous XY plot (left ~60%)
        const lissSize = Math.min(phW * 0.55, phH - 10);
        const lissCx = phX + lissSize / 2 + 5;
        const lissCy = phY + phH / 2;
        const lissR = lissSize / 2;

        // Crosshair guides
        ctx.strokeStyle = 'rgba(80, 80, 120, 0.3)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(lissCx - lissR, lissCy);
        ctx.lineTo(lissCx + lissR, lissCy);
        ctx.moveTo(lissCx, lissCy - lissR);
        ctx.lineTo(lissCx, lissCy + lissR);
        ctx.stroke();

        // Circular boundary
        ctx.beginPath();
        ctx.arc(lissCx, lissCy, lissR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(80, 80, 120, 0.2)';
        ctx.stroke();

        // Plot samples
        const step = Math.max(1, Math.floor(stereoN / 512));
        const lissHue = (180 + s.hueShift) % 360;
        ctx.fillStyle = `hsla(${lissHue}, 80%, 60%, 0.4)`;
        for (let i = 0; i < stereoN; i += step) {
          const lx = lissCx + bufL[i] * lissR * s.sensitivity;
          const ly = lissCy - bufR[i] * lissR * s.sensitivity;
          ctx.fillRect(lx - 0.5, ly - 0.5, 1.5, 1.5);
        }

        // Axis labels
        ctx.fillStyle = '#555566';
        ctx.font = '9px monospace';
        ctx.fillText('L', lissCx - lissR - 10, lissCy + 3);
        ctx.fillText('R', lissCx + lissR + 4, lissCy + 3);

        // Mono indicator
        if (monoDetected) {
          ctx.fillStyle = 'rgba(255, 200, 50, 0.8)';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('MONO', lissCx, lissCy + lissR + 14);
          ctx.textAlign = 'left';
        }

        // Correlation meter (right side)
        const meterX2 = phX + lissSize + 30;
        const meterW2 = 20;
        const meterTop = phY + 5;
        const meterBottom = phY + phH - 5;
        const meterH2 = meterBottom - meterTop;
        const meterMid = meterTop + meterH2 / 2;

        // Background
        ctx.fillStyle = 'rgba(40, 40, 60, 0.5)';
        ctx.fillRect(meterX2, meterTop, meterW2, meterH2);

        // Zone coloring
        ctx.fillStyle = 'rgba(50, 180, 50, 0.15)';
        ctx.fillRect(meterX2, meterTop, meterW2, meterH2 * 0.25);
        ctx.fillStyle = 'rgba(180, 180, 50, 0.10)';
        ctx.fillRect(meterX2, meterTop + meterH2 * 0.25, meterW2, meterH2 * 0.5);
        ctx.fillStyle = 'rgba(180, 50, 50, 0.15)';
        ctx.fillRect(meterX2, meterTop + meterH2 * 0.75, meterW2, meterH2 * 0.25);

        // Center line (0 mark)
        ctx.strokeStyle = 'rgba(80, 80, 120, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(meterX2, meterMid);
        ctx.lineTo(meterX2 + meterW2, meterMid);
        ctx.stroke();

        // Indicator
        const indicatorY = meterMid - smoothedCorrelation * (meterH2 / 2);
        const corrHue = smoothedCorrelation > 0.5 ? 120 : smoothedCorrelation > 0 ? 60 : 0;
        ctx.fillStyle = `hsla(${(corrHue + s.hueShift) % 360}, 80%, 50%, 0.9)`;
        ctx.fillRect(meterX2, Math.min(indicatorY, meterMid), meterW2, Math.abs(indicatorY - meterMid));

        // Indicator line
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(meterX2 - 2, indicatorY - 1, meterW2 + 4, 3);

        // Labels
        ctx.fillStyle = '#888899';
        ctx.font = '9px monospace';
        ctx.fillText('+1', meterX2 + meterW2 + 4, meterTop + 4);
        ctx.fillText(' 0', meterX2 + meterW2 + 4, meterMid + 3);
        ctx.fillText('-1', meterX2 + meterW2 + 4, meterBottom + 3);

        // Numeric readout
        ctx.fillStyle = '#aaaacc';
        ctx.font = '11px monospace';
        ctx.fillText(`r = ${smoothedCorrelation.toFixed(2)}`, meterX2 + meterW2 + 4, meterBottom + 18);
      }
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      splitter.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
    };
  }, [stream]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
