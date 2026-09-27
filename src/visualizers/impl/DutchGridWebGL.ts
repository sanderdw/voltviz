import * as THREE from 'three';
import { geoMercator, geoContains } from 'd3-geo';
import netherlandsGeoJson from '../../data/Netherlands_gemeentes.json';
import { createRenderer, disposeRenderer } from '../lib/three';
import type { VisualizerFactory } from '../runtime/types';

interface GridNode {
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
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  color: string;
  size: number;
}

function createCircleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
  }
  return new THREE.CanvasTexture(canvas);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A HUD row: <div class=...><span>LABEL</span><span><span>0</span> MW</span></div>; returns the value span. */
function hudRow(parent: HTMLElement, className: string, label: string): HTMLSpanElement {
  const row = el('div', className);
  row.appendChild(el('span', '', label));
  const valueWrap = el('span');
  const value = el('span', '', '0');
  valueWrap.appendChild(value);
  valueWrap.appendChild(document.createTextNode(' MW'));
  row.appendChild(valueWrap);
  parent.appendChild(row);
  return value;
}

const DutchGridWebGL: VisualizerFactory = async ({ container, width: w, height: h, dpr }) => {
  // Root layout (was the component's JSX)
  const root = el('div', 'w-full h-full relative bg-[#021210]');
  const loading = el('div', 'absolute inset-0 flex items-center justify-center bg-[#021210] z-10');
  loading.appendChild(el('div', 'text-emerald-400 font-mono animate-pulse', 'Initializing 3D Grid Topology...'));
  root.appendChild(loading);
  const canvasHost = el('div', 'w-full h-full absolute inset-0');
  root.appendChild(canvasHost);
  container.appendChild(root);

  // Let the loading indicator paint before the (synchronous) network generation
  await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

  // Load local GeoJSON map data
  const geojson = netherlandsGeoJson as any;

  // Generate Network
  const nodes: GridNode[] = [];
  const edges: Edge[] = [];
  const particles: Particle[] = [];
  const sparks: Spark[] = [];

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

    if (geojson.features.some((f: any) => geoContains(f, [lon, lat]))) {
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

  // Setup projection for a 1000x1000 logical area
  const proj = geoMercator().fitSize([1000, 1000], geojson);

  loading.remove();

  // --- Three.js Setup ---
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x021210, 0.0015);

  const camera = new THREE.PerspectiveCamera(45, w / h, 1, 3000);
  // Tilted perspective view
  camera.position.set(0, -600, 600);
  camera.lookAt(0, 0, 0);

  const renderer = createRenderer(canvasHost, w, h, dpr, { alpha: true, antialias: true, powerPreference: 'high-performance' });

  const mapGroup = new THREE.Group();
  scene.add(mapGroup);

  const getPos = (lon: number, lat: number) => {
    const p = proj([lon, lat]) || [0, 0];
    return { x: p[0] - 500, y: -(p[1] - 500) };
  };

  // 1. Draw Map Borders
  const linePoints: number[] = [];
  geojson.features.forEach((f: any) => {
    const processRing = (ring: any[]) => {
      for(let i=0; i<ring.length-1; i++) {
        const p1 = getPos(ring[i][0], ring[i][1]);
        const p2 = getPos(ring[i+1][0], ring[i+1][1]);
        linePoints.push(p1.x, p1.y, 0);
        linePoints.push(p2.x, p2.y, 0);
      }
    };
    if (f.geometry.type === 'Polygon') {
      f.geometry.coordinates.forEach(processRing);
    } else if (f.geometry.type === 'MultiPolygon') {
      f.geometry.coordinates.forEach((poly: any[]) => poly.forEach(processRing));
    }
  });

  const mapGeo = new THREE.BufferGeometry();
  mapGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
  const mapMat = new THREE.LineBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.15 });
  const mapLines = new THREE.LineSegments(mapGeo, mapMat);
  mapGroup.add(mapLines);

  // 2. Draw Edges
  const edgePoints: number[] = [];
  const edgeColors: number[] = [];
  const colorHigh = new THREE.Color(0x00ffff);
  const colorLow = new THREE.Color(0xff8800);

  edges.forEach(e => {
    const n1 = nodes[e.from];
    const n2 = nodes[e.to];
    const p1 = getPos(n1.lon, n1.lat);
    const p2 = getPos(n2.lon, n2.lat);
    edgePoints.push(p1.x, p1.y, 0);
    edgePoints.push(p2.x, p2.y, 0);

    const c = e.isHighVoltage ? colorHigh : colorLow;
    edgeColors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  });

  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePoints, 3));
  edgeGeo.setAttribute('color', new THREE.Float32BufferAttribute(edgeColors, 3));
  const edgeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3 });
  const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
  mapGroup.add(edgeLines);

  // 3. Nodes (InstancedMesh)
  const nodeGeo = new THREE.SphereGeometry(1, 16, 16);
  const nodeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const nodesMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, nodes.length);
  mapGroup.add(nodesMesh);

  // 4. Particles (InstancedMesh)
  const maxParticles = 2000;
  const particleGeo = new THREE.SphereGeometry(1.5, 8, 8);
  const particleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const particlesMesh = new THREE.InstancedMesh(particleGeo, particleMat, maxParticles);
  mapGroup.add(particlesMesh);

  // 5. Sparks (Points)
  const maxSparks = 2000;
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPositions = new Float32Array(maxSparks * 3);
  const sparkColors = new Float32Array(maxSparks * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));

  const sparkMat = new THREE.PointsMaterial({
    size: 6,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    map: createCircleTexture()
  });
  const sparksPoints = new THREE.Points(sparkGeo, sparkMat);
  mapGroup.add(sparksPoints);

  // Helpers
  const dummy = new THREE.Object3D();
  const colorObj = new THREE.Color();

  // --- HUD Overlay (DOM, updated every frame) ---
  const hud = el('div', 'absolute top-6 left-6 bg-black/60 backdrop-blur-md border border-white/10 p-5 rounded-xl font-mono text-sm pointer-events-none shadow-2xl');
  const consEl = hudRow(hud, 'text-orange-400 mb-2 flex justify-between w-48', 'CONSUMPTION:');
  const retEl = hudRow(hud, 'text-emerald-400 mb-2 flex justify-between w-48', 'RETURN:');
  const distEl = hudRow(hud, 'text-blue-400 mb-4 flex justify-between w-48', 'DISTRIBUTION:');
  const loadSection = el('div', 'border-t border-white/10 pt-3 mb-3');
  const loadHeader = el('div', 'flex justify-between items-center w-48 mb-2');
  loadHeader.appendChild(el('span', 'text-white/60 text-xs', 'GRID LOAD:'));
  const intensityLabelEl = el('span', 'text-xs font-bold', 'IDLE');
  intensityLabelEl.style.color = '#6b7280';
  loadHeader.appendChild(intensityLabelEl);
  loadSection.appendChild(loadHeader);
  const intensityBarsEl = el('div', 'flex gap-1 w-48');
  for (let i = 0; i < 5; i++) {
    const bar = el('div', 'h-2 flex-1 rounded-sm transition-all duration-150');
    bar.style.backgroundColor = '#374151';
    bar.style.opacity = '0.3';
    intensityBarsEl.appendChild(bar);
  }
  loadSection.appendChild(intensityBarsEl);
  hud.appendChild(loadSection);
  hud.appendChild(el('div', 'text-white/40 text-xs font-sans border-t border-white/10 pt-3', 'DUTCH ELECTRICAL GRID'));
  root.appendChild(hud);

  let time = 0;

  return {
    resize(width, height, pr) {
      renderer.setPixelRatio(pr);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    frame({ audio, settings: currentSettings, dt }) {
      time += dt * currentSettings.speed;

      const dataArray = audio.spectrum({ fftSize: 512, smoothing: 0.8 });
      const bufferLength = dataArray.length;

      const bass = dataArray.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
      const mid = dataArray.slice(4, 47).reduce((a, b) => a + b, 0) / 43;
      const treble = dataArray.slice(47, 186).reduce((a, b) => a + b, 0) / 139;

      // Update Map Group Scale
      mapGroup.scale.set(currentSettings.scale, currentSettings.scale, currentSettings.scale);

      // Slowly rotate the map
      mapGroup.rotation.z = Math.sin(time * 0.1) * 0.1;

      // Update Nodes
      nodes.forEach((node, i) => {
        const p = getPos(node.lon, node.lat);
        const freqIndex = Math.floor((node.id / nodes.length) * (bufferLength * 0.5));
        const val = dataArray[freqIndex] / 255;

        node.energy = node.energy * 0.8 + val * 0.2;

        const scale = (node.isMajor ? 4 : 2) + node.energy * 8 * currentSettings.sensitivity;

        dummy.position.set(p.x, p.y, node.energy * 20); // Elevate active nodes
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        nodesMesh.setMatrixAt(i, dummy.matrix);

        const baseHue = node.isMajor ? 170 : 30;
        const hue = (baseHue + currentSettings.hueShift) % 360;
        colorObj.setHSL(hue / 360, 0.8, 0.6 + node.energy * 0.4);
        nodesMesh.setColorAt(i, colorObj);
      });
      nodesMesh.instanceMatrix.needsUpdate = true;
      if (nodesMesh.instanceColor) nodesMesh.instanceColor.needsUpdate = true;

      // Spawn Particles
      if (bass * currentSettings.sensitivity > 150 && Math.random() > 0.5) {
        const edgeIdx = Math.floor(Math.random() * edges.length);
        const edge = edges[edgeIdx];
        const isFromMinor = !nodes[edge.from].isMajor;
        particles.push({
          edgeIndex: edgeIdx,
          progress: isFromMinor ? 0 : 1,
          direction: isFromMinor ? 1 : -1,
          speed: 0.01 * currentSettings.speed * (1 + bass/255),
          color: '#4ade80',
          type: 'return'
        });
      }

      if (treble * currentSettings.sensitivity > 100 && Math.random() > 0.3) {
        const validEdges = edges.map((e, i) => ({e, i})).filter(x => nodes[x.e.from].isMajor !== nodes[x.e.to].isMajor);
        if (validEdges.length > 0) {
          const {e, i} = validEdges[Math.floor(Math.random() * validEdges.length)];
          const isFromMajor = nodes[e.from].isMajor;
          particles.push({
            edgeIndex: i,
            progress: isFromMajor ? 0 : 1,
            direction: isFromMajor ? 1 : -1,
            speed: 0.02 * currentSettings.speed * (1 + treble/255),
            color: '#fb923c',
            type: 'consumption'
          });
        }
      }

      if (mid * currentSettings.sensitivity > 120 && Math.random() > 0.4) {
        const validEdges = edges.map((e, i) => ({e, i})).filter(x => !nodes[x.e.from].isMajor && !nodes[x.e.to].isMajor);
        if (validEdges.length > 0) {
          const {e, i} = validEdges[Math.floor(Math.random() * validEdges.length)];
          const direction = Math.random() > 0.5 ? 1 : -1;
          particles.push({
            edgeIndex: i,
            progress: direction === 1 ? 0 : 1,
            direction: direction,
            speed: 0.015 * currentSettings.speed * (1 + mid/255),
            color: '#60a5fa',
            type: 'distribution'
          });
        }
      }

      // Update Particles
      let pCount = 0;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.progress += p.speed * p.direction;

        if (p.progress < 0 || p.progress > 1 || pCount >= maxParticles) {
          particles.splice(i, 1);
          continue;
        }

        const edge = edges[p.edgeIndex];
        const n1 = nodes[edge.from];
        const n2 = nodes[edge.to];
        const p1 = getPos(n1.lon, n1.lat);
        const p2 = getPos(n2.lon, n2.lat);

        const x = p1.x + (p2.x - p1.x) * p.progress;
        const y = p1.y + (p2.y - p1.y) * p.progress;
        const z = (n1.energy * 20) + ((n2.energy * 20) - (n1.energy * 20)) * p.progress;

        dummy.position.set(x, y, z + 2); // Slightly above the line
        const pScale = p.type === 'return' ? 2.5 : 1.5;
        dummy.scale.set(pScale, pScale, pScale);
        dummy.updateMatrix();

        particlesMesh.setMatrixAt(pCount, dummy.matrix);
        colorObj.set(p.color);
        particlesMesh.setColorAt(pCount, colorObj);

        pCount++;
      }
      particlesMesh.count = pCount;
      particlesMesh.instanceMatrix.needsUpdate = true;
      if (particlesMesh.instanceColor) particlesMesh.instanceColor.needsUpdate = true;

      // Spawn Sparks
      if (bass * currentSettings.sensitivity > 170) {
        const numSparks = Math.floor((bass * currentSettings.sensitivity - 170) / 5);
        for (let i = 0; i < numSparks; i++) {
          const sourceNode = nodes[Math.floor(Math.random() * nodes.length)];
          const pos = getPos(sourceNode.lon, sourceNode.lat);
          const angle = Math.random() * Math.PI * 2;
          const speed = 20 + Math.random() * 30 * currentSettings.speed;
          const hue = (Math.random() > 0.5 ? 40 : 150) + currentSettings.hueShift + (Math.random() * 30 - 15);

          sparks.push({
            x: pos.x,
            y: pos.y,
            z: sourceNode.energy * 20,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            vz: 10 + Math.random() * 20, // Fly upwards
            life: 1.0,
            color: `hsl(${hue}, 100%, 60%)`,
            size: 2 + Math.random() * 3
          });
        }
      }

      // Update Sparks
      let sCount = 0;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const spark = sparks[i];

        spark.x += spark.vx * dt;
        spark.y += spark.vy * dt;
        spark.z += spark.vz * dt;
        spark.life -= dt * 0.5;

        if (spark.life <= 0 || sCount >= maxSparks) {
          sparks.splice(i, 1);
          continue;
        }

        sparkPositions[sCount * 3] = spark.x;
        sparkPositions[sCount * 3 + 1] = spark.y;
        sparkPositions[sCount * 3 + 2] = spark.z;

        colorObj.set(spark.color);
        sparkColors[sCount * 3] = colorObj.r * spark.life;
        sparkColors[sCount * 3 + 1] = colorObj.g * spark.life;
        sparkColors[sCount * 3 + 2] = colorObj.b * spark.life;

        sCount++;
      }
      sparkGeo.setDrawRange(0, sCount);
      sparkGeo.attributes.position.needsUpdate = true;
      sparkGeo.attributes.color.needsUpdate = true;

      // Compute intensity level (0-5 steps)
      const overallEnergy = (bass + mid + treble) / 3 * currentSettings.sensitivity;
      const intensitySteps = [
        { threshold: 0,   label: 'IDLE',     color: '#6b7280' },
        { threshold: 40,  label: 'LOW',      color: '#4ade80' },
        { threshold: 80,  label: 'MODERATE', color: '#facc15' },
        { threshold: 130, label: 'HIGH',     color: '#fb923c' },
        { threshold: 180, label: 'CRITICAL', color: '#ef4444' },
      ];
      let intensityLevel = 0;
      for (let i = intensitySteps.length - 1; i >= 0; i--) {
        if (overallEnergy >= intensitySteps[i].threshold) {
          intensityLevel = i;
          break;
        }
      }

      // Modulate visuals based on intensity level
      const intensityFactor = intensityLevel / (intensitySteps.length - 1); // 0..1
      edgeMat.opacity = 0.15 + intensityFactor * 0.55;
      mapMat.opacity = 0.1 + intensityFactor * 0.25;
      scene.fog = new THREE.FogExp2(0x021210, 0.002 - intensityFactor * 0.0012);


      // Update HUD
      const consumptionMW = Math.round(treble * 1000 * currentSettings.sensitivity);
      const returnMW = Math.round(bass * 1000 * currentSettings.sensitivity);
      const distributionMW = Math.round(mid * 1000 * currentSettings.sensitivity);

      consEl.innerText = consumptionMW.toString().padStart(4, ' ');
      retEl.innerText = returnMW.toString().padStart(4, ' ');
      distEl.innerText = distributionMW.toString().padStart(4, ' ');

      // Update intensity HUD
      const step = intensitySteps[intensityLevel];
      intensityLabelEl.innerText = step.label;
      intensityLabelEl.style.color = step.color;
      const bars = intensityBarsEl.children;
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i] as HTMLElement;
        if (i <= intensityLevel) {
          bar.style.backgroundColor = intensitySteps[Math.min(i, intensitySteps.length - 1)].color;
          bar.style.opacity = '1';
        } else {
          bar.style.backgroundColor = '#374151';
          bar.style.opacity = '0.3';
        }
      }

      renderer.render(scene, camera);
    },
    dispose() {
      mapGeo.dispose();
      mapMat.dispose();
      edgeGeo.dispose();
      edgeMat.dispose();
      nodeGeo.dispose();
      nodeMat.dispose();
      nodesMesh.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      particlesMesh.dispose();
      sparkGeo.dispose();
      sparkMat.map?.dispose();
      sparkMat.dispose();
      disposeRenderer(renderer);
      root.remove();
    },
  };
};

export default DutchGridWebGL;
