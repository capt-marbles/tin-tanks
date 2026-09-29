// A bombed-out crossroads village. World origin is the top-left corner
// (x grows to the right, z grows "down" the screen).
//
// Every solid uses an axis-aligned box: { x, z, w, d } is the footprint,
// h is the height for rendering. `kind` picks the client-side model.

export const MAP = Object.freeze({
  width: 120,
  depth: 80,

  // Roads are purely cosmetic (drawn into the ground texture).
  roads: [
    { x: 0, z: 37, w: 120, d: 6 },   // east-west high street
    { x: 57, z: 0, w: 6, d: 80 },    // north-south lane
  ],

  // Solid cover. Tanks and shells cannot pass through these.
  buildings: [
    // North-west quarter
    { kind: 'house', x: 18, z: 14, w: 8, d: 6, h: 4, wall: 0xe8d9b5, roof: 0x9b3b2e },
    { kind: 'barn', x: 34, z: 8, w: 10, d: 7, h: 5, wall: 0xa53d2f, roof: 0x4a3a2c },
    { kind: 'house', x: 44, z: 22, w: 7, d: 7, h: 4, wall: 0xb56a4a, roof: 0x5a5f66 },
    { kind: 'ruin', x: 26, z: 26, w: 8, d: 5, h: 2.4, wall: 0x9c9384 },
    // North-east quarter
    { kind: 'house', x: 70, z: 12, w: 8, d: 6, h: 4, wall: 0xe3cfa3, roof: 0x7a4a34 },
    { kind: 'church', x: 86, z: 14, w: 10, d: 16, h: 8, wall: 0xd8cfbf, roof: 0x5c6670 },
    { kind: 'house', x: 100, z: 26, w: 7, d: 6, h: 4, wall: 0xcfa27a, roof: 0x8c3b2f },
    { kind: 'ruin', x: 72, z: 26, w: 6, d: 6, h: 2.2, wall: 0xa39a8b },
    // South-west quarter
    { kind: 'house', x: 14, z: 52, w: 8, d: 7, h: 4, wall: 0xf0e2c2, roof: 0x6f4a3b },
    { kind: 'barn', x: 30, z: 60, w: 14, d: 8, h: 5, wall: 0x7d6b52, roof: 0x3e342a },
    { kind: 'house', x: 46, z: 48, w: 7, d: 6, h: 4, wall: 0xd4b48c, roof: 0x9b3b2e },
    { kind: 'shed', x: 48, z: 64, w: 5, d: 5, h: 3, wall: 0x8a7a5a, roof: 0x4a3a2c },
    // South-east quarter
    { kind: 'house', x: 68, z: 50, w: 8, d: 6, h: 4, wall: 0xe8d9b5, roof: 0x5a5f66 },
    { kind: 'house', x: 84, z: 58, w: 9, d: 7, h: 4.5, wall: 0xc48c66, roof: 0x7a4a34 },
    { kind: 'ruin', x: 100, z: 50, w: 7, d: 6, h: 2.6, wall: 0x968d7e },
    { kind: 'barn', x: 96, z: 64, w: 10, d: 7, h: 5, wall: 0xa53d2f, roof: 0x4a3a2c },
    // Sandbag nests around the crossroads: low cover that still stops shells.
    { kind: 'sandbags', x: 51, z: 32.5, w: 5, d: 1.4, h: 1 },
    { kind: 'sandbags', x: 64, z: 32.5, w: 5, d: 1.4, h: 1 },
    { kind: 'sandbags', x: 51, z: 46.1, w: 5, d: 1.4, h: 1 },
    { kind: 'sandbags', x: 64, z: 46.1, w: 5, d: 1.4, h: 1 },
    { kind: 'sandbags', x: 20, z: 38, w: 1.4, d: 5, h: 1 },
    { kind: 'sandbags', x: 98.6, z: 38, w: 1.4, d: 5, h: 1 },
    // Supply crates
    { kind: 'crates', x: 12, z: 30, w: 2.4, d: 2.4, h: 1.6 },
    { kind: 'crates', x: 106, z: 46, w: 2.4, d: 2.4, h: 1.6 },
    { kind: 'crates', x: 58.8, z: 8, w: 2.4, d: 2.4, h: 1.6 },
    { kind: 'crates', x: 58.8, z: 70, w: 2.4, d: 2.4, h: 1.6 },
  ],

  // Trees block movement and shells with a small circle. {x, z, r}
  trees: [
    { x: 8, z: 20, r: 0.9 }, { x: 30, z: 18, r: 0.9 }, { x: 52, z: 12, r: 0.9 },
    { x: 66, z: 6, r: 0.9 }, { x: 82, z: 6, r: 0.9 }, { x: 112, z: 18, r: 0.9 },
    { x: 108, z: 34, r: 0.9 }, { x: 6, z: 44, r: 0.9 }, { x: 24, z: 46, r: 0.9 },
    { x: 40, z: 74, r: 0.9 }, { x: 72, z: 70, r: 0.9 }, { x: 80, z: 44, r: 0.9 },
    { x: 112, z: 60, r: 0.9 }, { x: 90, z: 74, r: 0.9 }, { x: 36, z: 40, r: 0.9 },
    { x: 84, z: 36, r: 0.9 },
  ],

  // Decorative only.
  craters: [
    { x: 40, z: 34, r: 2.2 }, { x: 78, z: 40, r: 1.8 }, { x: 60, z: 24, r: 2.5 },
    { x: 22, z: 66, r: 2 }, { x: 96, z: 12, r: 1.6 }, { x: 60, z: 56, r: 2.2 },
    { x: 10, z: 12, r: 1.4 }, { x: 110, z: 70, r: 1.7 },
  ],

  spawns: [
    { x: 6, z: 6 },
    { x: 114, z: 6 },
    { x: 6, z: 74 },
    { x: 114, z: 74 },
  ],
});

/** Everything a tank or shell can collide with, as axis-aligned boxes. */
export function solidBoxes(map = MAP) {
  const boxes = map.buildings.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d }));
  for (const t of map.trees) {
    boxes.push({ x: t.x - t.r, z: t.z - t.r, w: t.r * 2, d: t.r * 2 });
  }
  return boxes;
}
