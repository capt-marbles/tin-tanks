import * as THREE from 'three';

// Four-band toon ramp gives the flat, cel-shaded cartoon look.
const ramp = new Uint8Array([90, 150, 210, 255]);
export const GRADIENT = new THREE.DataTexture(ramp, ramp.length, 1, THREE.RedFormat);
GRADIENT.minFilter = THREE.NearestFilter;
GRADIENT.magFilter = THREE.NearestFilter;
GRADIENT.needsUpdate = true;

export const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x1b1a16, side: THREE.BackSide });

const cache = new Map();
export function toon(color) {
  if (!cache.has(color)) {
    cache.set(color, new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT }));
  }
  return cache.get(color);
}

/**
 * Cartoon outline via an inverted hull: a slightly larger copy of the mesh
 * drawn with back faces only. `size` is the mesh's extent so the outline is
 * a constant ~thickness in world units regardless of object size.
 */
export function addOutline(mesh, size, thickness = 0.09) {
  const hull = new THREE.Mesh(mesh.geometry, OUTLINE_MAT);
  hull.scale.set(1 + (thickness * 2) / size.x, 1 + (thickness * 2) / size.y, 1 + (thickness * 2) / size.z);
  mesh.add(hull);
  return hull;
}

/** Box mesh with toon material, outline and shadows, centred at (x, y, z). */
export function toonBox(w, h, d, color, x = 0, y = 0, z = 0, outline = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (outline) addOutline(mesh, { x: w, y: h, z: d });
  return mesh;
}
