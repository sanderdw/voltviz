import React, { useRef, useEffect } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

export default function DataDashboard({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    analyserRef.current = audioContextRef.current.createAnalyser();
    analyserRef.current.fftSize = 256;
    analyserRef.current.smoothingTimeConstant = 0.8;

    sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
    sourceRef.current.connect(analyserRef.current);

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const timeDataArray = new Uint8Array(bufferLength);

    const resize = () => {
      canvas.width = canvas.clientWidth * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    window.addEventListener('resize', resize);
    resize();

    let time = 0;

    const draw = () => {
      if (!canvas || !ctx || !analyserRef.current) return;

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      analyserRef.current.getByteFrequencyData(dataArray);
      analyserRef.current.getByteTimeDomainData(timeDataArray);

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#0f0f1a';
      ctx.fillRect(0, 0, width, height);

      time += 0.01 * settings.speed;

      const padding = Math.min(width, height) * 0.05;
      const gap = padding;

      const colWidth = (width - padding * 2 - gap) / 2;
      const rowHeight = (height - padding * 2 - gap * 2) / 3;

      ctx.save();
      ctx.translate(padding, padding);

      // 1. Top Left: Equalizer
      drawEqualizer(ctx, colWidth, rowHeight, dataArray, settings);

      // 2. Top Right: Circular Progress
      ctx.save();
      ctx.translate(colWidth + gap, 0);
      drawCircularProgress(ctx, colWidth, rowHeight, dataArray, settings);
      ctx.restore();

      // 3. Middle Left: Sine Waves
      ctx.save();
      ctx.translate(0, rowHeight + gap);
      drawSineWaves(ctx, colWidth, rowHeight, dataArray, time, settings);
      ctx.restore();

      // 4. Middle Right: Horizontal Bars
      ctx.save();
      ctx.translate(colWidth + gap, rowHeight + gap);
      drawHorizontalBars(ctx, colWidth, rowHeight, dataArray, settings);
      ctx.restore();

      // 5. Bottom Left: Area Chart
      ctx.save();
      ctx.translate(0, (rowHeight + gap) * 2);
      drawAreaChart(ctx, colWidth, rowHeight, dataArray, time, settings);
      ctx.restore();

      // 6. Bottom Right: Vertical Bars
      ctx.save();
      ctx.translate(colWidth + gap, (rowHeight + gap) * 2);
      drawVerticalBars(ctx, colWidth, rowHeight, dataArray, settings);
      ctx.restore();

      ctx.restore();

      requestRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (analyserRef.current) analyserRef.current.disconnect();
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, [stream, settings]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ background: '#0f0f1a' }}
    />
  );
}

function drawEqualizer(ctx: CanvasRenderingContext2D, width: number, height: number, dataArray: Uint8Array, settings: VisualizerSettings) {
  const barCount = 30;
  const barWidth = width / barCount - 2;

  for (let i = 0; i < barCount; i++) {
    const value = dataArray[i] / 255.0;
    const barHeight = value * height * 0.7 * settings.sensitivity;

    const gradient = ctx.createLinearGradient(0, height * 0.8, 0, 0);
    gradient.addColorStop(0, `hsl(${(150 + settings.hueShift) % 360}, 100%, 50%)`);
    gradient.addColorStop(1, `hsl(${(280 + settings.hueShift) % 360}, 100%, 50%)`);

    ctx.fillStyle = gradient;

    const segments = 15;
    const segmentHeight = height * 0.7 / segments;
    const activeSegments = Math.floor((barHeight / (height * 0.7)) * segments);

    for (let j = 0; j < segments; j++) {
      if (j < activeSegments) {
        ctx.fillRect(i * (barWidth + 2), height * 0.8 - (j + 1) * segmentHeight, barWidth, segmentHeight - 2);
      }
    }
  }

  ctx.fillStyle = '#ffffff';
  const ctrlY = height * 0.9;

  // Play controls
  ctx.fillRect(width / 2 - 20, ctrlY, 4, 12);
  ctx.fillRect(width / 2 - 12, ctrlY, 4, 12);

  ctx.beginPath();
  ctx.moveTo(width / 2 + 10, ctrlY);
  ctx.lineTo(width / 2 + 10, ctrlY + 12);
  ctx.lineTo(width / 2 + 20, ctrlY + 6);
  ctx.fill();

  // Progress bar
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, height * 0.85, width, 2);
}

