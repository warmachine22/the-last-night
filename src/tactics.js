import { distance } from './world.js';

export const MAX_TETHER_FROM_HOME = 15.0;
export const MAX_PURSUIT_PLAYER_DIST = 16.0;

// Fast bounded grid BFS across open/doorway edges (<= 85 cells) so zombies can pursue out
// of their room for a short tether distance and return cleanly back through doorways.
export function findMazeStep(labyrinth, fromPos, toPos) {
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
  for (let head = 0; head < queue.length && queue.length < 90; head++) {
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
  let cur = [tc, tr];
  while (true) {
    const prev = parent.get(key(cur[0], cur[1]));
    if (!prev || (prev[0] === sc && prev[1] === sr)) break;
    cur = prev;
  }
  return labyrinth.cellCenter(cur[0], cur[1]);
}

// Ambush & short-tether AI:
// - Idle zombies hold silently at concealed corners (never wandering across doorways)
// - Alerted/ambushing zombies pursue briefly out through doorways up to MAX_TETHER_FROM_HOME
// - If the player gets too far away, zombies break chase and return cleanly to e.home
export function updateHordeTactics(run) {
  const { player: p, world } = run;
  if (world.arena) {
    for (const e of run.enemies) {
      if (e.dead) continue;
      e.dormant = false;
      e.alerted = true;
      e.tactic = { role: 'pursuit', x: p.x, z: p.z };
    }
    return;
  }
  const labyrinth = world.labyrinth;

  for (const e of run.enemies) {
    if (e.dead) continue;
    const zone = e.zoneId != null ? labyrinth.zones[e.zoneId] : null;
    const home = e.home || (zone?.wallCells?.[0]) || { x: e.x, z: e.z };

    if (e.target?.chase) {
      const distHome = distance(e, home);
      const distPlayer = distance(e, p);
      if (distHome > MAX_TETHER_FROM_HOME || distPlayer > MAX_PURSUIT_PLAYER_DIST) {
        e.memory = null;
        e.target = null;
        e.alerted = false;
        e.returning = { x: home.x, z: home.z };
        e.tactic = { role: 'returning', x: home.x, z: home.z };
      } else {
        e.tactic = { role: 'pursuit', x: e.target.x, z: e.target.z };
      }
      continue;
    }

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
