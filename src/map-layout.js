import { CABIN_BLUEPRINTS, cabinBounds } from './cabins.js';

export const CHUNK = 48;
export const GRID_MIN = -7;
export const GRID_MAX = 6;
export const WORLD_MIN = GRID_MIN * CHUNK; // -336
export const WORLD_MAX = (GRID_MAX + 1) * CHUNK; // +336
export const START = { x: 0, z: 20 };
export const ANTENNA = { x: 24, z: -268, name: 'Blackwater Radio Tower', radius: 12 };

export const RADIO_PARTS = [
  { id: 'part:transceiver', kind: 'radioPart', name: 'Transceiver Core', icon: '◈', color: '#7ee6a8' },
  { id: 'part:battery', kind: 'radioPart', name: 'High-Cap Battery', icon: '⚡', color: '#9ee884' },
  { id: 'part:coil', kind: 'radioPart', name: 'Antenna Coil', icon: '◎', color: '#78d8e8' },
  { id: 'part:handset', kind: 'radioPart', name: 'Field Handset', icon: '☎', color: '#e8d482' },
  { id: 'part:amp', kind: 'radioPart', name: 'Signal Amplifier', icon: '▲', color: '#f2a46f' },
  { id: 'part:relay', kind: 'radioPart', name: 'Power Relay', icon: '❖', color: '#d7a2f0' },
];

// 20 fixed large single-floor cabin sites distributed across the 672m x 672m forest.
const CABIN_POSITIONS = [
  [-210, -240], [-105, -245], [135, -240], [235, -225],
  [-245, -140], [-125, -135], [-10, -145], [115, -130], [235, -120],
  [-235, -20], [-115, -25], [115, -20], [235, -15],
  [-240, 105], [-115, 110], [110, 105], [230, 110],
  [-180, 225], [-45, 225], [160, 225],
];

export const CABIN_SITES = CABIN_POSITIONS.map(([x, z], index) => {
  const bp = CABIN_BLUEPRINTS[index];
  const bounds = cabinBounds({ layout: index });
  return {
    id: `cabin:${index}`,
    index,
    name: bp.name,
    layout: index,
    palette: index % 5,
    x,
    z,
    cx: Math.floor(x / CHUNK),
    cz: Math.floor(z / CHUNK),
    halfW: bounds.halfW,
    halfD: bounds.halfD,
    radius: bounds.radius,
    lantern: index % 2 === 0,
  };
});

// Connected road & dirt-track segments linking START, all 20 cabins, and the Antenna Tower.
export const ROAD_SEGMENTS = [
  // Main north-south spine (through START to ANTENNA)
  [0, 250, 0, -268],
  // East-west trunk roads
  [-245, -240, 235, -240],
  [-245, -135, 235, -135],
  [-235, -20, 235, -20],
  [-240, 105, 230, 105],
  [-180, 225, 160, 225],
  // Outer north-south forest loops
  [-240, -240, -240, 225],
  [235, -240, 235, 225],
  [-115, -245, -115, 225],
  [115, -240, 115, 225],
  // Spur to Antenna
  [0, -268, ANTENNA.x, ANTENNA.z],
  // Short cabin spurs
  ...CABIN_SITES.map(s => [s.x, s.z + s.halfD + 4, s.x, Math.round(s.z / 115) * 115]),
];

// Which 6 spread-out cabins hold the 6 Radio Parts (cover NW, NE, W, E, SW, SE quadrants)
export const PART_CABIN_INDICES = [0, 3, 9, 12, 17, 19];

export function segmentDistance(x, z, [ax, az, bx, bz]) {
  const vx = bx - ax, vz = bz - az;
  const len2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2));
  return Math.hypot(x - (ax + vx * t), z - (az + vz * t));
}

export function roadDistance(x, z) {
  let best = Infinity;
  for (const seg of ROAD_SEGMENTS) {
    const d = segmentDistance(x, z, seg);
    if (d < best) best = d;
  }
  return best;
}

export function insideBounds(x, z, margin = 4) {
  return x >= WORLD_MIN + margin && x <= WORLD_MAX - margin && z >= WORLD_MIN + margin && z <= WORLD_MAX - margin;
}

export function cabinAt(x, z, pad = 2) {
  for (const site of CABIN_SITES) {
    if (Math.abs(x - site.x) <= site.halfW + pad && Math.abs(z - site.z) <= site.halfD + pad) return site;
  }
  return null;
}

export function inChunk(site, cx, cz) {
  return site.cx === cx && site.cz === cz;
}

export const CABIN_LOOT_PLAN = new Map([
  // 6 Radio Part cabins
  [0, { primary: RADIO_PARTS[0], supply: ['ammo', 'battery', 'armor1'] }],
  [3, { primary: RADIO_PARTS[1], supply: ['ammo', 'lens', 'flareAmmo'] }],
  [9, { primary: RADIO_PARTS[2], supply: ['ammo', 'damage', 'armor2'] }],
  [12, { primary: RADIO_PARTS[3], supply: ['ammo', 'reload', 'battery'] }],
  [17, { primary: RADIO_PARTS[4], supply: ['ammo', 'capacity', 'armor2'] }],
  [19, { primary: RADIO_PARTS[5], supply: ['ammo', 'pierce', 'armor3'] }],
  // Other 14 cabins: weapons, upgrades, armor, and supplies
  [1, { primary: 'shotgun', supply: ['ammo', 'battery', 'flareAmmo'] }],
  [2, { primary: 'armor1', supply: ['ammo', 'damage', 'reload'] }],
  [4, { primary: 'smg', supply: ['ammo', 'capacity', 'lens'] }],
  [5, { primary: 'battery', supply: ['ammo', 'flareAmmo', 'damage'] }],
  [6, { primary: 'carbine', supply: ['armor2', 'ammo', 'pierce'] }],
  [7, { primary: 'lens', supply: ['ammo', 'reload', 'flareAmmo'] }],
  [8, { primary: 'armor2', supply: ['ammo', 'battery', 'capacity'] }],
  [10, { primary: 'flaregun', supply: ['flareAmmo', 'ammo', 'damage'] }],
  [11, { primary: 'pierce', supply: ['ammo', 'armor1', 'reload'] }],
  [13, { primary: 'damage', supply: ['ammo', 'battery', 'flareAmmo'] }],
  [14, { primary: 'smg', supply: ['ammo', 'capacity', 'armor2'] }],
  [15, { primary: 'carbine', supply: ['ammo', 'pierce', 'lens'] }],
  [16, { primary: 'armor3', supply: ['ammo', 'damage', 'battery'] }],
  [18, { primary: 'shotgun', supply: ['ammo', 'reload', 'capacity'] }],
]);