function drawCircularProgress(ctx: CanvasRenderingContext2D, width: number, height: number, dataArray: Uint8Array, settings: VisualizerSettings) {
  const centerX1 = width * 0.25;
  const centerY1 = height * 0.25;
  const centerX2 = width * 0.75;
  const centerY2 = height * 0.25;
  const centerX3 = width * 0.25;
  const centerY3 = height * 0.75;
  const centerX4 = width * 0.75;
  const centerY4 = height * 0.75;

  const radius = Math.min(width, height) * 0.15;

  const drawRing = (x: number, y: number, value: number, hueStart: number, hueEnd: number, text: string, dataOffset: number) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 6;
    ctx.stroke();

    const gradient = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    gradient.addColorStop(0, `hsl(${(hueStart + settings.hueShift) % 360}, 100%, 50%)`);
    gradient.addColorStop(1, `hsl(${(hueEnd + settings.hueShift) % 360}, 100%, 50%)`);

    ctx.beginPath();
    ctx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * value));
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.stroke();

    const ticks = 30;
    for (let i = 0; i < ticks; i++) {
      const angle = (i / ticks) * Math.PI * 2 - Math.PI / 2;
      const tickValue = i / ticks;
      const innerRadius = radius + 8;
      const audioVal = (dataArray[(i * 2 + dataOffset) % dataArray.length] / 255) * 15 * settings.sensitivity;
      const outerRadius = radius + 12 + (tickValue < value ? audioVal : 0);

      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * innerRadius, y + Math.sin(angle) * innerRadius);
      ctx.lineTo(x + Math.cos(angle) * outerRadius, y + Math.sin(angle) * outerRadius);
      ctx.strokeStyle = tickValue < value ? gradient : '#1a1a2e';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  };

  const v1 = Math.min(1, (dataArray[10] / 255) * settings.sensitivity * 0.5 + 0.25);
  const v2 = Math.min(1, (dataArray[30] / 255) * settings.sensitivity * 0.5 + 0.50);
  const v3 = Math.min(1, (dataArray[50] / 255) * settings.sensitivity * 0.5 + 0.75);
  const v4 = Math.min(1, (dataArray[70] / 255) * settings.sensitivity * 0.5 + 0.90);

  drawRing(centerX1, centerY1, v1, 150, 180, '25%', 0);
  drawRing(centerX2, centerY2, v2, 180, 210, '50%', 20);
  drawRing(centerX3, centerY3, v3, 260, 290, '75%', 40);
  drawRing(centerX4, centerY4, v4, 290, 320, '100%', 60);
}

function drawSineWaves(ctx: CanvasRenderingContext2D, width: number, height: number, dataArray: Uint8Array, time: number, settings: VisualizerSettings) {
  const centerY = height / 2;

  // Calculate average bass and treble for amplitude
  let bassSum = 0;
  for (let i = 0; i < 10; i++) bassSum += dataArray[i];
  const bassAvg = bassSum / 10 / 255;

  let trebleSum = 0;
  for (let i = 50; i < 60; i++) trebleSum += dataArray[i];
  const trebleAvg = trebleSum / 10 / 255;

  const amp1 = height * 0.15 + (bassAvg * height * 0.3 * settings.sensitivity);
  const amp2 = height * 0.15 + (trebleAvg * height * 0.3 * settings.sensitivity);

  ctx.strokeStyle = '#2a2a4a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i < width; i++) {
    const y = centerY + Math.sin(i * 0.02 + time * 2) * amp1;
    if (i === 0) ctx.moveTo(i, y);
    else ctx.lineTo(i, y);
  }
  ctx.strokeStyle = `hsl(${(150 + settings.hueShift) % 360}, 100%, 50%)`;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i < width; i++) {
    const y = centerY + Math.cos(i * 0.03 - time * 3) * amp2;
    if (i === 0) ctx.moveTo(i, y);
    else ctx.lineTo(i, y);
  }
  ctx.strokeStyle = `hsl(${(280 + settings.hueShift) % 360}, 100%, 50%)`;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#8888aa';
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';
  for (let i = 100; i <= 200; i += 10) {
    const x = ((i - 100) / 100) * width;
    ctx.fillText(i.toString(), x, height - 5);
    ctx.fillRect(x, height - 20, 1, 5);
  }
}

