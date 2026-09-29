import * as THREE from 'three';
import { MAP } from '@tin-tanks/shared/map';
import { toon, toonBox, addOutline, GRADIENT } from './materials.js';

const PX_PER_UNIT = 12;

/** Paint the ground: grass, dusty roads, craters and scorch marks. */
function groundTexture(map) {
  const canvas = document.createElement('canvas');
  canvas.width = map.width * PX_PER_UNIT;
  canvas.height = map.depth * PX_PER_UNIT;
  const ctx = canvas.getContext('2d');
  const u = PX_PER_UNIT;
  const rand = mulberry32(1944);

  ctx.fillStyle = '#7fae4c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Mottled grass patches.
  const greens = ['#8bbb55', '#74a344', '#93c25e', '#6f9c40'];
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = greens[i % greens.length];
    ctx.globalAlpha = 0.35;
    const r = (1 + rand() * 4) * u;
    ctx.beginPath();
    ctx.ellipse(rand() * canvas.width, rand() * canvas.height, r, r * (0.5 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Tufts of grass: little darker strokes.
  ctx.strokeStyle = '#5e8a35';
  ctx.lineWidth = 2;
  for (let i = 0; i < 2500; i++) {
    const x = rand() * canvas.width;
    const y = rand() * canvas.height;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 6, y - 4 - rand() * 6);
    ctx.stroke();
  }

  // Roads.
  for (const r of map.roads) {
    ctx.fillStyle = '#cdb489';
    ctx.fillRect(r.x * u, r.z * u, r.w * u, r.d * u);
  }
  for (const r of map.roads) {
    // Ragged edges.
    ctx.fillStyle = '#c1a67a';
    for (let i = 0; i < (r.w + r.d) * 2; i++) {
      const along = rand();
      const horizontal = r.w > r.d;
      const px = horizontal ? (r.x + along * r.w) * u : (r.x + (rand() < 0.5 ? -0.2 : r.w + 0.2)) * u;
      const py = horizontal ? (r.z + (rand() < 0.5 ? -0.2 : r.d + 0.2)) * u : (r.z + along * r.d) * u;
      ctx.beginPath();
      ctx.ellipse(px, py, u * 0.6, u * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Tyre ruts.
    ctx.strokeStyle = 'rgba(120,95,60,0.45)';
    ctx.lineWidth = 5;
    ctx.setLineDash([u * 1.5, u * 0.7]);
    const horizontal = r.w > r.d;
    for (const off of [-1.1, 1.1]) {
      ctx.beginPath();
      if (horizontal) {
        const y = (r.z + r.d / 2 + off) * u;
        ctx.moveTo(r.x * u, y); ctx.lineTo((r.x + r.w) * u, y);
      } else {
        const x = (r.x + r.w / 2 + off) * u;
        ctx.moveTo(x, r.z * u); ctx.lineTo(x, (r.z + r.d) * u);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Pebbles.
    for (let i = 0; i < r.w * r.d * 0.6; i++) {
      ctx.fillStyle = rand() < 0.5 ? '#b89c70' : '#d9c39c';
      ctx.beginPath();
      ctx.arc((r.x + rand() * r.w) * u, (r.z + rand() * r.d) * u, 1.5 + rand() * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Craters: dark bowl, lighter rim.
  for (const c of map.craters) {
    const g = ctx.createRadialGradient(c.x * u, c.z * u, 0, c.x * u, c.z * u, c.r * u);
    g.addColorStop(0, 'rgba(60,45,30,0.95)');
    g.addColorStop(0.6, 'rgba(90,70,45,0.8)');
    g.addColorStop(0.85, 'rgba(150,125,85,0.7)');
    g.addColorStop(1, 'rgba(150,125,85,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x * u, c.z * u, c.r * u, 0, Math.PI * 2);
    ctx.fill();
  }

  // Dirt aprons under buildings so they sit in the ground.
  for (const b of map.buildings) {
    if (b.kind === 'sandbags' || b.kind === 'crates') continue;
    ctx.fillStyle = 'rgba(120,100,65,0.35)';
    ctx.fillRect((b.x - 0.8) * u, (b.z - 0.8) * u, (b.w + 1.6) * u, (b.d + 1.6) * u);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function gableRoof(w, d, color, overhang = 0.5) {
  // Ridge runs along the longer axis.
  const alongX = w >= d;
  const span = (alongX ? d : w) + overhang * 2;
  const length = (alongX ? w : d) + overhang * 2;
  const rise = Math.min(span * 0.45, 3);
  const shape = new THREE.Shape();
  shape.moveTo(-span / 2, 0);
  shape.lineTo(span / 2, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  geo.center();
  const mesh = new THREE.Mesh(geo, toon(color));
  if (alongX) mesh.rotation.y = Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  addOutline(mesh, { x: span, y: rise, z: length });
  return { mesh, rise };
}

function windows(group, b, y, count, faceZ, tall = false) {
  const h = tall ? 1.6 : 0.9;
  for (let i = 0; i < count; i++) {
    const x = b.x + ((i + 1) * b.w) / (count + 1);
    const win = toonBox(0.8, h, 0.16, 0x2b3038, x, y, faceZ, false);
    win.castShadow = false;
    group.add(win);
    const sill = toonBox(1.0, 0.12, 0.3, 0xf2ead9, x, y - h / 2, faceZ, false);
    sill.castShadow = false;
    group.add(sill);
  }
}

function house(b) {
  const g = new THREE.Group();
  const cx = b.x + b.w / 2;
  const cz = b.z + b.d / 2;
  g.add(toonBox(b.w, b.h, b.d, b.wall, cx, b.h / 2, cz));
  const roof = gableRoof(b.w, b.d, b.roof);
  roof.mesh.position.set(cx, b.h + roof.rise / 2, cz);
  g.add(roof.mesh);
  // Chimney
  g.add(toonBox(0.7, 1.4, 0.7, 0x7a6a5a, cx + b.w * 0.3, b.h + roof.rise * 0.5 + 0.4, cz - b.d * 0.15));
  // Door on the south face + windows both sides.
  const door = toonBox(1.1, 1.9, 0.2, 0x5a3c26, cx - b.w * 0.25, 0.95, b.z + b.d, false);
  door.castShadow = false;
  g.add(door);
  windows(g, b, 2.3, Math.max(1, Math.round(b.w / 3)), b.z + b.d + 0.02);
  windows(g, b, 2.3, Math.max(1, Math.round(b.w / 3)), b.z - 0.02);
  return g;
}

function barn(b) {
  const g = new THREE.Group();
  const cx = b.x + b.w / 2;
  const cz = b.z + b.d / 2;
  g.add(toonBox(b.w, b.h, b.d, b.wall, cx, b.h / 2, cz));
  const roof = gableRoof(b.w, b.d, b.roof, 0.7);
  roof.mesh.position.set(cx, b.h + roof.rise / 2, cz);
  g.add(roof.mesh);
  // Big double door and white trim.
  const door = toonBox(3, 3.2, 0.2, 0x4a3323, cx, 1.6, b.z + b.d, false);
  door.castShadow = false;
  g.add(door);
  const trim = toonBox(3.3, 0.2, 0.22, 0xf2ead9, cx, 3.3, b.z + b.d, false);
  trim.castShadow = false;
  g.add(trim);
  const beam = toonBox(0.2, 3.2, 0.22, 0xf2ead9, cx, 1.6, b.z + b.d, false);
  beam.castShadow = false;
  g.add(beam);
  return g;
}

function church(b) {
  const g = new THREE.Group();
  const cx = b.x + b.w / 2;
  const cz = b.z + b.d / 2;
  g.add(toonBox(b.w, b.h, b.d, b.wall, cx, b.h / 2, cz));
  const roof = gableRoof(b.w, b.d, b.roof, 0.4);
  roof.mesh.position.set(cx, b.h + roof.rise / 2, cz);
  g.add(roof.mesh);
  // Bell tower at the south end.
  const tw = 3.6;
  const th = b.h + 5;
  const tz = b.z + b.d - tw / 2 - 0.2;
  g.add(toonBox(tw, th, tw, b.wall, cx, th / 2, tz));
  const spire = new THREE.Mesh(new THREE.ConeGeometry(tw * 0.75, 3.2, 4), toon(b.roof));
  spire.rotation.y = Math.PI / 4;
  spire.position.set(cx, th + 1.6, tz);
  spire.castShadow = true;
  addOutline(spire, { x: tw * 1.5, y: 3.2, z: tw * 1.5 });
  g.add(spire);
  g.add(toonBox(0.18, 1.4, 0.18, 0xf2ead9, cx, th + 3.9, tz, false));
  g.add(toonBox(0.8, 0.18, 0.18, 0xf2ead9, cx, th + 4.2, tz, false));
  // Tall windows on both long sides.
  for (let i = 0; i < 3; i++) {
    const z = b.z + ((i + 1) * (b.d - tw)) / 4;
    for (const x of [b.x - 0.02, b.x + b.w + 0.02]) {
      const win = toonBox(0.16, 2.2, 0.9, 0x3a3f60, x, 3.2, z, false);
      win.castShadow = false;
      g.add(win);
    }
  }
  const door = toonBox(1.4, 2.4, 0.2, 0x5a3c26, cx, 1.2, b.z + b.d, false);
  door.castShadow = false;
  g.add(door);
  return g;
}

function ruin(b) {
  const g = new THREE.Group();
  const t = 0.6;
  const cx = b.x + b.w / 2;
  const cz = b.z + b.d / 2;
  // Four broken walls of different heights.
  g.add(toonBox(t, b.h, b.d, b.wall, b.x + t / 2, b.h / 2, cz));
  g.add(toonBox(t, b.h * 0.65, b.d, b.wall, b.x + b.w - t / 2, (b.h * 0.65) / 2, cz));
  g.add(toonBox(b.w, b.h * 0.9, t, b.wall, cx, (b.h * 0.9) / 2, b.z + t / 2));
  g.add(toonBox(b.w * 0.4, b.h * 0.5, t, b.wall, b.x + b.w * 0.2, (b.h * 0.5) / 2, b.z + b.d - t / 2));
  g.add(toonBox(b.w * 0.25, b.h * 0.35, t, b.wall, b.x + b.w * 0.875, (b.h * 0.35) / 2, b.z + b.d - t / 2));
  // Rubble inside.
  const rand = mulberry32(b.x * 7 + b.z);
  for (let i = 0; i < 6; i++) {
    const s = 0.5 + rand() * 0.7;
    const r = toonBox(s, s * 0.6, s * 0.8, rand() < 0.5 ? 0x8b8375 : 0x7a4d3a, b.x + t + rand() * (b.w - 2 * t), s * 0.3, b.z + t + rand() * (b.d - 2 * t));
    r.rotation.y = rand() * Math.PI;
    g.add(r);
  }
  // Charred beam.
  const beam = toonBox(b.w * 0.7, 0.3, 0.3, 0x2f2a25, cx, 0.2, cz + 0.3);
  beam.rotation.y = 0.35;
  g.add(beam);
  return g;
}

function shed(b) {
  const g = new THREE.Group();
  const cx = b.x + b.w / 2;
  const cz = b.z + b.d / 2;
  g.add(toonBox(b.w, b.h, b.d, b.wall, cx, b.h / 2, cz));
  const roof = toonBox(b.w + 0.6, 0.3, b.d + 0.6, b.roof, cx, b.h + 0.15, cz);
  roof.rotation.x = 0.12;
  g.add(roof);
  const door = toonBox(1, 1.8, 0.2, 0x4a3323, cx, 0.9, b.z + b.d, false);
  door.castShadow = false;
  g.add(door);
  return g;
}

const bagGeo = new THREE.SphereGeometry(0.42, 10, 7);
function sandbags(b) {
  const g = new THREE.Group();
  const alongX = b.w >= b.d;
  const length = alongX ? b.w : b.d;
  const count = Math.round(length / 0.75);
  const mat = toon(0xc8b078);
  for (let layer = 0; layer < 2; layer++) {
    const n = count - layer;
    for (let i = 0; i < n; i++) {
      const along = ((i + 0.5 + layer * 0.5) / count) * length;
      const bag = new THREE.Mesh(bagGeo, mat);
      bag.scale.set(alongX ? 1 : 0.8, 0.55, alongX ? 0.8 : 1);
      bag.position.set(
        alongX ? b.x + along : b.x + b.w / 2,
        0.22 + layer * 0.42,
        alongX ? b.z + b.d / 2 : b.z + along,
      );
      bag.castShadow = true;
      bag.receiveShadow = true;
      addOutline(bag, { x: 0.84, y: 0.84, z: 0.84 }, 0.06);
      g.add(bag);
    }
  }
  return g;
}

function crates(b) {
  const g = new THREE.Group();
  const s = 1.1;
  const cx = b.x + b.w / 2;
  const cz = b.z + b.d / 2;
  const positions = [[-0.6, 0, -0.6], [0.6, 0, -0.6], [-0.6, 0, 0.6], [0.6, 0, 0.6], [0, 1, 0]];
  positions.forEach(([dx, dy, dz], i) => {
    const c = toonBox(s, s, s, i % 2 ? 0x9a7345 : 0xb08a55, cx + dx, s / 2 + dy * s, cz + dz);
    if (i === 4) c.rotation.y = 0.4;
    g.add(c);
    const strap = toonBox(s + 0.02, 0.12, s + 0.02, 0x5a3c26, 0, 0, 0, false);
    strap.castShadow = false;
    c.add(strap);
  });
  return g;
}

const BUILDERS = { house, barn, church, ruin, shed, sandbags, crates };

const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1.6, 7);
const leafGeo = new THREE.SphereGeometry(1, 9, 7);
function tree(t, i) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(trunkGeo, toon(0x6b4a2f));
  trunk.position.set(t.x, 0.8, t.z);
  trunk.castShadow = true;
  addOutline(trunk, { x: 0.7, y: 1.6, z: 0.7 }, 0.06);
  g.add(trunk);
  const shades = [0x3f7a2e, 0x4a8a35, 0x35692a];
  const blobs = [[0, 2.3, 0, 1.5], [0.7, 2.9, 0.3, 1.1], [-0.6, 3.0, -0.4, 1.0], [0.1, 3.7, 0.2, 0.9]];
  blobs.forEach(([dx, dy, dz, s], j) => {
    const leaf = new THREE.Mesh(leafGeo, toon(shades[(i + j) % shades.length]));
    leaf.position.set(t.x + dx, dy, t.z + dz);
    leaf.scale.setScalar(s);
    leaf.castShadow = true;
    addOutline(leaf, { x: 2, y: 2, z: 2 }, 0.08);
    g.add(leaf);
  });
  return g;
}

function hedgeRing(map) {
  const g = new THREE.Group();
  const h = 1.3;
  const t = 1.2;
  const c = 0x3f6b2a;
  g.add(toonBox(map.width + 2 * t, h, t, c, map.width / 2, h / 2, -t / 2));
  g.add(toonBox(map.width + 2 * t, h, t, c, map.width / 2, h / 2, map.depth + t / 2));
  g.add(toonBox(t, h, map.depth, c, -t / 2, h / 2, map.depth / 2));
  g.add(toonBox(t, h, map.depth, c, map.width + t / 2, h / 2, map.depth / 2));
  // Stone gate posts at the corners.
  for (const [x, z] of [[0, 0], [map.width, 0], [0, map.depth], [map.width, map.depth]]) {
    g.add(toonBox(1.6, 2.2, 1.6, 0x9a9384, x, 1.1, z));
  }
  return g;
}

export function buildWorld(scene, map = MAP) {
  // Ground inside the map, plus a big surround so the edges never show the void.
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), toon(0x5f8a3c));
  surround.rotation.x = -Math.PI / 2;
  surround.position.set(map.width / 2, -0.05, map.depth / 2);
  surround.receiveShadow = true;
  scene.add(surround);

  const groundMat = new THREE.MeshToonMaterial({ map: groundTexture(map), gradientMap: GRADIENT });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(map.width, map.depth), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(map.width / 2, 0, map.depth / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  const statics = new THREE.Group();
  for (const b of map.buildings) statics.add(BUILDERS[b.kind](b));
  map.trees.forEach((t, i) => statics.add(tree(t, i)));
  statics.add(hedgeRing(map));
  scene.add(statics);

  // Lighting: warm sun with shadows, blue-ish sky fill.
  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x8a9a5b, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  return { sun };
}

/** Deterministic PRNG so the ground looks the same for everyone. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
