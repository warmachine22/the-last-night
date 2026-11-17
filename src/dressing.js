// Environment dressing (1.1.0 "Dead Forest"): seeded scenery data only. No Three.js here.
// Rules: never consume the chunk's own rng stream, never add loot, never touch entrances.
// Everything is placed AFTER trees, loot and entrances exist, from its own random stream, so
// every 1.0.17 seed keeps identical trees, buildings, radio, loot ids and spawn entrances.
// Full catalog, budgets and rollback notes: docs/ENVIRONMENT_DRESSING.md

export const DRESSING = {
  enabled: true,
  perChunk: {
    grass: 110, shrubs: 24, rocksSmall: 18, rocksMedium: 5, pebbles: 40, logsDecor: 3,
    snagRate: .08, logBarrier: .18, carcass: .22, person: .05, vehicle: .10, campBike: .40,
  },
  budgets: { colliders: 10, triangles: 8000, drawCalls: 3 },
  firefly: { threshold: .64 },
};

export function setDressingEnabled(value) { DRESSING.enabled = Boolean(value); }

// Triangle cost of each kit piece. tests/dressing.test.js checks these against the real geometry.
export const TRIS = {
  rock: 20, rockSplit: 40, pebble: 8, logDecor: 32, logBarrier: 68, stump: 32,
  deer: 256, bear: 336, fox: 176, rabbit: 96, bones: 96, skull: 38,
  personSlumped: 164, personLying: 180, pack: 24,
  sedan: 212, pickup: 224, van: 212, moto: 140, motoFallen: 140, stain: 28,
  grass: 6, shrub: 12, // per instance, own cheap blade geometry (see kit.js)
};

export const CARCASS = ['deer', 'bear', 'fox', 'rabbit'];

const TAU = Math.PI * 2;
const hypot = Math.hypot;

// Smooth world-space field for firefly pockets. Pure and cheap, so the renderer and tests agree.
export function fireflyField(phase, x, z) {
  const a = Math.sin(x * .0113 + phase) * Math.cos(z * .0131 - phase * 1.7);
  const b = .6 * Math.sin((x + z) * .0071 + phase * 3.1);
  const c = .35 * Math.sin(x * .031 - z * .027 + phase * .6);
  return (a + b + c + 1.95) / 3.9;
}
export const inFireflyPocket = (phase, x, z) => fireflyField(phase, x, z) > DRESSING.firefly.threshold;

export function isSnag(areaKey, index, hash) {
  return hash(areaKey + ':snag:' + index) % 1000 < DRESSING.perChunk.snagRate * 1000;
}

const snapAxis = angle => {
  const q = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
  return Math.abs(Math.atan2(Math.sin(angle - q), Math.cos(angle - q))) < .32 ? q : null;
};