function drawHorizontalBars(ctx: CanvasRenderingContext2D, width: number, height: number, dataArray: Uint8Array, settings: VisualizerSettings) {
  const barCount = 4;
  const barHeight = 12;
  const spacing = (height - barCount * barHeight) / (barCount + 1);
  const labels = ['SUB BASS', 'MID RANGE', 'HIGH TREBLE', 'MASTER VOL'];

  for (let i = 0; i < barCount; i++) {
    const y = spacing + i * (barHeight + spacing);
    const value = Math.min(1, (dataArray[i * 10] / 255) * settings.sensitivity + 0.3 + i * 0.1);

    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.roundRect(0, y, width, barHeight, barHeight / 2);
    ctx.fill();

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, `hsl(${(280 - i * 30 + settings.hueShift) % 360}, 100%, 50%)`);
    gradient.addColorStop(1, `hsl(${(150 + i * 20 + settings.hueShift) % 360}, 100%, 50%)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(0, y, width * value, barHeight, barHeight / 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '9px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[i], 10, y + barHeight / 2);
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, height - 5, width, 1);
}

function drawAreaChart(ctx: CanvasRenderingContext2D, width: number, height: number, dataArray: Uint8Array, time: number, settings: VisualizerSettings) {
  const points = 4;
  const spacing = width / (points + 1);

  const values = [];
  for (let i = 0; i < points; i++) {
    values.push(Math.min(1, (dataArray[i * 15] / 255) * settings.sensitivity + 0.2 + Math.sin(time + i) * 0.1));
  }

  ctx.beginPath();
  ctx.moveTo(0, height);

  ctx.lineTo(0, height - values[0] * height * 0.5);

  for (let i = 0; i < points; i++) {
    const x = spacing * (i + 1);
    const y = height - values[i] * height * 0.7;

    const prevX = i === 0 ? 0 : spacing * i;
    const prevY = i === 0 ? height - values[0] * height * 0.5 : height - values[i-1] * height * 0.7;

    const cp1x = prevX + (x - prevX) / 2;
    const cp1y = prevY;
    const cp2x = prevX + (x - prevX) / 2;
    const cp2y = y;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
  }

  const lastX = spacing * points;
  const lastY = height - values[points-1] * height * 0.7;
  ctx.bezierCurveTo(lastX + (width - lastX) / 2, lastY, lastX + (width - lastX) / 2, height, width, height);

  ctx.lineTo(width, height);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, `hsla(${(280 + settings.hueShift) % 360}, 100%, 60%, 0.8)`);
  gradient.addColorStop(1, `hsla(${(200 + settings.hueShift) % 360}, 100%, 50%, 0.1)`);

  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.strokeStyle = `hsl(${(150 + settings.hueShift) % 360}, 100%, 50%)`;
  ctx.lineWidth = 2;
  ctx.stroke();

  for (let i = 0; i < points; i++) {
    const x = spacing * (i + 1);
    const y = height - values[i] * height * 0.7;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, height);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#8888aa';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(values[i] * 100)}%`, x, y - 15);
  }
}

function drawVerticalBars(ctx: CanvasRenderingContext2D, width: number, height: number, dataArray: Uint8Array, settings: VisualizerSettings) {
  const barCount = 6;
  const barWidth = 12;
  const spacing = (width - barCount * barWidth) / (barCount + 1);

  for (let i = 0; i < barCount; i++) {
    const x = spacing + i * (barWidth + spacing);
    const value = Math.min(1, (dataArray[i * 8] / 255) * settings.sensitivity + 0.1 + Math.sin(i) * 0.1);

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(x, 0, barWidth, height - 20);

    const gradient = ctx.createLinearGradient(0, height - 20, 0, 0);
    gradient.addColorStop(0, `hsl(${(150 + settings.hueShift) % 360}, 100%, 50%)`);
    gradient.addColorStop(1, `hsl(${(280 + settings.hueShift) % 360}, 100%, 50%)`);

    ctx.fillStyle = gradient;
    const fillHeight = value * (height - 20);
    ctx.fillRect(x, height - 20 - fillHeight, barWidth, fillHeight);
  }

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height - 10);
  ctx.lineTo(width, height - 10);
  ctx.stroke();
}
