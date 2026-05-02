import { useEffect, useRef, useState } from 'react';
import { VisualizerSettings } from '../../types';
import { geoMercator, geoPath } from 'd3-geo';
import netherlandsGeoJson from '../../data/Netherlands_gemeentes.json';

// Import all station data files
import amsterdamData from '../../data/amsterdam.json';
import flevolandData from '../../data/flevoland.json';
import frieslandData from '../../data/friesland.json';
import gelderlandData from '../../data/gelderland.json';
import noordHollandData from '../../data/noord-holland.json';
import zuidHollandData from '../../data/zuid-holland.json';
import syntheticGroningenData from '../../data/synthetic-groningen.json';
import syntheticDrentheData from '../../data/synthetic-drenthe.json';
import syntheticOverijsselData from '../../data/synthetic-overijssel.json';
import syntheticUtrechtData from '../../data/synthetic-utrecht.json';
import syntheticZeelandData from '../../data/synthetic-zeeland.json';
import syntheticNoordBrabantData from '../../data/synthetic-noord-brabant.json';
import syntheticLimburgData from '../../data/synthetic-limburg.json';
import syntheticZuidHollandZuidData from '../../data/synthetic-zuid-holland-zuid.json';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

interface StationNode {
  id: number;
  lon: number;
  lat: number;
  name: string;
  stationType: string; // OS, RS, SS
  energy: number;
}

interface Edge {
  from: number;
  to: number;
  isHighVoltage: boolean;
}

