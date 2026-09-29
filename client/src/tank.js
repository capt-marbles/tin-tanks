import * as THREE from 'three';
import { toon, toonBox, addOutline } from './materials.js';

const barrelGeo = new THREE.CylinderGeometry(0.13, 0.15, 1.6, 10);
const hatchGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.16, 12);
const wheelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.2, 10);

function starShape(outer, inner) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(ang) * r;
    const y = Math.sin(ang) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}
const starGeo = new THREE.ShapeGeometry(starShape(0.34, 0.15));

/**
 * A chunky cartoon tank. The barrel points along +x at rotation 0, so the
 * hull's rotation.y is set to -heading to match the server's angle convention.
 */
export function buildTank(paint) {
  const g = new THREE.Group();

  // Tracks with a few wheel bumps.
  for (const side of [-1, 1]) {
    const track = toonBox(2.7, 0.62, 0.6, 0x3a3a3a, 0, 0.31, side * 0.95);
    g.add(track);
    for (let i = -1; i <= 1; i++) {
      const wheel = new THREE.Mesh(wheelGeo, toon(0x6a6a6a));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(i * 0.85, 0.3, side * 1.26);
      g.add(wheel);
    }
  }

  const hull = toonBox(2.5, 0.75, 1.65, paint.hull, 0, 0.78, 0);
  g.add(hull);
  // Sloped front glacis for a bit of silhouette.
  const nose = toonBox(0.6, 0.55, 1.5, paint.hull, 1.45, 0.72, 0);
  nose.rotation.z = -0.35;
  g.add(nose);
  // Stowage on the back.
  g.add(toonBox(0.5, 0.35, 0.9, 0x8a7a5a, -1.15, 1.32, 0.2));
  g.add(toonBox(0.35, 0.4, 0.35, 0x5f6b3a, -1.1, 1.36, -0.5));

  const turret = toonBox(1.35, 0.6, 1.15, paint.accent, -0.1, 1.45, 0);
  g.add(turret);
  const hatch = new THREE.Mesh(hatchGeo, toon(paint.hull));
  hatch.position.set(-0.3, 1.82, 0);
  hatch.castShadow = true;
  addOutline(hatch, { x: 0.64, y: 0.16, z: 0.64 }, 0.05);
  g.add(hatch);

  const barrel = new THREE.Mesh(barrelGeo, toon(0x2f3236));
  barrel.rotation.z = -Math.PI / 2;
  barrel.position.set(1.3, 1.45, 0);
  barrel.castShadow = true;
  addOutline(barrel, { x: 0.3, y: 1.6, z: 0.3 }, 0.06);
  g.add(barrel);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.3, 10), toon(0x2f3236));
  muzzle.rotation.z = -Math.PI / 2;
  muzzle.position.set(2.0, 1.45, 0);
  addOutline(muzzle, { x: 0.38, y: 0.3, z: 0.38 }, 0.05);
  g.add(muzzle);

  const star = new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: 0xf6efdc }));
  star.rotation.x = -Math.PI / 2;
  star.position.set(0.25, 1.76, 0);
  g.add(star);

  return g;
}

/** Floating name plate + armour bar, drawn to a canvas sprite. */
export class Label {
  constructor(name, colorHex) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 80;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthTest: false, transparent: true }));
    this.sprite.scale.set(6.4, 2, 1);
    this.sprite.position.y = 3.6;
    this.sprite.renderOrder = 10;
    this.name = name;
    this.color = colorHex;
    this.hp = -1;
    this.draw(100);
  }

  draw(hp) {
    if (hp === this.hp) return;
    this.hp = hp;
    const c = this.ctx;
    c.clearRect(0, 0, 256, 80);
    c.font = 'bold 30px Impact, "Arial Black", sans-serif';
    c.textAlign = 'center';
    c.lineWidth = 6;
    c.strokeStyle = '#1b1a16';
    c.strokeText(this.name, 128, 36);
    c.fillStyle = this.color;
    c.fillText(this.name, 128, 36);
    // armour bar
    c.fillStyle = '#1b1a16';
    c.fillRect(48, 50, 160, 18);
    c.fillStyle = hp > 34 ? '#8fd34a' : '#e9542f';
    c.fillRect(51, 53, Math.max(0, 154 * (hp / 100)), 12);
    this.texture.needsUpdate = true;
  }
}
