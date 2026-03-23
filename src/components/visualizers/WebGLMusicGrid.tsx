import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { geoMercator, geoContains } from 'd3-geo';
import { VisualizerSettings } from '../../types';
import netherlandsGeoJson from '../../data/Netherlands_gemeentes.json';

interface Props {
  stream: MediaStream;
  settings: VisualizerSettings;
}

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

export default function ThreeDEqualizer({ stream, settings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const consRef = useRef<HTMLSpanElement>(null);
  const retRef = useRef<HTMLSpanElement>(null);
  const distRef = useRef<HTMLSpanElement>(null);
  const intensityLabelRef = useRef<HTMLSpanElement>(null);
  const intensityBarsRef = useRef<HTMLDivElement>(null);

  const animationRef = useRef<number>();
  const audioCtxRef = useRef<AudioContext>();
  const analyserRef = useRef<AnalyserNode>();
  const sourceRef = useRef<MediaStreamAudioSourceNode>();
  const settingsRef = useRef(settings);

  // Network state
  const mapDataRef = useRef<any>(null);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const sparksRef = useRef<Spark[]>([]);
  const projectionRef = useRef<any>(null);

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    // Load local GeoJSON map data
    const geojson = netherlandsGeoJson as any;
    mapDataRef.current = geojson;

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
    nodesRef.current = nodes;
    edgesRef.current = edges;

    // Setup projection for a 1000x1000 logical area
    const proj = geoMercator().fitSize([1000, 1000], geojson);
    projectionRef.current = proj;

    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!containerRef.current || isLoading || !projectionRef.current) return;

    const container = containerRef.current;
    const w = container.clientWidth;
    const h = container.clientHeight;

    // --- Audio Setup ---
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

    // --- Three.js Setup ---
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x021210, 0.0015);

    const camera = new THREE.PerspectiveCamera(45, w / h, 1, 3000);
    // Tilted perspective view
    camera.position.set(0, -600, 600);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    const mapGroup = new THREE.Group();
    scene.add(mapGroup);

    const proj = projectionRef.current;
    const getPos = (lon: number, lat: number) => {
      const p = proj([lon, lat]) || [0, 0];
      return { x: p[0] - 500, y: -(p[1] - 500) };
    };

    // 1. Draw Map Borders
    const linePoints: number[] = [];
    mapDataRef.current.features.forEach((f: any) => {
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

    edgesRef.current.forEach(e => {
      const n1 = nodesRef.current[e.from];
      const n2 = nodesRef.current[e.to];
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
    const nodesMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, nodesRef.current.length);
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

    const resize = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    };
    window.addEventListener('resize', resize);

    let time = 0;
    let lastTime = performance.now();

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const currentSettings = settingsRef.current;
      time += dt * currentSettings.speed;

      analyser.getByteFrequencyData(dataArray);

      const bass = dataArray.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
      const mid = dataArray.slice(4, 47).reduce((a, b) => a + b, 0) / 43;
      const treble = dataArray.slice(47, 186).reduce((a, b) => a + b, 0) / 139;

      // Update Map Group Scale
      mapGroup.scale.set(currentSettings.scale, currentSettings.scale, currentSettings.scale);

      // Slowly rotate the map
      mapGroup.rotation.z = Math.sin(time * 0.1) * 0.1;

      // Update Nodes
      nodesRef.current.forEach((node, i) => {
        const p = getPos(node.lon, node.lat);
        const freqIndex = Math.floor((node.id / nodesRef.current.length) * (bufferLength * 0.5));
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
        const edgeIdx = Math.floor(Math.random() * edgesRef.current.length);
        const edge = edgesRef.current[edgeIdx];
        const isFromMinor = !nodesRef.current[edge.from].isMajor;
        particlesRef.current.push({
          edgeIndex: edgeIdx,
          progress: isFromMinor ? 0 : 1,
          direction: isFromMinor ? 1 : -1,
          speed: 0.01 * currentSettings.speed * (1 + bass/255),
          color: '#4ade80',
          type: 'return'
        });
      }

      if (treble * currentSettings.sensitivity > 100 && Math.random() > 0.3) {
        const validEdges = edgesRef.current.map((e, i) => ({e, i})).filter(x => nodesRef.current[x.e.from].isMajor !== nodesRef.current[x.e.to].isMajor);
        if (validEdges.length > 0) {
          const {e, i} = validEdges[Math.floor(Math.random() * validEdges.length)];
          const isFromMajor = nodesRef.current[e.from].isMajor;
          particlesRef.current.push({
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
        const validEdges = edgesRef.current.map((e, i) => ({e, i})).filter(x => !nodesRef.current[x.e.from].isMajor && !nodesRef.current[x.e.to].isMajor);
        if (validEdges.length > 0) {
          const {e, i} = validEdges[Math.floor(Math.random() * validEdges.length)];
          const direction = Math.random() > 0.5 ? 1 : -1;
          particlesRef.current.push({
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
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.progress += p.speed * p.direction;

        if (p.progress < 0 || p.progress > 1 || pCount >= maxParticles) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        const edge = edgesRef.current[p.edgeIndex];
        const n1 = nodesRef.current[edge.from];
        const n2 = nodesRef.current[edge.to];
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
          const sourceNode = nodesRef.current[Math.floor(Math.random() * nodesRef.current.length)];
          const pos = getPos(sourceNode.lon, sourceNode.lat);
          const angle = Math.random() * Math.PI * 2;
          const speed = 20 + Math.random() * 30 * currentSettings.speed;
          const hue = (Math.random() > 0.5 ? 40 : 150) + currentSettings.hueShift + (Math.random() * 30 - 15);

          sparksRef.current.push({
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
      for (let i = sparksRef.current.length - 1; i >= 0; i--) {
        const spark = sparksRef.current[i];

        spark.x += spark.vx * dt;
        spark.y += spark.vy * dt;
        spark.z += spark.vz * dt;
        spark.life -= dt * 0.5;

        if (spark.life <= 0 || sCount >= maxSparks) {
          sparksRef.current.splice(i, 1);
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

      if (consRef.current) consRef.current.innerText = consumptionMW.toString().padStart(4, ' ');
      if (retRef.current) retRef.current.innerText = returnMW.toString().padStart(4, ' ');
      if (distRef.current) distRef.current.innerText = distributionMW.toString().padStart(4, ' ');

      // Update intensity HUD
      const step = intensitySteps[intensityLevel];
      if (intensityLabelRef.current) {
        intensityLabelRef.current.innerText = step.label;
        intensityLabelRef.current.style.color = step.color;
      }
      if (intensityBarsRef.current) {
        const bars = intensityBarsRef.current.children;
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
      }

      renderer.render(scene, camera);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }

      mapGeo.dispose();
      mapMat.dispose();
      edgeGeo.dispose();
      edgeMat.dispose();
      nodeGeo.dispose();
      nodeMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      sparkGeo.dispose();
      sparkMat.dispose();
      renderer.dispose();

      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [stream, isLoading]);

  return (
    <div className="w-full h-full relative bg-[#021210]">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#021210] z-10">
          <div className="text-emerald-400 font-mono animate-pulse">Initializing 3D Grid Topology...</div>
        </div>
      )}

      <div ref={containerRef} className="w-full h-full absolute inset-0" />

      {/* HUD Overlay */}
      {!isLoading && (
        <div className="absolute top-6 left-6 bg-black/60 backdrop-blur-md border border-white/10 p-5 rounded-xl font-mono text-sm pointer-events-none shadow-2xl">
          <div className="text-orange-400 mb-2 flex justify-between w-48">
            <span>CONSUMPTION:</span>
            <span><span ref={consRef}>0</span> MW</span>
          </div>
          <div className="text-emerald-400 mb-2 flex justify-between w-48">
            <span>RETURN:</span>
            <span><span ref={retRef}>0</span> MW</span>
          </div>
          <div className="text-blue-400 mb-4 flex justify-between w-48">
            <span>DISTRIBUTION:</span>
            <span><span ref={distRef}>0</span> MW</span>
          </div>
          <div className="border-t border-white/10 pt-3 mb-3">
            <div className="flex justify-between items-center w-48 mb-2">
              <span className="text-white/60 text-xs">GRID LOAD:</span>
              <span ref={intensityLabelRef} className="text-xs font-bold" style={{ color: '#6b7280' }}>IDLE</span>
            </div>
            <div ref={intensityBarsRef} className="flex gap-1 w-48">
              <div className="h-2 flex-1 rounded-sm transition-all duration-150" style={{ backgroundColor: '#374151', opacity: 0.3 }} />
              <div className="h-2 flex-1 rounded-sm transition-all duration-150" style={{ backgroundColor: '#374151', opacity: 0.3 }} />
              <div className="h-2 flex-1 rounded-sm transition-all duration-150" style={{ backgroundColor: '#374151', opacity: 0.3 }} />
              <div className="h-2 flex-1 rounded-sm transition-all duration-150" style={{ backgroundColor: '#374151', opacity: 0.3 }} />
              <div className="h-2 flex-1 rounded-sm transition-all duration-150" style={{ backgroundColor: '#374151', opacity: 0.3 }} />
            </div>
          </div>
          <div className="text-white/40 text-xs font-sans border-t border-white/10 pt-3">
            DUTCH ELECTRICAL GRID
          </div>
        </div>
      )}
    </div>
  );
}
