import { LABYRINTH_CELL } from './labyrinth.js';
import { clamp, distance } from './world.js';

const DOOR_MARGIN = 0.72;

export function isInsideOwnZone(labyrinth, zone, x, z) {
  if (!zone) return true;
  const at = labyrinth.zoneAt(x, z);
  if (!at || at.id !== zone.id) return false;
  for (const d of zone.doors) {
    if (Math.hypot(x - d.x, z - d.z) < DOOR_MARGIN) return false;
  }
  return true;
}

// Clamp any world target strictly inside the zombie's assigned room or hallway,
// pulling back from doorways so room-restricted zombies never cross into other rooms.
export function clampTargetToZone(zone, x, z) {
  if (!zone) return { x, z };
  const b = zone.bounds;
  let cx = clamp(x, b.minX + 0.55, b.maxX - 0.55);
  let cz = clamp(z, b.minZ + 0.55, b.maxZ - 0.55);

  if (!zone.cellSet) return { x: cx, z: cz };
  // If zone is an irregular/L-shaped hallway, snap to nearest cell center belonging to this zone
  const cols = Math.round((b.maxX - b.minX) / LABYRINTH_CELL);
  if (zone.kind === 'hallway' || zone.cells.length < (b.c1 - b.c0 + 1) * (b.r1 - b.r0 + 1)) {
    let best = zone.wallCells[0] || zone.center;
    let bestD = Infinity;
    for (const [c, r] of zone.cells) {
      const px = zone.bounds.minX + (c - b.c0 + 0.5) * LABYRINTH_CELL;
      const pz = zone.bounds.minZ + (r - b.r0 + 0.5) * LABYRINTH_CELL;
      const d = (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
      if (d < bestD) { bestD = d; best = { x: px, z: pz }; }
    }
    cx = best.x;
    cz = best.z;
  }

  for (const d of zone.doors) {
    const gap = Math.hypot(cx - d.x, cz - d.z);
    if (gap < DOOR_MARGIN + 0.25) {
      const dx = (zone.center.x - d.x) || 0.1;
      const dz = (zone.center.z - d.z) || 0.1;
      const len = Math.hypot(dx, dz) || 1;
      cx = d.x + (dx / len) * (DOOR_MARGIN + 0.35);
      cz = d.z + (dz / len) * (DOOR_MARGIN + 0.35);
    }
  }
  return { x: cx, z: cz };
}

// Fast tiny BFS within the zombie's own zone cells so hallway roamers bend around L-corners smoothly.
export function findZoneStep(labyrinth, zone, fromPos, toPos) {
  if (!zone || zone.kind === 'room') return toPos;
  const [sc, sr] = labyrinth.worldToCell(fromPos.x, fromPos.z);
  const [tc, tr] = labyrinth.worldToCell(toPos.x, toPos.z);
  if (sc === tc && sr === tr) return toPos;

  const startKey = sr * labyrinth.cols + sc;
  const goalKey = tr * labyrinth.cols + tc;
  if (!zone.cellSet.has(goalKey)) return toPos;

  const queue = [[sc, sr]];
  const parent = new Map([[startKey, null]]);
  for (let head = 0; head < queue.length; head++) {
    const [c, r] = queue[head];
    const k = r * labyrinth.cols + c;
    if (k === goalKey) break;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      const nk = nr * labyrinth.cols + nc;
      if (!zone.cellSet.has(nk) || parent.has(nk)) continue;
      parent.set(nk, [c, r]);
      queue.push([nc, nr]);
    }
  }

  if (!parent.has(goalKey)) return toPos;
  let cur = [tc, tr];
  while (true) {
    const prev = parent.get(cur[1] * labyrinth.cols + cur[0]);
    if (!prev || (prev[0] === sc && prev[1] === sr)) break;
    cur = prev;
  }
  return labyrinth.cellCenter(cur[0], cur[1]);
}

// Blind, room-restricted ambush coordination:
// - Every zombie stays strictly inside its assigned room/hallway (never crossing doorways)
// - Unalerted zombies prowl slowly near walls/corners in darkness
// - Alerted zombies converge on the last gunshot/hazard/flash point inside their zone
export function updateHordeTactics(run) {
  const { world, time } = run;
  const labyrinth = world.labyrinth;

  for (const e of run.enemies) {
    if (e.dead) continue;
    const zone = e.zoneId != null ? labyrinth.zones[e.zoneId] : null;
    if (!zone) { e.tactic = null; continue; }

    if (e.target?.chase) {
      const clamped = clampTargetToZone(zone, e.target.x, e.target.z);
      e.tactic = { role: 'zonePursuit', zoneId: zone.id, x: clamped.x, z: clamped.z };
      continue;
    }

    // Slow random wall-hugging prowling inside own room or hallway when unalerted
    if (!e.patrolTarget || time >= (e.patrolUntil || 0) || distance(e, e.patrolTarget) < 0.85) {
      const spots = zone.wallCells.length ? zone.wallCells : [zone.center];
      const pick = spots[Math.floor(run.rng() * spots.length)];
      e.patrolTarget = { x: pick.x, z: pick.z };
      e.patrolUntil = time + 3.8 + run.rng() * 3.5;
    }
    e.tactic = { role: 'wallProwl', zoneId: zone.id, x: e.patrolTarget.x, z: e.patrolTarget.z };
  }
}

export function strategicReturnPoint(run, enemy) {
  const zone = enemy.zoneId != null ? run.world.labyrinth.zones[enemy.zoneId] : null;
  if (zone && zone.wallCells.length) {
    const pt = zone.wallCells[enemy.id % zone.wallCells.length];
    return { x: pt.x, z: pt.z };
  }
  return enemy.home ? { x: enemy.home.x, z: enemy.home.z } : { x: enemy.x, z: enemy.z };
}
