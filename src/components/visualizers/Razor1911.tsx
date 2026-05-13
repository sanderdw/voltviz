import { useEffect, useRef } from 'react';
import { VisualizerSettings } from '../../types';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

const SCROLL_TEXT =
  '                    ' +
  'RAZOR 1911  •  SINCE 1985  •  THE OLDEST STILL ACTIVE SCENE GROUP  •  ' +
  'GREETINGS FLY OUT TO:  FAIRLIGHT • PARADOX • SKIDROW • DEVIANCE • CLASS • RELOADED • HOODLUM  •  ' +
  'THE DEMOSCENE WILL NEVER DIE  •  KEEP CRACKING  •  RAZOR 1911' +
  '                    ';

export default function Razor1911({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const freqBins = analyser.frequencyBinCount;
    const freqData = new Uint8Array(freqBins);

    let bassSlow = 0;
    let bassKickDecay = 0;

    interface Star {
      x: number;
      y: number;
      z: number;
    }

    const STAR_COUNT = 250;
    const stars: Star[] = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() });
    }

    let scrollX = 0;
    let elapsed = 0;
    let w = 0;
    let h = 0;
    let flashIntensity = 0;

    const resize = () => {
      if (!containerRef.current || !canvasRef.current) return;
      const dpr = Math.min(window.devicePixelRatio, 2);
      w = containerRef.current.clientWidth;
      h = containerRef.current.clientHeight;
      canvasRef.current.width = Math.floor(w * dpr);
      canvasRef.current.height = Math.floor(h * dpr);
      canvasRef.current.style.width = `${w}px`;
      canvasRef.current.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    window.addEventListener('resize', resize);
    resize();

    let lastTime = performance.now();

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const cur = settingsRef.current;
      const speed = cur.speed;
      const sens = cur.sensitivity;
      const hue = cur.hueShift;
      const scale = cur.scale;

      analyser.getByteFrequencyData(freqData);
      const bassEnd = Math.max(2, Math.floor(freqBins * 0.06));
      const midEnd = Math.floor(freqBins * 0.25);
      const trebleEnd = Math.floor(freqBins * 0.6);
      let bass = 0, mid = 0, treble = 0;
      for (let i = 2; i < bassEnd; i++) bass += freqData[i];
      bass = bass / Math.max(1, bassEnd - 2) / 255;
      for (let i = bassEnd; i < midEnd; i++) mid += freqData[i];
      mid = mid / Math.max(1, midEnd - bassEnd) / 255;
      for (let i = midEnd; i < trebleEnd; i++) treble += freqData[i];
      treble = treble / Math.max(1, trebleEnd - midEnd) / 255;
      const energy = bass * 0.5 + mid * 0.3 + treble * 0.2;

      // Bass kick detection: raw bass vs slow envelope
      bassSlow = bassSlow * 0.95 + bass * 0.05;
      const kickStrength = Math.max(0, bass - bassSlow - 0.05 * (1 / sens));
      if (kickStrength > 0) {
        bassKickDecay = Math.min(1, bassKickDecay + kickStrength * 6 * sens);
        flashIntensity = Math.min(1, kickStrength * 8 * sens);
      }
      bassKickDecay *= 0.88;
      flashIntensity *= 0.85;

      const audioActive = energy * sens;
      elapsed += dt * speed * audioActive;

      // Background — flash white on hard bass kicks
      if (flashIntensity > 0.05) {
        const fl = Math.round(flashIntensity * 30);
        ctx.fillStyle = `rgb(${fl},${fl},${fl})`;
      } else {
        ctx.fillStyle = '#000';
      }
      ctx.fillRect(0, 0, w, h);

      // --- Starfield (speed reacts to bass) ---
      const starSpeed = (bass * 3.5 + bassKickDecay * 4) * sens * speed;
      for (let i = 0; i < STAR_COUNT; i++) {
        const star = stars[i];
        star.z -= starSpeed * dt;
        if (star.z <= 0.01) {
          star.x = Math.random() * 2 - 1;
          star.y = Math.random() * 2 - 1;
          star.z = 1;
        }
        const sx = (star.x / star.z) * (w * 0.5) + w * 0.5;
        const sy = (star.y / star.z) * (h * 0.5) + h * 0.5;
        if (sx < 0 || sx > w || sy < 0 || sy > h) {
          star.x = Math.random() * 2 - 1;
          star.y = Math.random() * 2 - 1;
          star.z = 1;
          continue;
        }
        const depth = 1 - star.z;
        const brightness = depth * (0.12 + bass * 1.5 * sens);
        const size = depth * (2 + bassKickDecay * 3) * scale;
        const starHue = (hue + depth * 60) % 360;
        ctx.fillStyle = `hsl(${starHue}, 30%, ${Math.round(Math.min(1, brightness) * 100)}%)`;
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
      }

      // --- Copper raster bars (height and intensity driven by bass) ---
      if (bass * sens > 0.02) {
        const barCount = 6;
        const barHeight = (8 + bass * 60 * sens + bassKickDecay * 30) * scale;
        const barAlpha = Math.min(1, bass * 4 * sens);
        for (let i = 0; i < barCount; i++) {
          const phase = elapsed * 2.0 + i * (Math.PI * 2 / barCount);
          const yPos = h * 0.5 + Math.sin(phase) * h * 0.3;
          const barHue = (hue + i * 60 + elapsed * 50) % 360;

          for (let line = -barHeight / 2; line < barHeight / 2; line++) {
            const y = Math.round(yPos + line);
            if (y < 0 || y >= h) continue;
            const dist = Math.abs(line) / (barHeight / 2);
            const lightness = 0.55 * (1 - dist * dist) * barAlpha;
            ctx.fillStyle = `hsl(${barHue}, 90%, ${Math.round(lightness * 100)}%)`;
            ctx.fillRect(0, y, w, 1);
          }
        }
      }

      // --- "RAZOR 1911" main title ---
      const baseTitleSize = Math.max(36, Math.min(120, w / 8));
      const titlePulse = 1 + bassKickDecay * 0.2 * sens;
      const titleSize = baseTitleSize * scale * titlePulse;
      ctx.font = `900 ${titleSize}px "Impact", "Arial Black", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Shake on bass kick
      const shakeX = bassKickDecay * (Math.random() - 0.5) * 8 * sens;
      const shakeY = bassKickDecay * (Math.random() - 0.5) * 5 * sens;
      const titleY = h * 0.28 + shakeY;
      const titleX = w / 2 + shakeX;

      const titleHue = (hue + elapsed * 20) % 360;
      const titleGlow = 0.3 + bass * 0.7 * sens;

      // Outer glow — scales with bass
      if (bass * sens > 0.02) {
        ctx.shadowColor = `hsl(${titleHue}, 100%, 55%)`;
        ctx.shadowBlur = (10 + bass * 50 * sens + bassKickDecay * 40) * scale;
        ctx.fillStyle = `hsl(${titleHue}, 100%, ${Math.round(titleGlow * 55)}%)`;
        ctx.fillText('RAZOR 1911', titleX, titleY);

        // Second glow pass for extra punch on kicks
        if (bassKickDecay > 0.15) {
          ctx.shadowBlur = (bassKickDecay * 80) * scale;
          ctx.fillText('RAZOR 1911', titleX, titleY);
        }
        ctx.shadowBlur = 0;
      }

      // Chrome gradient text
      const gradient = ctx.createLinearGradient(
        titleX - titleSize * 2.5, titleY - titleSize / 2,
        titleX + titleSize * 2.5, titleY + titleSize / 2
      );
      const h1 = (hue + elapsed * 15) % 360;
      const h2 = (h1 + 40) % 360;
      const h3 = (h1 + 80) % 360;
      const baseBright = 35 + bass * 45 * sens;
      gradient.addColorStop(0, `hsl(${h1}, 80%, ${Math.round(baseBright)}%)`);
      gradient.addColorStop(0.5, `hsl(${h2}, 95%, ${Math.round(baseBright + 15)}%)`);
      gradient.addColorStop(1, `hsl(${h3}, 80%, ${Math.round(baseBright)}%)`);
      ctx.fillStyle = audioActive > 0.02 ? gradient : `hsl(${hue}, 40%, 30%)`;
      ctx.fillText('RAZOR 1911', titleX, titleY);

      // Outline
      ctx.strokeStyle = `hsl(${titleHue}, 60%, ${Math.round(20 + titleGlow * 40)}%)`;
      ctx.lineWidth = 1.5 * scale;
      ctx.strokeText('RAZOR 1911', titleX, titleY);

      // --- Subtitle ---
      const subSize = Math.max(12, Math.min(24, w / 40)) * scale;
      ctx.font = `bold ${subSize}px ui-monospace, "Courier New", monospace`;
      ctx.fillStyle = `hsl(${(hue + 30) % 360}, 50%, ${Math.round(25 + bass * 35 * sens)}%)`;
      ctx.fillText('EST. 1985  •  THE LEGACY LIVES ON', titleX, titleY + baseTitleSize * scale * 0.7);

      // --- Sine-wave text scroller ---
      const fontSize = Math.max(16, Math.min(36, w / 24)) * scale;
      ctx.font = `bold ${fontSize}px ui-monospace, "Courier New", monospace`;
      const charWidth = ctx.measureText('M').width;

      // Scroll speed driven by mid but boosted on bass kicks
      const scrollSpeed = (mid * 180 + bassKickDecay * 300) * sens * speed;
      scrollX += scrollSpeed * dt;
      const totalWidth = SCROLL_TEXT.length * charWidth;
      if (scrollX > totalWidth) scrollX -= totalWidth;

      const scrollY = h * 0.78;
      // Amplitude is purely bass-driven
      const amplitude = (bass * 60 + bassKickDecay * 30) * sens * scale;
      const waveFreq = 0.06 / Math.max(0.5, scale);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < SCROLL_TEXT.length; i++) {
        let xPos = i * charWidth - scrollX;
        if (xPos < -charWidth * 2) xPos += totalWidth;
        if (xPos > w + charWidth || xPos < -charWidth) continue;

        const sineOffset = amplitude > 1 ? Math.sin(xPos * waveFreq + elapsed * 4) * amplitude : 0;
        const charHue = (hue + xPos * 0.4 + elapsed * 40) % 360;
        const charBright = 30 + bass * 30 * sens + treble * 20 * sens;

        if (bassKickDecay > 0.1) {
          ctx.shadowColor = `hsl(${charHue}, 100%, 60%)`;
          ctx.shadowBlur = bassKickDecay * 12 * sens;
        }
        ctx.fillStyle = `hsl(${charHue}, 85%, ${Math.round(charBright)}%)`;
        ctx.fillText(SCROLL_TEXT[i], xPos, scrollY + sineOffset);
      }
      ctx.shadowBlur = 0;

      // --- Horizontal separator lines (pulse on bass) ---
      const lineAlpha = 0.15 + bass * 0.7 * sens;
      const lineHue = (hue + 180) % 360;
      ctx.strokeStyle = `hsla(${lineHue}, 70%, ${Math.round(30 + bassKickDecay * 40)}%, ${lineAlpha})`;
      ctx.lineWidth = 1 + bassKickDecay * 2;
      const sep1 = h * 0.48;
      const sep2 = h * 0.62;
      ctx.beginPath();
      ctx.moveTo(w * 0.1, sep1);
      ctx.lineTo(w * 0.9, sep1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w * 0.1, sep2);
      ctx.lineTo(w * 0.9, sep2);
      ctx.stroke();

      // --- Middle text ---
      const midSize = Math.max(14, Math.min(28, w / 30)) * scale;
      ctx.font = `600 ${midSize}px ui-monospace, "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const midY = (sep1 + sep2) / 2;
      const midHue = (hue + elapsed * 30 + 90) % 360;
      ctx.fillStyle = `hsl(${midHue}, 60%, ${Math.round(25 + bass * 40 * sens)}%)`;
      ctx.fillText('★  DEMOSCENE CRACKTRO TRIBUTE  ★', w / 2, midY);

      // --- Scanlines ---
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      for (let y = 0; y < h; y += 3) {
        ctx.fillRect(0, y, w, 1);
      }
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
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
