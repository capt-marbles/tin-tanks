// Rules shared by server (authoritative) and client (prediction + rendering).
// Units are metres; a tank is roughly 2.6m long.

export const TICK_RATE = 30;          // server simulation ticks per second
export const DT = 1 / TICK_RATE;
export const MAX_PLAYERS = 4;

export const TANK_SPEED = 6.75;       // m/s (was 9; whole game slowed 25% for less twitch)
export const TANK_TURN_RATE = 7.5;    // rad/s, how fast the hull swings to face travel direction
export const TANK_RADIUS = 1.1;       // collision circle
export const TANK_HP = 100;

export const BULLET_SPEED = 22.5;     // m/s
export const BULLET_RADIUS = 0.3;
export const BULLET_LIFE = 2.13;      // seconds before a shell fizzles out (range unchanged at ~48 m)
export const BULLET_DAMAGE = 34;      // three hits to a kill
export const FIRE_COOLDOWN = 0.65;    // seconds between shots
export const MUZZLE_OFFSET = 1.9;     // distance from hull centre to barrel tip

export const RESPAWN_TIME = 3;        // seconds
export const SNAPSHOT_EVERY = 1;      // broadcast a snapshot every N ticks
export const ROUND_TIME = 180;
export const WIN_SCORE = 10;
export const INTERMISSION = 8;
export const SPAWN_SHIELD = 1.5;

// Input bitmask sent from client to server.
export const INPUT = Object.freeze({
  UP: 1,
  DOWN: 2,
  LEFT: 4,
  RIGHT: 8,
  FIRE: 16,
});

// One paint scheme per player slot: hull colour, turret/roof accent, display name.
export const TANK_PAINT = Object.freeze([
  { hull: 0x8aa650, accent: 0x657f3a, name: 'Olive' },
  { hull: 0xe0b35f, accent: 0xb38a43, name: 'Desert' },
  { hull: 0x79a5bf, accent: 0x567f96, name: 'Steel' },
  { hull: 0xd57c60, accent: 0xa65540, name: 'Rust' },
]);
