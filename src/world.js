import { buildCabinSite } from './cabins.js';
import { DRESSING, dress } from './dressing.js';
import {
  ANTENNA, CABIN_LOOT_PLAN, CABIN_SITES, CHUNK, GRID_MAX, GRID_MIN,
  insideBounds, roadDistance, START, WORLD_MAX, WORLD_MIN,
} from './map-layout.js';

export { CHUNK, START };
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const direction = yaw => ({ x: Math.sin(yaw), z: -Math.cos(yaw) });

export function hash(value) {
  let h = 2166136261;
  for (const char of String(value)) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function random(seed) {
  let state = hash(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function rayBox(origin, ray, box, max) {
  if (box.slope) {
    const c = Math.cos(box.slope), s = Math.sin(box.slope), x = origin.x - box.x, y = origin.y - box.y;
    return rayBox(
      { x: x * c + y * s, y: y * c - x * s, z: origin.z - box.z },
      { x: ray.x * c + ray.y * s, y: ray.y * c - ray.x * s, z: ray.z },
      { x: 0, y: 0, z: 0, rx: box.rx, ry: box.ry, rz: box.rz }, max,
    );
  }
  let near = 0, far = max;
  for (const axis of ['x', 'y', 'z']) {
    const lo = box[axis] - box['r' + axis];
    const hi = box[axis] + box['r' + axis];
    if (Math.abs(ray[axis]) < 1e-7) {
      if (origin[axis] < lo || origin[axis] > hi) return Infinity;
      continue;
    }
    const first = (lo - origin[axis]) / ray[axis];
    const last = (hi - origin[axis]) / ray[axis];
    near = Math.max(near, Math.min(first, last));
    far = Math.min(far, Math.max(first, last));
    if (near > far) return Infinity;
  }
  return near;
}

function rayTrunk(origin, ray, trunk, max) {
  const dx = origin.x - trunk.x, dz = origin.z - trunk.z;
  const a = ray.x ** 2 + ray.z ** 2;
  const b = dx * ray.x + dz * ray.z;
  const c = dx * dx + dz * dz - trunk.r ** 2;
  const d = b * b - a * c;
  if (a < 1e-7 || d < 0 || (b > 0 && c > 0)) return Infinity;
  const near = Math.max(0, (-b - Math.sqrt(d)) / a);
  const far = Math.min(max, (-b + Math.sqrt(d)) / a);
  return near > far ? Infinity : near;
}

export function createWorld(seed = 'last-night') {
  const phase = hash(seed) % 1000 / 100;
  const chunks = new Map();
  const cabinIndex = new Map();

  const rawHeight = (x, z) => {
    const broad = Math.sin(x * .009 + phase) * Math.cos(z * .010 + phase * .6) * 2.2
      + Math.sin((x + z) * .0055 - phase) * 1.3;
    const local = Math.sin(x * .038 - phase * .7) * Math.sin(z * .042 + phase * .4) * .42;
    return broad + local;
  };

  // Precompute level pad elevations for all 20 cabins + Antenna clearing so floors sit flat.
  const pads = [
    ...CABIN_SITES.map(s => ({ x: s.x, z: s.z, hw: s.halfW + 1.5, hd: s.halfD + 1.5, y: rawHeight(s.x, s.z) })),
    { x: ANTENNA.x, z: ANTENNA.z, hw: 7, hd: 7, y: rawHeight(ANTENNA.x, ANTENNA.z) },
    { x: START.x, z: START.z, hw: 8, hd: 8, y: rawHeight(START.x, START.z) },
  ];

  const height = (x, z) => {
    let base = rawHeight(x, z);
    for (const pad of pads) {
      const dx = Math.max(0, Math.abs(x - pad.x) - pad.hw);
      const dz = Math.max(0, Math.abs(z - pad.z) - pad.hd);
      const d = Math.hypot(dx, dz);
      if (d < 5.5) {
        const t = d / 5.5;
        const blend = t * t * (3 - 2 * t);
        base = pad.y * (1 - blend) + base * blend;
      }
    }
    return base;
  };

  const sample = (x, z) => height(x, z);
  const density = (x, z) => clamp(.44 + Math.sin(x * .017 + phase) * .25 + Math.cos(z * .019 - phase * .5) * .25, .15, .95);
  const region = (x, z) => (density(x, z) < .30 ? 'clearing' : density(x, z) > .76 ? 'ridge' : 'woods');

  const makeChunk = (cx, cz) => {
    const key = cx + ',' + cz;
    const left = cx * CHUNK, top = cz * CHUNK;
    const rng = random(seed + ':chunk:' + key);
    const outOfBounds = cx < GRID_MIN || cx > GRID_MAX || cz < GRID_MIN || cz > GRID_MAX;
    const area = {
      key, cx, cz, left, top, biome: outOfBounds ? 'ridge' : region(left + CHUNK / 2, top + CHUNK / 2),
      trees: [], plants: [], props: [], colliders: [], lights: [], markers: [],
      loot: [], buildings: [], entrances: [],
    };
    const sites = [];

    const box = (x, z, w, h, d, base = height(x, z) - .14, kind = 'stone', tint = null) => {
      const item = { x, z, y: base + h / 2, rx: w / 2, ry: h / 2, rz: d / 2, kind, tint };
      area.colliders.push(item);
      area.props.push(item);
      return item;
    };

    const addLoot = (id, x, z, kind, amount = 0, name = '') => {
      area.loot.push({ id, x, z, kind, amount, name, unlock: 0 });
    };

    // Place cabins whose center lies in this chunk
    for (const site of CABIN_SITES) {
      if (site.cx !== cx || site.cz !== cz) continue;
      sites.push({ x: site.x, z: site.z, r: site.radius + 3.5 });
      const cabin = buildCabinSite(site, area, height, box);
      cabinIndex.set(cabin.id, cabin);
      area.markers.push({ x: site.x - 2.1, z: site.z + site.halfD + 3.6 });

      const plan = CABIN_LOOT_PLAN.get(site.index);
      if (plan) {
        const pSpot = cabin.primarySpots[0] || { x: site.x, z: site.z };
        if (typeof plan.primary === 'object') {
          addLoot(plan.primary.id, pSpot.x, pSpot.z, 'radioPart', 0, plan.primary.name);
        } else {
          addLoot(`${site.id}:primary`, pSpot.x, pSpot.z, plan.primary, plan.primary === 'ammo' ? 16 : 0);
        }
        plan.supply.forEach((kind, i) => {
          const spot = cabin.supplySpots[i % cabin.supplySpots.length] || cabin.primarySpots.at(-1) || pSpot;
          const amount = kind === 'ammo' ? 14 : kind === 'flareAmmo' ? 4 : 0;
          addLoot(`${site.id}:sup:${i}`, spot.x, spot.z, kind, amount);
        });
      }
    }

    // Antenna Tower Extraction Site
    if (cx === Math.floor(ANTENNA.x / CHUNK) && cz === Math.floor(ANTENNA.z / CHUNK)) {
      sites.push({ x: ANTENNA.x, z: ANTENNA.z, r: 10.5 });
      const y = height(ANTENNA.x, ANTENNA.z) - 0.1;
      // Concrete pad, radio console shack, and tall steel mast legs + crossbars
      box(ANTENNA.x, ANTENNA.z, 3.6, 0.25, 3.6, y, 'districtFloor', 0x45494b);
      box(ANTENNA.x - 1.0, ANTENNA.z, 0.9, 1.05, 0.65, y + 0.25, 'districtCrate', 0x4f5b52);
      for (const [ox, oz] of [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]]) {
        box(ANTENNA.x + ox, ANTENNA.z + oz, 0.22, 13.5, 0.22, y + 0.25, 'districtPost', 0x6c7378);
      }
      for (const hStep of [3.2, 6.5, 9.8, 13.0]) {
        box(ANTENNA.x, ANTENNA.z, 1.8, 0.16, 1.8, y + hStep, 'districtTrim', 0x7b8084);
      }
      area.lights.push({
        type: 'beacon', x: ANTENNA.x, y: y + 14.0, z: ANTENNA.z,
        ray: { x: 0, y: -1, z: 0 }, radius: 22, angle: 1.15,
      });
      area.lights.push({
        type: 'lantern', x: ANTENNA.x - 1.0, y: y + 2.2, z: ANTENNA.z + 0.6,
        ray: { x: 0, y: -0.9, z: -0.44 }, radius: 9, angle: 0.85,
      });
    }

    // Starting clearing wreck & starter supply
    if (cx === Math.floor(START.x / CHUNK) && cz === Math.floor(START.z / CHUNK)) {
      sites.push({ x: START.x, z: START.z, r: 9 });
      sites.push({ x: 4.5, z: 9.0, r: 4.5 });
      const wx = 4.5, wz = 9.0, wy = height(wx, wz) - 0.14;
      box(wx, wz, 2.05, 1.45, 4.15, wy, 'wreck');
      area.lights.push({ type: 'wreck', x: wx - 0.64, y: wy + 0.73, z: wz + 1.95, ray: { x: -0.02, y: -0.13, z: 0.99 }, radius: 18, angle: 0.62 });
      area.lights.push({ type: 'wreck', x: wx + 0.64, y: wy + 0.73, z: wz + 1.95, ray: { x: 0.02, y: -0.13, z: 0.99 }, radius: 18, angle: 0.62 });
      addLoot('start:ammo', 2.4, 10.6, 'ammo', 12);
    }

    // Roadside camps / wrecks on interior chunks
    if (!outOfBounds && !area.buildings.length && rng() < 0.28) {
      const rx = left + 10 + rng() * 28, rz = top + 10 + rng() * 28;
      if (distance(START, { x: rx, z: rz }) > 22 && distance(ANTENNA, { x: rx, z: rz }) > 18 && roadDistance(rx, rz) > 6) {
        sites.push({ x: rx, z: rz, r: 7.5 });
        const kind = rng() < 0.45 ? 'wreck' : 'rocks';
        const ry = height(rx, rz) - 0.14;
        if (kind === 'wreck') {
          box(rx, rz, 2.05, 1.45, 4.15, ry, 'wreck');
          addLoot(`wreck:${key}`, rx - 1.6, rz + 0.8, rng() < 0.6 ? 'ammo' : 'flareAmmo', 8);
        } else {
          for (let i = 0; i < 4; i++) {
            const px = rx + (i % 2 ? 1 : -1) * (1.2 + rng()), pz = rz + (i - 1.5) * 2.1;
            const sz = 0.85 + rng() * 1.1;
            box(px, pz, sz * 1.5, sz * 1.1, sz * 1.2);
          }
          addLoot(`rocks:${key}`, rx, rz - 2.4, rng() < 0.5 ? 'ammo' : 'reload', 8);
        }
      }
    }

    // Dense forest trees (extra dense outside playable map boundary as natural wall)
    const treeAttempts = outOfBounds ? 185 : area.biome === 'clearing' ? 76 : 148;
    for (let i = 0; i < treeAttempts; i++) {
      const x = left + 1.6 + rng() * (CHUNK - 3.2);
      const z = top + 1.6 + rng() * (CHUNK - 3.2);
      const thick = density(x, z);
      const roll = rng();
      const elder = roll < 0.08 + thick * 0.07;
      const r = elder ? 0.65 + rng() * 0.36 : roll > 0.82 ? 0.12 + rng() * 0.11 : 0.21 + rng() * 0.35;
      if (!outOfBounds && roadDistance(x, z) < 3.0) continue;
      if (Math.hypot(x - START.x, z - START.z) < 8.5) continue;
      if (!outOfBounds && rng() > 0.43 + thick * 0.52) continue;
      if (sites.some(s => Math.hypot(x - s.x, z - s.z) < s.r)) continue;
      if (CABIN_SITES.some(s => Math.abs(x - s.x) < s.halfW + 3.2 && Math.abs(z - s.z) < s.halfD + 3.2)) continue;
      if (area.trees.some(t => Math.hypot(x - t.x, z - t.z) < Math.max(1.85, r + t.r + 1.05))) continue;

      const type = Math.floor(rng() * 4);
      const heightScale = elder ? 12.5 + rng() * 4.5 : 4.8 + r * 12 + rng() * 3.2;
      const crown = (elder ? 3.5 : 1.6) + r * (1.4 + thick * 0.7) + rng() * 0.7;
      const tree = {
        x, z, y: height(x, z) - 0.12, r, height: heightScale, crown, thick,
        turn: rng() * Math.PI * 2, tint: rng(), type, kind: 'bark',
        normals: Array.from({ length: 9 }, (_, j) => {
          const angle = (j + 0.5) * Math.PI * 2 / 9;
          return { x: Math.sin(angle), z: Math.cos(angle) };
        }),
      };
      area.trees.push(tree);
      area.colliders.push(tree);
    }

    // Ferns & bushes (used visually and as outdoor jump-scare cover)
    for (let i = 0; i < (outOfBounds ? 48 : 112); i++) {
      const x = left + rng() * CHUNK, z = top + rng() * CHUNK;
      if (roadDistance(x, z) < 2.0) continue;
      if (CABIN_SITES.some(s => Math.abs(x - s.x) < s.halfW + 1.2 && Math.abs(z - s.z) < s.halfD + 1.2)) continue;
      area.plants.push({
        x, z, y: height(x, z), size: 0.30 + rng() ** 2 * 1.15,
        turn: rng() * Math.PI * 2, tint: rng(), brush: i % 3 === 0,
      });
    }

    // Forest dressing (rocks, fallen logs, carcasses, wrecks, fireflies) on playable chunks
    if (!outOfBounds && DRESSING.enabled) {
      const dressingSites = [
        ...sites,
        ...CABIN_SITES.filter(s => Math.hypot(s.x - (left + CHUNK / 2), s.z - (top + CHUNK / 2)) < CHUNK * 1.1)
          .map(s => ({ x: s.x, z: s.z, r: s.radius + 3 })),
      ];
      area.decor = dress(area, {
        seed, left, top, CHUNK, height, roadDistance, region, sites: dressingSites,
        random, hash, START, phase,
      });
    }
    return area;
  };

  function chunk(cx, cz) {
    const key = cx + ',' + cz;
    let value = chunks.get(key);
    if (!value) {
      value = makeChunk(cx, cz);
      chunks.set(key, value);
    }
    return value;
  }

  function around(x, z, radius) {
    const result = [];
    for (let j = Math.floor((z - radius) / CHUNK); j <= Math.floor((z + radius) / CHUNK); j++)
      for (let i = Math.floor((x - radius) / CHUNK); i <= Math.floor((x + radius) / CHUNK); i++)
        result.push(chunk(i, j));
    return result;
  }

  function blocks(x, z, radius = 0.26) {
    if (!insideBounds(x, z, 3.0)) return true;
    // Pad by 14 m so large 22x18 m cabins crossing a chunk edge never miss collision checks
    return around(x, z, radius + 14).some(area => area.colliders.some(o => {
      if (o.broken) return false;
      if (o.kind === 'shedRoof' || o.kind === 'districtRoof' || o.kind === 'districtLintel' || o.kind === 'districtFloor') return false;
      if (o.r) return (x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + radius) ** 2;
      const dx = Math.max(0, Math.abs(x - o.x) - o.rx), dz = Math.max(0, Math.abs(z - o.z) - o.rz);
      return dx * dx + dz * dz < radius * radius;
    }));
  }

  function move(point, dx, dz, radius) {
    if (!blocks(point.x + dx, point.z + dz, radius)) {
      point.x += dx;
      point.z += dz;
    } else {
      if (!blocks(point.x + dx, point.z, radius)) point.x += dx;
      if (!blocks(point.x, point.z + dz, radius)) point.z += dz;
    }
  }

  function raycast(origin, ray, range, ground = true) {
    const endX = origin.x + ray.x * range, endZ = origin.z + ray.z * range;
    let t = range + 1, object = null;
    for (let j = Math.floor((Math.min(origin.z, endZ) - 14) / CHUNK); j <= Math.floor((Math.max(origin.z, endZ) + 14) / CHUNK); j++) {
      for (let i = Math.floor((Math.min(origin.x, endX) - 14) / CHUNK); i <= Math.floor((Math.max(origin.x, endX) + 14) / CHUNK); i++) {
        for (const o of chunk(i, j).colliders) {
          if (o.broken || o.kind === 'districtFloor') continue;
          const hit = o.r ? rayTrunk(origin, ray, o, Math.min(t, range)) : rayBox(origin, ray, o, Math.min(t, range));
          if (hit < t && hit <= range) { t = hit; object = o; }
        }
      }
    }
    if (ground) {
      const limit = Math.min(t, range);
      for (let d = Math.min(0.65, limit); d <= limit && d > 0; d = Math.min(d + 0.65, limit)) {
        const x = origin.x + ray.x * d, z = origin.z + ray.z * d;
        if (origin.y + ray.y * d <= height(x, z)) {
          let low = Math.max(0, d - 0.65), high = d;
          for (let i = 0; i < 6; i++) {
            const mid = (low + high) / 2;
            if (origin.y + ray.y * mid > height(origin.x + ray.x * mid, origin.z + ray.z * mid)) low = mid;
            else high = mid;
          }
          return { t: high, kind: 'earth', object: null };
        }
        if (d === limit) break;
      }
    }
    return object ? { t, kind: object.kind, object } : null;
  }

  function clear(a, b, ground = true) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    return len <= 0.14 || !raycast(a, { x: dx / len, y: dy / len, z: dz / len }, len - 0.12, ground);
  }

  function getCabin(id) {
    if (!cabinIndex.has(id)) {
      const site = CABIN_SITES.find(s => s.id === id);
      if (site) chunk(site.cx, site.cz);
    }
    return cabinIndex.get(id) || null;
  }

  function cabinAtPoint(x, z, margin = 0.5) {
    for (const site of CABIN_SITES) {
      if (Math.abs(x - site.x) <= site.halfW + margin && Math.abs(z - site.z) <= site.halfD + margin) {
        return getCabin(site.id);
      }
    }
    return null;
  }

  // Pre-build all 20 cabin chunks upfront so the 500-monster roster & cabin loot are deterministic immediately
  for (const site of CABIN_SITES) chunk(site.cx, site.cz);
  chunk(Math.floor(ANTENNA.x / CHUNK), Math.floor(ANTENNA.z / CHUNK));
  chunk(Math.floor(START.x / CHUNK), Math.floor(START.z / CHUNK));

  return {
    seed, phase, bounds: { min: WORLD_MIN, max: WORLD_MAX },
    height, sample, density, region, roadDistance,
    chunk, around, blocks, move, raycast, clear,
    getCabin, cabinAtPoint,
    get cabins() { return [...cabinIndex.values()]; },
  };
}
