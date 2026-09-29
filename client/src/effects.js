import * as THREE from 'three';

const sphereGeo = new THREE.SphereGeometry(1, 8, 6);
const ringGeo = new THREE.RingGeometry(0.6, 1, 24);

/** Fire-and-forget particles: sparks, smoke, flashes, shockwave rings. */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  spawn({ geometry = sphereGeo, color, x, y, z, vx = 0, vy = 0, vz = 0, life, size = 1, grow = 0, gravity = 0, flat = false, fade = true }) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(size);
    if (flat) mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);
    this.items.push({ mesh, vx, vy, vz, life, maxLife: life, grow, gravity, fade });
  }

  muzzleFlash(x, z, angle) {
    const y = 1.45;
    this.spawn({ color: 0xfff1a8, x, y, z, life: 0.08, size: 0.7, grow: 12 });
    this.spawn({ color: 0xffa62b, x, y, z, life: 0.12, size: 0.45, grow: 6 });
    for (let i = 0; i < 4; i++) {
      const a = angle + (Math.random() - 0.5) * 0.6;
      const s = 8 + Math.random() * 6;
      this.spawn({ color: 0xbfb8a8, x, y, z, vx: Math.cos(a) * s, vy: 2, vz: Math.sin(a) * s, life: 0.3, size: 0.25, grow: 1.5 });
    }
  }

  dustPuff(x, z) {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 3;
      this.spawn({ color: i % 2 ? 0xc9b48c : 0xa8977a, x, y: 0.8 + Math.random(), z, vx: Math.cos(a) * s, vy: 1.5 + Math.random() * 2, vz: Math.sin(a) * s, life: 0.45, size: 0.3, grow: 1.2 });
    }
  }

  sparks(x, z) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 4 + Math.random() * 8;
      this.spawn({ color: i % 3 ? 0xffd166 : 0xffffff, x, y: 1.2, z, vx: Math.cos(a) * s, vy: 3 + Math.random() * 5, vz: Math.sin(a) * s, life: 0.4, size: 0.16, gravity: 20 });
    }
    this.spawn({ color: 0xffe9a0, x, y: 1.2, z, life: 0.1, size: 0.8, grow: 8 });
  }

  explosion(x, z) {
    this.spawn({ color: 0xfff4c2, x, y: 1.2, z, life: 0.18, size: 1.5, grow: 25 });
    this.spawn({ geometry: ringGeo, color: 0xffd166, x, y: 0.15, z, life: 0.45, size: 1, grow: 30, flat: true });
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 9;
      const colors = [0xff8c1a, 0xffc22e, 0xe0452b];
      this.spawn({ color: colors[i % 3], x, y: 1, z, vx: Math.cos(a) * s, vy: 4 + Math.random() * 8, vz: Math.sin(a) * s, life: 0.6 + Math.random() * 0.4, size: 0.35 + Math.random() * 0.4, gravity: 18 });
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 2;
      this.spawn({ color: i % 2 ? 0x3d3a36 : 0x6b665f, x: x + Math.cos(a), y: 1 + Math.random(), z: z + Math.sin(a), vx: Math.cos(a) * s, vy: 2.5 + Math.random() * 2, vz: Math.sin(a) * s, life: 1.2 + Math.random() * 0.8, size: 0.6, grow: 2.2 });
    }
    // Scorch mark that lingers.
    this.spawn({ geometry: ringGeo, color: 0x2a2521, x, y: 0.02, z, life: 12, size: 2.6, flat: true, fade: true });
  }

  spawnFlash(x, z) {
    this.spawn({ geometry: ringGeo, color: 0xbfe8ff, x, y: 0.1, z, life: 0.6, size: 1, grow: 12, flat: true });
    this.spawn({ color: 0xffffff, x, y: 1.2, z, life: 0.3, size: 2, grow: -4 });
  }

  update(dt) {
    const keep = [];
    for (const it of this.items) {
      it.life -= dt;
      if (it.life <= 0) {
        this.scene.remove(it.mesh);
        it.mesh.material.dispose();
        continue;
      }
      it.vy -= it.gravity * dt;
      it.mesh.position.x += it.vx * dt;
      it.mesh.position.y = Math.max(0.05, it.mesh.position.y + it.vy * dt);
      it.mesh.position.z += it.vz * dt;
      if (it.grow) it.mesh.scale.addScalar(it.grow * dt).clampScalar(0.01, 100);
      if (it.fade) it.mesh.material.opacity = Math.min(1, it.life / it.maxLife * 1.5);
      keep.push(it);
    }
    this.items = keep;
  }
}