// ctx: { seed, left, top, CHUNK, height, roadDistance, region, sites, random, hash, START, phase }
export function dress(area, ctx) {
  const { seed, left, top, CHUNK, height, roadDistance, region, sites, random, hash, START } = ctx;
  const cfg = DRESSING.perChunk, rng = random(seed + ':dress:' + area.key);
  const decor = {
    rocks: [], pebbles: [], logs: [], cover: [], remains: [], vehicles: [], stains: [], anchors: [],
    colliders: 0, triangles: 0,
  };
  const placed = [];
  const addCollider = (x, z, w, h, d, y, kind) => {
    const item = { x, z, y: y + h / 2, rx: w / 2, ry: h / 2, rz: d / 2, kind, decor: true };
    area.colliders.push(item);
    decor.colliders++;
    return item;
  };
  const free = (x, z, r, minRoad = 3.2, except = null) => {
    if (x < left + .6 || x > left + CHUNK - .6 || z < top + .6 || z > top + CHUNK - .6) return false;
    if (hypot(x - START.x, z - START.z) < 10 + r) return false;
    if (roadDistance(x, z) < minRoad + r * .5) return false;
    for (const s of sites) if (s !== except && hypot(x - s.x, z - s.z) < s.r + r + .4) return false;
    for (const l of area.loot) if (hypot(x - l.x, z - l.z) < r + 1.2) return false;
    for (const e of area.entrances) if (hypot(x - e.x, z - e.z) < r + 1.3) return false;
    for (const t of area.trees) if (hypot(x - t.x, z - t.z) < t.r + r + .35) return false;
    for (const p of placed) if (hypot(x - p.x, z - p.z) < p.r + r) return false;
    return true;
  };
  const spot = (r, minRoad, tries = 14) => {
    for (let i = 0; i < tries; i++) {
      const x = left + 1 + rng() * (CHUNK - 2), z = top + 1 + rng() * (CHUNK - 2);
      if (free(x, z, r, minRoad)) return { x, z };
    }
    return null;
  };
  const claim = (x, z, r) => placed.push({ x, z, r });
  // Footprint test along a straight trunk or vehicle so nothing overlaps a tree or building.
  const lineFree = (x, z, dx, dz, half, r) => {
    for (let k = -2; k <= 2; k++) if (!free(x + dx * half * k / 2, z + dz * half * k / 2, r, -10)) return false;
    return true;
  };
  const biome = area.biome;
  const budget = () => decor.triangles < DRESSING.budgets.triangles - 1200 && decor.colliders < DRESSING.budgets.colliders;
  const tri = n => { decor.triangles += n; };

  // Rocks: pebbles, small, medium, and a few boulders with shape variety.
  const rockCount = cfg.rocksSmall + (biome === 'ridge' ? 8 : 0);
  for (let i = 0; i < rockCount; i++) {
    const size = .16 + rng() ** 2 * .5;
    const s = spot(size, 2.4, 3); if (!s) continue;
    const shape = Math.floor(rng() * 5);
    const sy = Math.min(.70, size * (shape === 2 ? 1.7 : shape === 1 ? .45 : .8));
    decor.rocks.push({ x: s.x, z: s.z, y: height(s.x, s.z) - size * .12, sx: size * (shape === 1 ? 1.6 : 1.1),
      sy, sz: size, turn: rng() * TAU, shape, shade: .55 + rng() * .4 });
    tri(shape === 3 || shape === 4 ? TRIS.rockSplit : TRIS.rock);
    claim(s.x, s.z, size * .8);
  }
  for (let i = 0; i < cfg.rocksMedium + (biome === 'ridge' ? 4 : 0) && budget(); i++) {
    const size = .62 + rng() * .85;
    const s = spot(size * 1.1, 3.4, 6); if (!s) continue;
    const shape = Math.floor(rng() * 5);
    const rawSy = size * (shape === 2 ? 1.5 : shape === 1 ? .52 : .85);
    const boulder = rawSy > 1.25 && size * 1.15 < 2.4 && decor.colliders < 2;
    const sy = boulder ? rawSy : Math.min(.70, rawSy);
    const rock = { x: s.x, z: s.z, y: height(s.x, s.z) - size * .15, sx: size * (shape === 1 ? 1.7 : 1.15),
      sy, sz: size * .95, turn: rng() * TAU, shape, shade: .5 + rng() * .4 };
    decor.rocks.push(rock);
    tri(shape === 3 || shape === 4 ? TRIS.rockSplit : TRIS.rock);
    claim(s.x, s.z, size * 1.1);
    // Only the truly large boulders collide, with a box that matches the visible volume; smaller rocks stay low.
    if (boulder) {
      rock.collides = true;
      addCollider(rock.x, rock.z, rock.sx * 1.35, rock.sy * 1.3, rock.sz * 1.35, rock.y, 'stone');
    }
  }
  for (let c = 0; c < 3; c++) {
    const base = spot(.9, 1.7, 3); if (!base) continue;
    for (let i = 0; i < 9; i++) {
      const x = base.x + (rng() - .5) * 1.6, z = base.z + (rng() - .5) * 1.6;
      if (roadDistance(x, z) < 1.7 || x < left + .6 || x > left + CHUNK - .6 || z < top + .6 || z > top + CHUNK - .6) continue;
      decor.pebbles.push({ x, z, y: height(x, z) - .01, s: .05 + rng() * .08, turn: rng() * TAU, shade: .5 + rng() * .4 });
      tri(TRIS.pebble);
    }
  }
  // Gravel pebbles along road shoulders.
  for (let i = 0; i < cfg.pebbles - 27; i++) {
    const x = left + 1 + rng() * (CHUNK - 2), z = top + 1 + rng() * (CHUNK - 2), road = roadDistance(x, z);
    if (road < 1.5 || road > 3.6 || hypot(x - START.x, z - START.z) < 4) continue;
    decor.pebbles.push({ x, z, y: height(x, z) - .01, s: .035 + rng() * .06, turn: rng() * TAU, shade: .55 + rng() * .35 });
    tri(TRIS.pebble);
  }

  // Fallen logs. Decorative ones are low and never collide. Barriers sit on a verge and block part
  // of a road, leaving the far side open, with a chain of boxes that follows the visible trunk.
  for (let i = 0; i < cfg.logsDecor; i++) {
    const r = .13 + rng() * .1, len = 2.4 + rng() * 3.2;
    const s = spot(len * .5, 3.0, 5); if (!s) continue;
    decor.logs.push({ x: s.x, z: s.z, y: height(s.x, s.z) + r * .55, len, r, yaw: rng() * Math.PI, barrier: false,
      shade: .45 + rng() * .35 });
    tri(TRIS.logDecor);
    claim(s.x, s.z, len * .45);
  }
  if (rng() < cfg.logBarrier && budget() && decor.colliders <= DRESSING.budgets.colliders - 4) {
    for (let attempt = 0; attempt < 70; attempt++) {
      const x = left + 6 + rng() * (CHUNK - 12), z = top + 6 + rng() * (CHUNK - 12), road = roadDistance(x, z);
      if (road < 2.0 || road > 3.6) continue;
      const gx = roadDistance(x + .6, z) - roadDistance(x - .6, z), gz = roadDistance(x, z + .6) - roadDistance(x, z - .6);
      const axis = snapAxis(Math.atan2(gz, gx));
      if (axis === null || Math.abs(gx) + Math.abs(gz) < .3) continue;
      const len = 4.4 + rng() * 1.4, r = len * .07; // kit trunk is 5 m long, 0.35 m radius, scaled uniformly
      const axisVec = { x: Math.cos(axis), z: Math.sin(axis) };
      const dir = gx * axisVec.x + gz * axisVec.z > 0 ? 1 : -1;
      const away = { x: axisVec.x * dir, z: axisVec.z * dir };
      // The trunk runs along `away` from 1.1 m past the road centreline to len - 1.1 m beyond it,
      // so the far side of the road stays open.
      const p0 = { x: x - away.x * road, z: z - away.z * road };
      const reach = len / 2 - 1.1;
      const cx = p0.x + away.x * reach, cz = p0.z + away.z * reach;
      if (!lineFree(cx, cz, away.x, away.z, len / 2, r + .25)) continue;
      const y = height(cx, cz);
      const log = { x: cx, z: cz, y: y + r * .85, len, r, yaw: Math.atan2(-away.z, away.x) + (rng() - .5) * .08, barrier: true, shade: .45 + rng() * .3 };
      decor.logs.push(log);
      tri(TRIS.logBarrier);
      claim(cx, cz, len * .5);
      const segs = 3, segLen = len / segs;
      for (let k = 0; k < segs; k++) {
        const along = (k - 1) * segLen;
        const bx = cx + Math.cos(-log.yaw) * along, bz = cz + Math.sin(-log.yaw) * along;
        const w = Math.abs(Math.cos(log.yaw)) * segLen + Math.abs(Math.sin(log.yaw)) * r * 2 + .1;
        const d = Math.abs(Math.sin(log.yaw)) * segLen + Math.abs(Math.cos(log.yaw)) * r * 2 + .1;
        addCollider(bx, bz, w, r * 1.9, d, y, 'log');
      }
      break;
    }
  }

  // Remains. Carcasses sit in the woods away from roads and are found by flashlight.
  const carcassP = cfg.carcass * (biome === 'clearing' ? .6 : biome === 'gully' ? 1.35 : 1);
  if (rng() < carcassP && budget()) {
    const roll = rng();
    const species = biome === 'clearing' ? (roll < .45 ? 'deer' : roll < .75 ? 'rabbit' : roll < .97 ? 'fox' : 'bear')
      : roll < .30 ? 'deer' : roll < .50 ? 'bear' : roll < .75 ? 'fox' : 'rabbit';
    const r = species === 'bear' ? 1.4 : species === 'deer' ? 1.3 : .7;
    const s = spot(r, 3.0, 20);
    if (s) {
      const y = height(s.x, s.z);
      const item = { kind: species, x: s.x, z: s.z, y: y - .03, yaw: rng() * TAU, variant: Math.floor(rng() * 2), shade: .75 + rng() * .25 };
      decor.remains.push(item); tri(TRIS[species]);
      decor.stains.push({ x: s.x, z: s.z, y: y + .045, s: r * .85, yaw: rng() * TAU }); tri(TRIS.stain);
      decor.anchors.push({ kind: 'carcass', x: s.x, y: y + .35, z: s.z });
      claim(s.x, s.z, r);
      for (let i = 0; i < 4; i++) {
        const a = rng() * TAU, d = .8 + rng() * 1.6, bx = s.x + Math.cos(a) * d, bz = s.z + Math.sin(a) * d;
        if (!free(bx, bz, .2, 2.5)) continue;
        decor.remains.push({ kind: i === 0 ? 'skull' : 'bones', x: bx, z: bz, y: height(bx, bz) - .02, yaw: rng() * TAU, variant: 0, shade: .8 });
        tri(i === 0 ? TRIS.skull : TRIS.bones);
      }
    }
  }
  if (rng() < cfg.person && budget() && area.trees.length) {
    // Prefer a tree to lean on. Falls back to lying in open ground.
    let placedPerson = false;
    const start = Math.floor(rng() * area.trees.length);
    for (let k = 0; k < Math.min(area.trees.length, 30) && !placedPerson; k++) {
      const t = area.trees[(start + k) % area.trees.length];
      if (t.r < .26 || roadDistance(t.x, t.z) < 4.5) continue;
      const a = rng() * TAU, d = t.r + .42;
      const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      if (x < left + .8 || x > left + CHUNK - .8 || z < top + .8 || z > top + CHUNK - .8) continue;
      if (hypot(x - START.x, z - START.z) < 14 || sites.some(s => hypot(x - s.x, z - s.z) < s.r + 1)) continue;
      if (area.loot.some(l => hypot(x - l.x, z - l.z) < 1.6) || area.entrances.some(e => hypot(x - e.x, z - e.z) < 1.6)) continue;
      if (area.trees.some(o => o !== t && hypot(x - o.x, z - o.z) < o.r + .55)) continue;
      if (placed.some(p => hypot(x - p.x, z - p.z) < p.r + .6)) continue;
      const y = height(x, z);
      decor.remains.push({ kind: 'personSlumped', x, z, y: y - .02, yaw: Math.atan2(Math.cos(a), Math.sin(a)), variant: Math.floor(rng() * 3), shade: .8 + rng() * .2 });
      tri(TRIS.personSlumped);
      decor.remains.push({ kind: 'pack', x: x + Math.cos(a + 1.3) * .7, z: z + Math.sin(a + 1.3) * .7, y: y - .03, yaw: rng() * TAU, variant: 0, shade: .9 });
      tri(TRIS.pack);
      decor.anchors.push({ kind: 'person', x, y: y + .5, z });
      claim(x, z, .9);
      placedPerson = true;
    }
    if (!placedPerson) {
      const s = spot(1.1, 4.5, 20);
      if (s) {
        const y = height(s.x, s.z);
        decor.remains.push({ kind: 'personLying', x: s.x, z: s.z, y: y - .02, yaw: rng() * TAU, variant: Math.floor(rng() * 3), shade: .8 + rng() * .2 });
        tri(TRIS.personLying);
        decor.stains.push({ x: s.x, z: s.z, y: y + .045, s: .8, yaw: rng() * TAU }); tri(TRIS.stain);
        decor.anchors.push({ kind: 'person', x: s.x, y: y + .3, z: s.z });
        claim(s.x, s.z, 1.1);
      }
    }
  }

  // Abandoned vehicles beside roads (axis aligned so the box collider matches what is drawn),
  // and motorbikes at campsites.
  if (rng() < cfg.vehicle && budget() && decor.colliders <= DRESSING.budgets.colliders - 2) {
    for (let attempt = 0; attempt < 70; attempt++) {
      // Pick any point within 40 m of a road, then slide it along the gradient to 5-6.8 m off the centreline.
      const x0 = left + 2 + rng() * (CHUNK - 4), z0 = top + 2 + rng() * (CHUNK - 4), road0 = roadDistance(x0, z0);
      if (road0 > 40 || road0 < 1) continue;
      const g0x = roadDistance(x0 + .6, z0) - roadDistance(x0 - .6, z0), g0z = roadDistance(x0, z0 + .6) - roadDistance(x0, z0 - .6);
      const gl = Math.hypot(g0x, g0z);
      if (gl < .3) continue;
      const off = 5 + rng() * 1.8, x = x0 + g0x / gl * (off - road0), z = z0 + g0z / gl * (off - road0);
      if (x < left + 3 || x > left + CHUNK - 3 || z < top + 3 || z > top + CHUNK - 3) continue;
      const gx = g0x, gz = g0z;
      const alongX = Math.abs(gz) > Math.abs(gx);
      const kind = ['sedan', 'pickup', 'van'][Math.floor(rng() * 3)];
      const L = { sedan: 4.3, pickup: 5.0, van: 5.2 }[kind], W = { sedan: 1.85, pickup: 2.0, van: 2.1 }[kind];
      const w = alongX ? L : W, d = alongX ? W : L;
      if (!lineFree(x, z, alongX ? 1 : 0, alongX ? 0 : 1, L / 2, W / 2 + .5) || roadDistance(x, z) < 4.4) continue;
      const y = height(x, z) - .1;
      const flip = rng() < .5 ? 0 : Math.PI;
      decor.vehicles.push({ kind, x, z, y, yaw: (alongX ? Math.PI / 2 : 0) + flip, shade: .6 + rng() * .4,
        hue: Math.floor(rng() * 4) });
      tri(TRIS[kind]);
      addCollider(x, z, w, 1.45, d, y, 'wreck');
      claim(x, z, Math.max(w, d) * .6);
      decor.anchors.push({ kind: 'vehicle', x, y: y + 1, z });
      break;
    }
  }
  for (const camp of sites.filter(s => s.type === 'camp')) {
    // Low camp clutter (stump seat, pack, cold-camp debris) without colliders.
    for (let i = 0; i < 2; i++) {
      const a = rng() * TAU, d = 1.6 + rng() * 2.2, x = camp.x + Math.cos(a) * d, z = camp.z + Math.sin(a) * d;
      if (!free(x, z, .35, 2.0, camp)) continue;
      const kind = i === 0 ? 'stump' : rng() < .6 ? 'pack' : 'bones';
      decor.remains.push({ kind, x, z, y: height(x, z) - .02, yaw: rng() * TAU, variant: 0, shade: .78 + rng() * .2 });
      tri(TRIS[kind]);
      claim(x, z, .45);
    }
    if (decor.colliders >= DRESSING.budgets.colliders) continue;
    if (hash(seed + ':bike:' + area.key) % 1000 >= cfg.campBike * 1000) continue;
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = rng() * TAU, d = 4.2 + rng() * 2;
      const x = camp.x + Math.cos(a) * d, z = camp.z + Math.sin(a) * d;
      if (!free(x, z, 1.1, 3.2, camp)) continue;
      const fallen = rng() < .45, y = height(x, z);
      const alongX = rng() < .5;
      decor.vehicles.push({ kind: fallen ? 'motoFallen' : 'moto', x, z, y: y - .02, yaw: alongX ? Math.PI / 2 : 0,
        shade: .7 + rng() * .3, hue: Math.floor(rng() * 4) });
      tri(fallen ? TRIS.motoFallen : TRIS.moto);
      addCollider(x, z, alongX ? 2.0 : .75, fallen ? .45 : .95, alongX ? .75 : 2.0, y, 'wreck');
      claim(x, z, 1.2);
      break;
    }
  }

  // Ground cover: grass tufts and shrubs. Not collidable, like the existing ferns.
  const dry = decor.anchors.length ? 1 : 0;
  const coverTotal = cfg.grass + cfg.shrubs;
  for (let i = 0; i < coverTotal; i++) {
    const x = left + rng() * CHUNK, z = top + rng() * CHUNK, road = roadDistance(x, z);
    const shrub = i >= cfg.grass;
    if (road < (shrub ? 2.4 : 1.95) || sites.some(s => hypot(x - s.x, z - s.z) < s.r * .8)) continue;
    const thick = biome === 'clearing' ? .6 : 1;
    if (!shrub && rng() > thick) continue;
    decor.cover.push({ x, z, y: height(x, z), size: shrub ? .55 + rng() * .9 : .22 + rng() * .35,
      turn: rng() * TAU, tone: rng(), shrub, dead: shrub && rng() < .55 + dry * .25 });
    tri(shrub ? TRIS.shrub : TRIS.grass);
  }
  return decor;
}
