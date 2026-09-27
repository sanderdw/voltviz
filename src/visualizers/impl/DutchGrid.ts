import type { ExtendedFeatureCollection, GeoProjection } from 'd3-geo';
import type { VisualizerFactory } from '../runtime/types';

interface Node {
  id: number;
  lon: number;
  lat: number;
  isMajor: boolean;
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

const DutchGrid: VisualizerFactory = async ({ container }) => {
  const wrapper = document.createElement('div');
  wrapper.className = 'w-full h-full relative';
  container.appendChild(wrapper);

  const loading = document.createElement('div');
  loading.className = 'absolute inset-0 flex items-center justify-center bg-[#021210] z-10';
  const loadingText = document.createElement('div');
  loadingText.className = 'text-emerald-400 font-mono animate-pulse';
  loadingText.textContent = 'Initializing Dutch Grid Topology...';
  loading.appendChild(loadingText);
  wrapper.appendChild(loading);

  const canvas = document.createElement('canvas');
  canvas.className = 'w-full h-full block';
  wrapper.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  // Load d3-geo and the local GeoJSON map data
  const [{ geoMercator, geoPath, geoContains }, geoModule] = await Promise.all([
    import('d3-geo'),
    import('../../data/Netherlands_gemeentes.json'),
  ]);
  const geojson = geoModule.default as unknown as ExtendedFeatureCollection;
  const mapData = geojson;

  // Generate Network
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const majorCities = [
    { lon: 4.9041, lat: 52.3676 }, // Amsterdam
    { lon: 4.4777, lat: 51.9244 }, // Rotterdam
    { lon: 4.3007, lat: 52.0705 }, // The Hague
    { lon: 5.1214, lat: 52.0907 }, // Utrecht
    { lon: 5.4697, lat: 51.4416 }, // Eindhoven
    { lon: 6.5665, lat: 53.2194 }, // Groningen
    { lon: 6.0830, lat: 52.5168 }, // Zwolle
    { lon: 6.8937, lat: 52.2215 }, // Enschede
    { lon: 5.8528, lat: 51.8425 }, // Nijmegen
    { lon: 5.6909, lat: 50.8514 }, // Maastricht
    { lon: 3.6110, lat: 51.4988 }, // Middelburg
    { lon: 5.7999, lat: 53.2012 }, // Leeuwarden
    { lon: 4.7593, lat: 52.9563 }, // Den Helder
    { lon: 6.8914, lat: 52.7858 }, // Emmen
    { lon: 4.7753, lat: 51.5853 }, // Breda
    { lon: 6.1681, lat: 51.3704 }, // Venlo
  ];

  majorCities.forEach((city, i) => {
    nodes.push({ id: i, lon: city.lon, lat: city.lat, isMajor: true, energy: 0 });
  });

  const numMinorNodes = 250;
  let attempts = 0;
  while (nodes.length < numMinorNodes + majorCities.length && attempts < 3000) {
    attempts++;
    const lon = 3.3 + Math.random() * (7.2 - 3.3);
    const lat = 50.7 + Math.random() * (53.5 - 50.7);

    if (geojson.features.some(f => geoContains(f, [lon, lat]))) {
      nodes.push({ id: nodes.length, lon, lat, isMajor: false, energy: 0 });
    }
  }

  // Connect major nodes (High Voltage)
  for (let i = 0; i < majorCities.length; i++) {
    const distances = majorCities.map((c, j) => ({ j, d: Math.hypot(c.lon - majorCities[i].lon, c.lat - majorCities[i].lat) }));
    distances.sort((a, b) => a.d - b.d);
    for (let k = 1; k <= 3; k++) {
      if (distances[k]) {
        const target = distances[k].j;
        if (!edges.some(e => (e.from === i && e.to === target) || (e.from === target && e.to === i))) {
          edges.push({ from: i, to: target, isHighVoltage: true });
        }
      }
    }
  }

  // Connect minor nodes (Low Voltage)
  for (let i = majorCities.length; i < nodes.length; i++) {
    const n = nodes[i];

    let minDist = Infinity;
    let nearestMajor = -1;
    for (let j = 0; j < majorCities.length; j++) {
      const d = Math.hypot(n.lon - nodes[j].lon, n.lat - nodes[j].lat);
      if (d < minDist) {
        minDist = d;
        nearestMajor = j;
      }
    }
    if (nearestMajor !== -1) {
      edges.push({ from: i, to: nearestMajor, isHighVoltage: false });
    }

    const minorDistances = [];
    for (let j = majorCities.length; j < nodes.length; j++) {
      if (i !== j) {
        minorDistances.push({ j, d: Math.hypot(n.lon - nodes[j].lon, n.lat - nodes[j].lat) });
      }
    }
    minorDistances.sort((a, b) => a.d - b.d);
    if (minorDistances[0] && minorDistances[0].d < 0.3) {
      const target = minorDistances[0].j;
      if (!edges.some(e => (e.from === i && e.to === target) || (e.from === target && e.to === i))) {
        edges.push({ from: i, to: target, isHighVoltage: false });
      }
    }
  }

  const particles: Particle[] = [];
  const sparks: Spark[] = [];
  let projection: GeoProjection | null = null;

  loading.remove();

  return {
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;

      if (mapData) {
        const padding = 60;
        const drawAreaW = w - padding * 2;
        const drawAreaH = h - padding * 2;

        const proj = geoMercator().fitSize([drawAreaW, drawAreaH], mapData);
        proj.translate([proj.translate()[0] + padding, proj.translate()[1] + padding]);
        projection = proj;
      }
    },
    frame({ audio, settings }) {
      const w = canvas.width;
      const h = canvas.height;
      const currentSettings = settings;
      const proj = projection;
      const sensitivity = currentSettings.sensitivity * 0.8;

      const dataArray = audio.spectrum({ fftSize: 512, smoothing: 0.8 });
      const bufferLength = dataArray.length;

      // Audio analysis (fftSize = 512, bufferLength = 256)
      // Assuming ~44100Hz sample rate, each bin is ~86Hz
      // Bass: 0-250Hz (bins 0-3)
      const bass = dataArray.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
      // Mid: 250-4000Hz (bins 4-46)
      const mid = dataArray.slice(4, 47).reduce((a, b) => a + b, 0) / 43;
      // Treble: 4000-16000Hz (bins 47-185)
      const treble = dataArray.slice(47, 186).reduce((a, b) => a + b, 0) / 139;

      // Clear background (Dark teal/mint)
      ctx.fillStyle = '#021210';
      ctx.fillRect(0, 0, w, h);

      if (!proj || !mapData) return;

      const getScreenPos = (n: Node) => {
        const [x, y] = proj([n.lon, n.lat]) || [0, 0];
        // Apply scale from the center of the screen
        const scaledX = w/2 + (x - w/2) * currentSettings.scale;
        const scaledY = h/2 + (y - h/2) * currentSettings.scale;
        return { x: scaledX, y: scaledY };
      };

      // Draw map contours
      const pathGen = geoPath().projection(proj).context(ctx);
      ctx.save();
      ctx.translate(w/2, h/2);
      ctx.scale(currentSettings.scale, currentSettings.scale);
      ctx.translate(-w/2, -h/2);
      ctx.beginPath();
      pathGen(mapData);
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.15)'; // Subtle green/teal
      ctx.lineWidth = 1.5 / currentSettings.scale;
      ctx.stroke();
      ctx.fillStyle = 'rgba(74, 222, 128, 0.03)';
      ctx.fill();
      ctx.restore();

      // Draw edges
      ctx.lineCap = 'round';
      edges.forEach(edge => {
        const n1 = getScreenPos(nodes[edge.from]);
        const n2 = getScreenPos(nodes[edge.to]);

        ctx.beginPath();
        ctx.moveTo(n1.x, n1.y);
        ctx.lineTo(n2.x, n2.y);

        const baseHue = edge.isHighVoltage ? 170 : 30; // Teal or Orange
        const hue = (baseHue + currentSettings.hueShift) % 360;

        ctx.strokeStyle = `hsla(${hue}, 80%, 40%, 0.4)`;
        ctx.lineWidth = (edge.isHighVoltage ? 2 : 1) * currentSettings.scale;
        ctx.stroke();
      });

      // Spawn particles
      if (bass * sensitivity > 150 && Math.random() > 0.5) {
        // Return (Generation): Flow from minor to major
        const edgeIdx = Math.floor(Math.random() * edges.length);
        const edge = edges[edgeIdx];
        const isFromMinor = !nodes[edge.from].isMajor;
        particles.push({
          edgeIndex: edgeIdx,
          progress: isFromMinor ? 0 : 1,
          direction: isFromMinor ? 1 : -1,
          speed: 0.01 * currentSettings.speed * (1 + bass/255),
          color: '#4ade80', // Green for return
          type: 'return'
        });
      }

      if (treble * sensitivity > 100 && Math.random() > 0.3) {
        // Consumption: Flow from major to minor
        const validEdges = edges.map((e, i) => ({e, i})).filter(x => nodes[x.e.from].isMajor !== nodes[x.e.to].isMajor);
        if (validEdges.length > 0) {
          const {e, i} = validEdges[Math.floor(Math.random() * validEdges.length)];
          const isFromMajor = nodes[e.from].isMajor;
          particles.push({
            edgeIndex: i,
            progress: isFromMajor ? 0 : 1,
            direction: isFromMajor ? 1 : -1,
            speed: 0.02 * currentSettings.speed * (1 + treble/255),
            color: '#fb923c', // Orange for consumption
            type: 'consumption'
          });
        }
      }

      if (mid * sensitivity > 120 && Math.random() > 0.4) {
        // Distribution: Flow between minor nodes
        const validEdges = edges.map((e, i) => ({e, i})).filter(x => !nodes[x.e.from].isMajor && !nodes[x.e.to].isMajor);
        if (validEdges.length > 0) {
          const {e, i} = validEdges[Math.floor(Math.random() * validEdges.length)];
          const direction = Math.random() > 0.5 ? 1 : -1;
          particles.push({
            edgeIndex: i,
            progress: direction === 1 ? 0 : 1,
            direction: direction,
            speed: 0.015 * currentSettings.speed * (1 + mid/255),
            color: '#60a5fa', // Blue for distribution
            type: 'distribution'
          });
        }
      }

      // Spawn sparks on heavy bass
      if (bass * sensitivity > 170) {
        const numSparks = Math.floor((bass * sensitivity - 170) / 5);
        for (let i = 0; i < numSparks; i++) {
          const sourceNode = nodes[Math.floor(Math.random() * nodes.length)];
          const pos = getScreenPos(sourceNode);
          const angle = Math.random() * Math.PI * 2;
          const speed = 8 + Math.random() * 15 * currentSettings.speed;
          const hue = (Math.random() > 0.5 ? 40 : 150) + currentSettings.hueShift + (Math.random() * 30 - 15);

          sparks.push({
            x: pos.x,
            y: pos.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            color: `hsla(${hue}, 100%, 60%, `,
            size: 2 + Math.random() * 3
          });
        }
      }

      // Draw and update particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.progress += p.speed * p.direction;

        if (p.progress < 0 || p.progress > 1) {
          particles.splice(i, 1);
          continue;
        }

        const edge = edges[p.edgeIndex];
        const n1 = getScreenPos(nodes[edge.from]);
        const n2 = getScreenPos(nodes[edge.to]);

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
      for (let i = sparks.length - 1; i >= 0; i--) {
        const spark = sparks[i];

        spark.x += spark.vx * currentSettings.scale;
        spark.y += spark.vy * currentSettings.scale;
        spark.life -= 0.005; // Fade out slowly so they can fly off screen

        if (spark.life <= 0 || spark.x < 0 || spark.x > w || spark.y < 0 || spark.y > h) {
          sparks.splice(i, 1);
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

      // Draw nodes
      nodes.forEach(node => {
        const pos = getScreenPos(node);
        const freqIndex = Math.floor((node.id / nodes.length) * (bufferLength * 0.5));
        const val = dataArray[freqIndex] / 255;

        node.energy = node.energy * 0.8 + val * 0.2;

        const radius = (node.isMajor ? 4 + node.energy * 6 * sensitivity : 2 + node.energy * 3 * sensitivity) * currentSettings.scale;

        const baseHue = node.isMajor ? 170 : 30;
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
      });

      // Draw HUD
      // Real-world NL grid averages (2025): Consumption ~116 TWh/y ≈ 13,200 MW avg, Production ~128 TWh/y ≈ 14,600 MW avg
      const consumptionMW = Math.round(10600 + (treble / 255) * 5300 * sensitivity);
      const returnMW = Math.round(11700 + (bass / 255) * 5800 * sensitivity);
      const distributionMW = consumptionMW + returnMW;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(20, 20, 240, 110);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.strokeRect(20, 20, 240, 110);

      ctx.font = '14px "JetBrains Mono", monospace';

      ctx.fillStyle = '#fb923c';
      ctx.fillText(`CONSUMPTION:  ${consumptionMW.toString().padStart(5, ' ')} MW`, 35, 45);

      ctx.fillStyle = '#4ade80';
      ctx.fillText(`RETURN:       ${returnMW.toString().padStart(5, ' ')} MW`, 35, 75);

      ctx.fillStyle = '#60a5fa';
      ctx.fillText(`DISTRIBUTION: ${distributionMW.toString().padStart(5, ' ')} MW`, 35, 105);

      // Title
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '12px "Inter", sans-serif';
      ctx.fillText('This visualization is inspired by the work of Dutch grid operators.', 35, 150);
    },
    dispose() {
      particles.length = 0;
      sparks.length = 0;
      wrapper.remove();
    },
  };
};

export default DutchGrid;
