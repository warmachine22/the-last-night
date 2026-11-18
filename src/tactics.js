import { distance } from './world.js';

export const MAX_TETHER_FROM_HOME = 15.0;
export const MAX_PURSUIT_PLAYER_DIST = 16.0;

// Fast bounded grid BFS + Euclidean string-pulling so zombies walk diagonally/directly
// whenever corridor sight is clear instead of following right-angle grid edges.
export function findMazeStep(labyrinth, fromPos, toPos, clearWalkFn = null, radius = 0.25) {
  if (clearWalkFn && clearWalkFn(fromPos, toPos, radius)) return toPos;

  const [sc, sr] = labyrinth.worldToCell(fromPos.x, fromPos.z);
  const [tc, tr] = labyrinth.worldToCell(toPos.x, toPos.z);
  if (sc === tc && sr === tr) return toPos;

  const { cols, rows, hEdges, vEdges } = labyrinth;
  const key = (c, r) => r * cols + c;
  const startKey = key(sc, sr);
  const goalKey = key(tc, tr);
  const queue = [[sc, sr]];
  const parent = new Map([[startKey, null]]);

  const openBetween = (c1, r1, c2, r2) => {
    if (c2 === c1 + 1) return vEdges[r1][c1 + 1] !== '#';
    if (c2 === c1 - 1) return vEdges[r1][c1] !== '#';
    if (r2 === r1 + 1) return hEdges[r1 + 1][c1] !== '#';
    if (r2 === r1 - 1) return hEdges[r1][c1] !== '#';
    return false;
  };

  let found = false;
  for (let head = 0; head < queue.length && queue.length < 110; head++) {
    const [c, r] = queue[head];
    const k = key(c, r);
    if (k === goalKey) { found = true; break; }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nk = key(nc, nr);
      if (parent.has(nk) || !openBetween(c, r, nc, nr)) continue;
      parent.set(nk, [c, r]);
      queue.push([nc, nr]);
    }
  }

  if (!found) return toPos;
  const path = [];
  let cur = [tc, tr];
  while (cur) {
    path.push(labyrinth.cellCenter(cur[0], cur[1]));
    const prev = parent.get(key(cur[0], cur[1]));
    if (!prev || (prev[0] === sc && prev[1] === sr)) break;
    cur = prev;
  }
  path.reverse();
  path.push(toPos);

  if (clearWalkFn) {
    for (let i = path.length - 1; i >= 0; i--) {
      if (clearWalkFn(fromPos, path[i], radius)) return path[i];
    }
  }
  return path[0] || toPos;
}

function assignFlankTarget(world, e, p, chaserRank, sameLineAhead) {
  const d = distance(e, p);
  // Once close inside lethal ambush range, commit straight to the player
  if (d < 2.35 || (chaserRank < 2 && !sameLineAhead)) {
    return { role: 'pursuit', x: p.x, z: p.z };
  }

  const side = e.flankSide || (e.id % 2 === 0 ? 1 : -1);
  const baseAngle = Math.atan2(e.z - p.z, e.x - p.x);
  const arcSpread = chaserRank >= 4 ? 1.85 : 1.15; // rear wrap or wide 65-105 deg lateral flank
  const standOff = Math.min(4.8, Math.max(2.3, d * 0.68));

  for (const trySide of [side, -side]) {
    for (const distScale of [1, 0.72, 1.3]) {
      const ang = baseAngle + trySide * arcSpread;
      const fx = p.x + Math.cos(ang) * standOff * distScale;
      const fz = p.z + Math.sin(ang) * standOff * distScale;
      if (!world.blocks(fx, fz, 0.34)) {
        return { role: 'flank', x: fx, z: fz };
      }
    }
  }

  return { role: 'pursuit', x: p.x, z: p.z };
}

// Ambush, flanking & short-tether AI:
// - Idle zombies hold silently at concealed corners (never wandering across doorways)
// - Alerted/ambushing zombies pursue briefly out through doorways up to MAX_TETHER_FROM_HOME
// - When 4+ zombies chase or queue up behind one another, flankers break left/right/behind to cut off the player
// - If the player gets too far away, zombies break chase and return cleanly to e.home
export function updateHordeTactics(run) {
  const { player: p, world } = run;
  const arena = world.arena;
  const labyrinth = world.labyrinth;

  // Gather active pursuers sorted closest -> furthest to detect queues & pack flanking
  const chasers = [];
  for (const e of run.enemies) {
    if (e.dead) continue;
    if (arena || e.target?.chase) {
      if (!e.flankSide) e.flankSide = e.id % 2 === 0 ? 1 : -1;
      const dx = p.x - e.x, dz = p.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      chasers.push({ e, d, ux: dx / d, uz: dz / d });
    }
  }
  chasers.sort((a, b) => a.d - b.d);

  const packSize = chasers.length;
  const directKeep = [];
  for (let i = 0; i < chasers.length; i++) {
    const item = chasers[i];
    const { e } = item;
    if (arena) {
      e.dormant = false;
      e.alerted = true;
    }

    const home = e.home || (labyrinth && e.zoneId != null ? labyrinth.zones[e.zoneId]?.wallCells?.[0] : null) || { x: e.x, z: e.z };
    if (!arena) {
      const distHome = distance(e, home);
      const distPlayer = item.d;
      if (distHome > MAX_TETHER_FROM_HOME || distPlayer > MAX_PURSUIT_PLAYER_DIST) {
        e.memory = null;
        e.target = null;
        e.alerted = false;
        e.returning = { x: home.x, z: home.z };
        e.tactic = { role: 'returning', x: home.x, z: home.z };
        continue;
      }
    }

    const targetGoal = !arena && e.target?.id !== 'player' && e.target ? e.target : p;
    const sameLineAhead = directKeep.some(front =>
      Math.hypot(front.e.x - e.x, front.e.z - e.z) < 3.6 && (front.ux * item.ux + front.uz * item.uz) > 0.78);

    const shouldFlank = (packSize >= 4 && i >= 2) || sameLineAhead;
    if (shouldFlank) {
      const inAlcove = arena && arena.faces.some(f => e.x * f.nx + e.z * f.nz > arena.apothem - 0.5);
      e.tactic = inAlcove
        ? { role: 'pursuit', x: targetGoal.x, z: targetGoal.z }
        : assignFlankTarget(world, e, targetGoal, i, sameLineAhead);
    } else {
      directKeep.push(item);
      e.tactic = { role: 'pursuit', x: targetGoal.x, z: targetGoal.z };
    }
  }

  if (arena) return;

  for (const e of run.enemies) {
    if (e.dead || e.target?.chase) continue;
    const zone = e.zoneId != null ? labyrinth.zones[e.zoneId] : null;
    const home = e.home || (zone?.wallCells?.[0]) || { x: e.x, z: e.z };

    if (e.returning) {
      if (distance(e, e.returning) > 0.7) {
        e.tactic = { role: 'returning', x: e.returning.x, z: e.returning.z };
      } else {
        e.returning = null;
        e.tactic = { role: 'ambushIdle', x: home.x, z: home.z };
      }
      continue;
    }

    // Hold motionless in concealed corner; step back gently only if displaced from home corner
    if (distance(e, home) > 0.85) {
      e.tactic = { role: 'returning', x: home.x, z: home.z };
    } else {
      const watchDoor = zone?.doors?.[0] || p;
      e.tactic = { role: 'ambushIdle', x: home.x, z: home.z, lookX: watchDoor.x, lookZ: watchDoor.z };
    }
  }
}