interface Particle {
  edgeIndex: number;
  progress: number;
  direction: 1 | -1;
  speed: number;
  color: string;
  type: 'consumption' | 'return' | 'distribution';
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

function loadStations(): StationNode[] {
  const allDataSets = [
    amsterdamData,
    flevolandData,
    frieslandData,
    gelderlandData,
    noordHollandData,
    zuidHollandData,
    syntheticGroningenData,
    syntheticDrentheData,
    syntheticOverijsselData,
    syntheticUtrechtData,
    syntheticZeelandData,
    syntheticNoordBrabantData,
    syntheticLimburgData,
    syntheticZuidHollandZuidData
  ];

  const nodes: StationNode[] = [];
  let id = 0;

  for (const dataset of allDataSets) {
    const features = (dataset as any).features || [];
    for (const feature of features) {
      const coords = feature.geometry?.coordinates;
      const props = feature.properties;
      if (coords && props) {
        nodes.push({
          id: id++,
          lon: coords[0],
          lat: coords[1],
          name: props.name || '',
          stationType: props.type || 'OS',
          energy: 0,
        });
      }
    }
  }

  return nodes;
}

function buildEdges(nodes: StationNode[]): Edge[] {
  const edges: Edge[] = [];

  // SS nodes are major hubs (substations)
  // RS nodes are regional stations
  // OS nodes are local stations
  const ssNodes = nodes.filter(n => n.stationType === 'SS');
  const rsNodes = nodes.filter(n => n.stationType === 'RS');
  const osNodes = nodes.filter(n => n.stationType === 'OS');

  // Connect SS nodes to nearest SS nodes (high voltage backbone)
  for (const ss of ssNodes) {
    const distances = ssNodes
      .filter(other => other.id !== ss.id)
      .map(other => ({ node: other, d: Math.hypot(other.lon - ss.lon, other.lat - ss.lat) }))
      .sort((a, b) => a.d - b.d);

    for (let k = 0; k < Math.min(3, distances.length); k++) {
      const target = distances[k].node;
      if (!edges.some(e => (e.from === ss.id && e.to === target.id) || (e.from === target.id && e.to === ss.id))) {
        edges.push({ from: ss.id, to: target.id, isHighVoltage: true });
      }
    }
  }

  // Connect RS nodes to nearest SS node (high voltage)
  for (const rs of rsNodes) {
    let minDist = Infinity;
    let nearest: StationNode | null = null;
    for (const ss of ssNodes) {
      const d = Math.hypot(rs.lon - ss.lon, rs.lat - ss.lat);
      if (d < minDist) {
        minDist = d;
        nearest = ss;
      }
    }
    if (nearest) {
      edges.push({ from: rs.id, to: nearest.id, isHighVoltage: true });
    }

    // Also connect RS to nearest other RS
    const rsDistances = rsNodes
      .filter(other => other.id !== rs.id)
      .map(other => ({ node: other, d: Math.hypot(other.lon - rs.lon, other.lat - rs.lat) }))
      .sort((a, b) => a.d - b.d);

    if (rsDistances[0] && rsDistances[0].d < 0.5) {
      const target = rsDistances[0].node;
      if (!edges.some(e => (e.from === rs.id && e.to === target.id) || (e.from === target.id && e.to === rs.id))) {
        edges.push({ from: rs.id, to: target.id, isHighVoltage: true });
      }
    }
  }

  // Connect OS nodes to nearest RS or SS node (low voltage distribution)
  const hubNodes = [...ssNodes, ...rsNodes];
  for (const os of osNodes) {
    let minDist = Infinity;
    let nearest: StationNode | null = null;
    for (const hub of hubNodes) {
      const d = Math.hypot(os.lon - hub.lon, os.lat - hub.lat);
      if (d < minDist) {
        minDist = d;
        nearest = hub;
      }
    }
    if (nearest) {
      edges.push({ from: os.id, to: nearest.id, isHighVoltage: false });
    }

    // Connect OS to nearest other OS
    const osDistances = osNodes
      .filter(other => other.id !== os.id)
      .map(other => ({ node: other, d: Math.hypot(other.lon - os.lon, other.lat - os.lat) }))
      .sort((a, b) => a.d - b.d);

    if (osDistances[0] && osDistances[0].d < 0.15) {
      const target = osDistances[0].node;
      if (!edges.some(e => (e.from === os.id && e.to === target.id) || (e.from === target.id && e.to === os.id))) {
        edges.push({ from: os.id, to: target.id, isHighVoltage: false });
      }
    }
  }

  return edges;
}

export default function DutchGridReal({ stream, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const settingsRef = useRef(settings);

  const mapDataRef = useRef<any>(null);
  const nodesRef = useRef<StationNode[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const sparksRef = useRef<Spark[]>([]);
  const projectionRef = useRef<any>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const showLabelsRef = useRef(true);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    showLabelsRef.current = showLabels;
  }, [showLabels]);

  useEffect(() => {
    const geojson = netherlandsGeoJson as any;
    mapDataRef.current = geojson;

    const nodes = loadStations();
    const edges = buildEdges(nodes);

    nodesRef.current = nodes;
    edgesRef.current = edges;
    setIsLoading(false);

    window.dispatchEvent(new Event('resize'));
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || isLoading) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const resize = () => {
      if (containerRef.current && canvasRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        canvasRef.current.width = w;
        canvasRef.current.height = h;

        if (mapDataRef.current) {
          const padding = 60;
          const drawAreaW = w - padding * 2;
          const drawAreaH = h - padding * 2;

          const proj = geoMercator().fitSize([drawAreaW, drawAreaH], mapDataRef.current);
          proj.translate([proj.translate()[0] + padding, proj.translate()[1] + padding]);
          projectionRef.current = proj;
        }
      }
    };
    window.addEventListener('resize', resize);
    resize();

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settingsRef.current;
      const proj = projectionRef.current;
      const sensitivity = currentSettings.sensitivity * 0.8;

      analyser.getByteFrequencyData(dataArray);

      const bass = dataArray.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
      const mid = dataArray.slice(4, 47).reduce((a, b) => a + b, 0) / 43;
      const treble = dataArray.slice(47, 186).reduce((a, b) => a + b, 0) / 139;

      ctx.fillStyle = '#021210';
      ctx.fillRect(0, 0, w, h);

      if (!proj || !mapDataRef.current) return;

      const getScreenPos = (n: StationNode) => {
        const [x, y] = proj([n.lon, n.lat]) || [0, 0];
        const scaledX = w / 2 + (x - w / 2) * currentSettings.scale;
        const scaledY = h / 2 + (y - h / 2) * currentSettings.scale;
        return { x: scaledX, y: scaledY };
      };

      // Draw map contours
      const pathGen = geoPath().projection(proj).context(ctx);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(currentSettings.scale, currentSettings.scale);
      ctx.translate(-w / 2, -h / 2);
      ctx.beginPath();
      pathGen(mapDataRef.current);
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.15)';
      ctx.lineWidth = 1.5 / currentSettings.scale;
      ctx.stroke();
      ctx.fillStyle = 'rgba(74, 222, 128, 0.03)';
      ctx.fill();
      ctx.restore();

      // Draw edges
      ctx.lineCap = 'round';
      edgesRef.current.forEach(edge => {
        const n1 = getScreenPos(nodesRef.current[edge.from]);
        const n2 = getScreenPos(nodesRef.current[edge.to]);

        ctx.beginPath();
        ctx.moveTo(n1.x, n1.y);
        ctx.lineTo(n2.x, n2.y);

        const baseHue = edge.isHighVoltage ? 170 : 30;
        const hue = (baseHue + currentSettings.hueShift) % 360;

        ctx.strokeStyle = `hsla(${hue}, 80%, 40%, 0.4)`;
        ctx.lineWidth = (edge.isHighVoltage ? 2 : 1) * currentSettings.scale;
        ctx.stroke();
      });

      // Spawn particles
      if (bass * sensitivity > 150 && Math.random() > 0.5) {
        const edgeIdx = Math.floor(Math.random() * edgesRef.current.length);
        const edge = edgesRef.current[edgeIdx];
        const isFromMinor = nodesRef.current[edge.from].stationType === 'OS';
        particlesRef.current.push({
          edgeIndex: edgeIdx,
          progress: isFromMinor ? 0 : 1,
          direction: isFromMinor ? 1 : -1,
          speed: 0.01 * currentSettings.speed * (1 + bass / 255),
          color: '#4ade80',
          type: 'return',
        });
      }

      if (treble * sensitivity > 100 && Math.random() > 0.3) {
        const validEdges = edgesRef.current
          .map((e, i) => ({ e, i }))
          .filter(x => nodesRef.current[x.e.from].stationType !== nodesRef.current[x.e.to].stationType);
        if (validEdges.length > 0) {
          const { e, i } = validEdges[Math.floor(Math.random() * validEdges.length)];
          const isFromMajor = nodesRef.current[e.from].stationType === 'SS';
          particlesRef.current.push({
            edgeIndex: i,
            progress: isFromMajor ? 0 : 1,
            direction: isFromMajor ? 1 : -1,
            speed: 0.02 * currentSettings.speed * (1 + treble / 255),
            color: '#fb923c',
            type: 'consumption',
          });
        }
      }

      if (mid * sensitivity > 120 && Math.random() > 0.4) {
        const validEdges = edgesRef.current
          .map((e, i) => ({ e, i }))
          .filter(x => nodesRef.current[x.e.from].stationType === 'OS' && nodesRef.current[x.e.to].stationType === 'OS');
        if (validEdges.length > 0) {
          const { i } = validEdges[Math.floor(Math.random() * validEdges.length)];
          const direction = Math.random() > 0.5 ? 1 : -1;
          particlesRef.current.push({
            edgeIndex: i,
            progress: direction === 1 ? 0 : 1,
            direction: direction,
            speed: 0.015 * currentSettings.speed * (1 + mid / 255),
            color: '#60a5fa',
            type: 'distribution',
          });
        }
      }

      // Spawn sparks on heavy bass
      if (bass * sensitivity > 170) {
        const numSparks = Math.floor((bass * sensitivity - 170) / 5);
        for (let i = 0; i < numSparks; i++) {
          const sourceNode = nodesRef.current[Math.floor(Math.random() * nodesRef.current.length)];
          const pos = getScreenPos(sourceNode);
          const angle = Math.random() * Math.PI * 2;
          const speed = 8 + Math.random() * 15 * currentSettings.speed;
          const hue = (Math.random() > 0.5 ? 40 : 150) + currentSettings.hueShift + (Math.random() * 30 - 15);

          sparksRef.current.push({
            x: pos.x,
            y: pos.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            color: `hsla(${hue}, 100%, 60%, `,
            size: 2 + Math.random() * 3,
          });
        }
      }

      // Draw and update particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.progress += p.speed * p.direction;

        if (p.progress < 0 || p.progress > 1) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        const edge = edgesRef.current[p.edgeIndex];
        const n1 = getScreenPos(nodesRef.current[edge.from]);
        const n2 = getScreenPos(nodesRef.current[edge.to]);

        const x = n1.x + (n2.x - n1.x) * p.progress;
        const y = n1.y + (n2.y - n1.y) * p.progress;

        ctx.beginPath();
        ctx.arc(x, y, (p.type === 'return' ? 3 : 2) * currentSettings.scale, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 10 * currentSettings.scale;
        ctx.shadowColor = p.color;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Draw and update sparks
      ctx.lineCap = 'round';
      for (let i = sparksRef.current.length - 1; i >= 0; i--) {
        const spark = sparksRef.current[i];

        spark.x += spark.vx * currentSettings.scale;
        spark.y += spark.vy * currentSettings.scale;
        spark.life -= 0.005;

        if (spark.life <= 0 || spark.x < 0 || spark.x > w || spark.y < 0 || spark.y > h) {
          sparksRef.current.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.moveTo(spark.x, spark.y);
        ctx.lineTo(spark.x - spark.vx * 2 * currentSettings.scale, spark.y - spark.vy * 2 * currentSettings.scale);
        ctx.strokeStyle = `${spark.color}${spark.life})`;
        ctx.lineWidth = spark.size * currentSettings.scale;
        ctx.shadowBlur = 12 * currentSettings.scale;
        ctx.shadowColor = `${spark.color}${spark.life})`;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Draw nodes and labels
      const fontSize = Math.max(7, 9 * currentSettings.scale);
      ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
      ctx.textBaseline = 'middle';

      nodesRef.current.forEach(node => {
        const pos = getScreenPos(node);
        const freqIndex = Math.floor((node.id / nodesRef.current.length) * (bufferLength * 0.5));
        const val = dataArray[freqIndex] / 255;

        node.energy = node.energy * 0.8 + val * 0.2;

        let radius: number;
        let baseHue: number;
        if (node.stationType === 'SS') {
          radius = (5 + node.energy * 6 * sensitivity) * currentSettings.scale;
          baseHue = 170; // Teal
        } else if (node.stationType === 'RS') {
          radius = (3.5 + node.energy * 4 * sensitivity) * currentSettings.scale;
          baseHue = 50; // Yellow-ish
        } else {
          radius = (2 + node.energy * 3 * sensitivity) * currentSettings.scale;
          baseHue = 30; // Orange
        }

        const hue = (baseHue + currentSettings.hueShift) % 360;

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 80%, 60%, 1)`;
        if (node.energy > 0.5) {
          ctx.shadowBlur = 15 * node.energy * currentSettings.scale;
          ctx.shadowColor = `hsla(${hue}, 80%, 60%, 1)`;
        }
        ctx.fill();
        ctx.shadowBlur = 0;

        // Draw station name label
        if (showLabelsRef.current) {
          const labelAlpha = node.stationType === 'SS' ? 0.8 : node.stationType === 'RS' ? 0.6 : 0.4;
          ctx.fillStyle = `rgba(255, 255, 255, ${labelAlpha})`;
          ctx.fillText(node.name, pos.x + radius + 3 * currentSettings.scale, pos.y);
        }
      });

      // Draw HUD
      const consumptionMW = Math.round(10600 + (treble / 255) * 5300 * sensitivity);
      const returnMW = Math.round(11700 + (bass / 255) * 5800 * sensitivity);
      const distributionMW = consumptionMW + returnMW;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(20, 20, 240, 130);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.strokeRect(20, 20, 240, 130);

      ctx.font = '14px "JetBrains Mono", monospace';
      ctx.textBaseline = 'alphabetic';

      ctx.fillStyle = '#fb923c';
      ctx.fillText(`CONSUMPTION:  ${consumptionMW.toString().padStart(5, ' ')} MW`, 35, 45);

      ctx.fillStyle = '#4ade80';
      ctx.fillText(`RETURN:       ${returnMW.toString().padStart(5, ' ')} MW`, 35, 75);

      ctx.fillStyle = '#60a5fa';
      ctx.fillText(`DISTRIBUTION: ${distributionMW.toString().padStart(5, ' ')} MW`, 35, 105);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillText(`STATIONS: ${nodesRef.current.length}`, 35, 135);

      // Title
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '12px "Inter", sans-serif';
      ctx.fillText('Real station data from Liander grid operator maps.', 35, 170);
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
  }, [stream, isLoading]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#021210] z-10">
          <div className="text-emerald-400 font-mono animate-pulse">Loading Liander Station Data...</div>
        </div>
      )}
      <canvas ref={canvasRef} className="w-full h-full block" />
      <button
        onClick={() => setShowLabels(v => !v)}
        className="absolute bottom-4 right-4 px-3 py-1.5 rounded-full bg-black/50 hover:bg-black/70 border border-white/10 text-xs text-white/70 hover:text-white transition-colors cursor-pointer backdrop-blur-sm z-20"
      >
        {showLabels ? 'Hide Names' : 'Show Names'}
      </button>
    </div>
  );
}
