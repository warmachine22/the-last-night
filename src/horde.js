import { CABIN_SITES, insideBounds, START } from './map-layout.js';
import { distance } from './world.js';

export const ROSTER_TARGET = 500;
export const INDOOR_TARGET = 250;
export const OUTDOOR_TARGET = 250;
export const WAKE_RADIUS = 72;
export const SLEEP_RADIUS = 86;

const OUTDOOR_KINDS = ['shambler', 'shambler', 'shrieker', 'shambler', 'brute'];

export function populateWorldRoster(run, createMonster) {
  const { world, rng } = run;
  const roster = [];

  // 1) 250 Indoor / Cabin Monsters (room ambushes, closets, behind breakable walls + 5 porch lurkers)
  let indoorCount = 0;
  for (const cabin of world.cabins) {
    for (const spot of cabin.zombieSpots) {
      if (indoorCount >= INDOOR_TARGET) break;
      const roll = rng();
      const kind = roll < 0.56 ? 'shambler' : roll < 0.86 ? 'shrieker' : 'brute';
      const monster = createMonster(run, kind, spot.x, spot.z, {
        indoor: true,
        cabinId: cabin.id,
        dormant: true,
        ambushStyle: 'cabin',
      });
      roster.push(monster);
      indoorCount++;
    }
  }
  // Top up remaining indoor/cabin-perimeter slots (5 porch/doorway lurkers on the largest lodges)
  let idx = 0;
  while (indoorCount < INDOOR_TARGET && world.cabins.length) {
    const cabin = world.cabins[idx % world.cabins.length];
    const door = cabin.doors[0] || { x: cabin.x, z: cabin.z - cabin.d / 2, dir: -1, axis: 'h' };
    const px = door.x + (door.axis === 'v' ? door.dir * 1.4 : (idx % 2 ? 1.3 : -1.3));
    const pz = door.z + (door.axis === 'h' ? door.dir * 1.4 : (idx % 2 ? 1.3 : -1.3));
    if (!world.blocks(px, pz, 0.35)) {
      const monster = createMonster(run, idx % 3 === 0 ? 'shrieker' : 'shambler', px, pz, {
        indoor: true,
        cabinId: cabin.id,
        dormant: true,
        ambushStyle: 'porch',
      });
      roster.push(monster);
      indoorCount++;
    }
    idx++;
    if (idx > 40) break;
  }

  // 2) 250 Outdoor Forest Monsters (tucked beside trees, bushes, rocks, and road edges)
  const candidates = [];
  for (let cz = -7; cz <= 6; cz++) {
    for (let cx = -7; cx <= 6; cx++) {
      const area = world.chunk(cx, cz);
      for (const tree of area.trees) {
        if (tree.r < 0.28) continue;
        const a = rng() * Math.PI * 2;
        const x = tree.x + Math.cos(a) * (tree.r + 0.65);
        const z = tree.z + Math.sin(a) * (tree.r + 0.65);
        candidates.push({ x, z, ambushStyle: 'tree' });
      }
      for (let i = 0; i < area.plants.length; i += 14) {
        const plant = area.plants[i];
        candidates.push({ x: plant.x, z: plant.z, ambushStyle: 'bush' });
      }
    }
  }
  // Deterministic shuffle
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  let outdoorCount = 0;
  for (const spot of candidates) {
    if (outdoorCount >= OUTDOOR_TARGET) break;
    if (!insideBounds(spot.x, spot.z, 10)) continue;
    if (distance(START, spot) < 26) continue;
    if (CABIN_SITES.some(s => Math.abs(spot.x - s.x) < s.halfW + 3.5 && Math.abs(spot.z - s.z) < s.halfD + 3.5)) continue;
    if (world.blocks(spot.x, spot.z, 0.42)) continue;
    if (roster.some(e => distance(e, spot) < 3.2)) continue;
    const kind = OUTDOOR_KINDS[outdoorCount % OUTDOOR_KINDS.length];
    const monster = createMonster(run, kind, spot.x, spot.z, {
      indoor: false,
      cabinId: null,
      dormant: true,
      ambushStyle: spot.ambushStyle,
    });
    roster.push(monster);
    outdoorCount++;
  }

  // Fallback random forest fill if needed to guarantee exact 250 outdoor
  let guard = 0;
  while (outdoorCount < OUTDOOR_TARGET && guard++ < 5000) {
    const x = -320 + rng() * 640;
    const z = -320 + rng() * 640;
    if (distance(START, { x, z }) < 26) continue;
    if (CABIN_SITES.some(s => Math.abs(x - s.x) < s.halfW + 3.5 && Math.abs(z - s.z) < s.halfD + 3.5)) continue;
    if (world.blocks(x, z, 0.42)) continue;
    if (roster.some(e => distance(e, { x, z }) < 2.8)) continue;
    const kind = OUTDOOR_KINDS[outdoorCount % OUTDOOR_KINDS.length];
    roster.push(createMonster(run, kind, x, z, {
      indoor: false,
      cabinId: null,
      dormant: true,
      ambushStyle: 'forest',
    }));
    outdoorCount++;
  }

  run.roster = roster;
  run.counts = { indoor: indoorCount, outdoor: outdoorCount, total: roster.length };
  syncActiveRoster(run);
}

export function syncActiveRoster(run) {
  const p = run.player;
  const active = [];
  for (const e of run.roster) {
    if (e.dead) continue;
    const d = distance(e, p);
    if (d <= WAKE_RADIUS || (!e.dormant && d <= SLEEP_RADIUS)) {
      if (e.dormant && d <= WAKE_RADIUS) {
        // Stay still & quiet until triggered by perception/proximity, but participate in wake checks
        e.activeZone = true;
      }
      active.push(e);
    } else {
      // Sleep cleanly without deleting or resetting alive status
      e.dormant = true;
      e.alerted = false;
      e.target = null;
      e.memory = null;
      e.reason = 'dormant';
    }
  }
  run.enemies = active;
}
