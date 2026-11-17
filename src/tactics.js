import { angleDelta, clamp, direction, distance } from './world.js';

// Find the concealed side of a tree trunk relative to the player (or an observer).
function treeHideSpot(tree, fromPos) {
  const dx = tree.x - fromPos.x, dz = tree.z - fromPos.z;
  const d = Math.hypot(dx, dz) || 1;
  const pad = tree.r + 0.78;
  return { x: tree.x + (dx / d) * pad, z: tree.z + (dz / d) * pad };
}

export function strategicReturnPoint(run, enemy) {
  const { world, player: p } = run;
  const cabin = (enemy.cabinId && world.getCabin(enemy.cabinId)) || world.cabinAtPoint(enemy.x, enemy.z, 2);
  if (cabin) {
    // Re-orient inside a corner/room or doorway inside the cabin
    if (enemy.home && distance(enemy, enemy.home) < 28 && !world.blocks(enemy.home.x, enemy.home.z, 0.35)) {
      return { x: enemy.home.x, z: enemy.home.z };
    }
    const spot = cabin.zombieSpots[enemy.id % cabin.zombieSpots.length];
    if (spot) return { x: spot.x, z: spot.z };
  }

  // Outdoors: re-orient behind the nearest substantial tree trunk (out of road/sight)
  let best = null, bestScore = Infinity;
  for (const area of world.around(enemy.x, enemy.z, 16)) {
    for (const tree of area.trees) {
      if (tree.r < 0.32) continue;
      const d = distance(enemy, tree);
      if (d > 15) continue;
      const hide = treeHideSpot(tree, p);
      if (world.blocks(hide.x, hide.z, 0.35)) continue;
      const score = d + (distance(hide, p) < 8 ? 10 : 0);
      if (score < bestScore) { bestScore = score; best = hide; }
    }
  }
  return best || (enemy.home ? { x: enemy.home.x, z: enemy.home.z } : { x: enemy.x, z: enemy.z });
}

function nearestTreeCover(world, zombie, dest, player) {
  const zToDest = distance(zombie, dest);
  if (zToDest < 3.6) return null;
  let best = null, bestScore = Infinity;
  const midX = (zombie.x + dest.x) * 0.5, midZ = (zombie.z + dest.z) * 0.5;
  for (const area of world.around(midX, midZ, 12)) {
    for (const tree of area.trees) {
      if (tree.r < 0.34) continue;
      const hide = treeHideSpot(tree, player);
      const dz = distance(zombie, hide), dd = distance(hide, dest);
      if (dz + dd > zToDest + 4.5) continue;
      if (distance(hide, player) < 3.5 || world.blocks(hide.x, hide.z, 0.35)) continue;
      const score = dz + dd * 0.85;
      if (score < bestScore) { bestScore = score; best = hide; }
    }
  }
  return best;
}

const FLANK_ANGLES = [1.45, -1.45, 2.35, -2.35, 0.85, -0.85];

// Assign cooperative swarm roles to zombies in the player's vicinity so slow zombies
// flank from behind trees, block cabin exits, wait in corners, and smash through walls.
export function updateHordeTactics(run) {
  const { player: p, world, time } = run;
  const playerCabin = world.cabinAtPoint(p.x, p.z, 2.0);
  const awake = run.enemies.filter(e => !e.dead && !e.dormant && distance(e, p) < 34);

  // Squad awareness: if at least one zombie near the player is actively chasing, alert nearby
  // outdoor/adjacent zombies within 18 m to coordinate flanks instead of standing idle
  const primary = awake.find(e => e.target?.chase);
  if (primary) {
    let recruited = 0;
    for (const e of run.enemies) {
      if (e.dead || !e.dormant) continue;
      const d = distance(e, p);
      if (d > 24 || distance(e, primary) > 16) continue;
      // Indoor deeper-room zombies stay hidden as corner waiters unless very close or breached
      if (playerCabin && e.cabinId === playerCabin.id && d > 8.5 && recruited >= 2) continue;
      e.dormant = false;
      e.alerted = true;
      e.memory = { x: p.x, z: p.z, score: 1.4, reason: 'horde alert', id: 'horde', chase: true, until: time + run.rules.memorySeconds };
      if (++recruited >= 5) break;
    }
  }

  const squad = run.enemies
    .filter(e => !e.dead && !e.dormant && e.target?.chase && distance(e, p) < 32)
    .sort((a, b) => distance(a, p) - distance(b, p));

  if (!squad.length) return;

  // Reset per-tick tactical assignments cleanly
  for (const e of run.enemies) {
    if (e.dead) continue;
    if (e.dormant || !e.target?.chase) {
      e.tactic = null;
      e.preferBreak = false;
    }
  }

  // 1) Cabin Trap Tactics when player is inside or right at a cabin
  if (playerCabin) {
    let pushers = 0, breachers = 0, blockers = 0, waiters = 0;
    const doors = playerCabin.doors || [];
    const assignedDoors = new Set();

    for (const e of squad) {
      const gap = distance(e, p);
      const inSameCabin = playerCabin.contains(e.x, e.z, 2.5);

      // Door blockers: hold cabin exits so the player can't easily flee back out
      if (blockers < Math.min(2, doors.length) && (!inSameCabin || gap > 5.5)) {
        const door = doors
          .filter((_, idx) => !assignedDoors.has(idx))
          .sort((a, b) => distance(e, a) - distance(e, b))[0];
        if (door && distance(p, door) > 2.2) {
          const idx = doors.indexOf(door);
          assignedDoors.add(idx);
          const guardX = door.x + (door.axis === 'v' ? door.dir * 0.9 : 0);
          const guardZ = door.z + (door.axis === 'h' ? door.dir * 0.9 : 0);
          e.tactic = { role: 'doorBlocker', x: guardX, z: guardZ, holdNearDoor: distance(e, door) < 1.6 };
          e.preferBreak = false;
          blockers++;
          continue;
        }
      }

      // Wall breachers: indoor zombies in adjacent rooms smash straight through breakableWalls
      if (inSameCabin && breachers < 3 && playerCabin.breakableWalls.some(w => !w.broken)) {
        const nearWall = playerCabin.breakableWalls
          .filter(w => !w.broken && distance(e, w) < 7.5 && distance(p, w) < 9.5)
          .sort((a, b) => distance(e, a) - distance(e, b))[0];
        if (nearWall) {
          e.tactic = { role: 'breacher', x: p.x, z: p.z, targetWall: nearWall };
          e.preferBreak = true;
          breachers++;
          continue;
        }
      }

      // Direct pushers (keep to 1-2 so they don't form a single-file hallway line)
      if (pushers < 2 || gap < 3.4) {
        e.tactic = { role: 'pusher', x: p.x, z: p.z };
        e.preferBreak = false;
        pushers++;
        continue;
      }

      // Corner / side-room ambush waiters: hold adjacent rooms instead of flooding single-file
      if (inSameCabin && waiters < 4 && gap > 5.0) {
        e.tactic = { role: 'cornerWaiter', x: e.x, z: e.z };
        e.preferBreak = false;
        waiters++;
        continue;
      }

      e.tactic = { role: 'flanker', x: p.x, z: p.z };
      e.preferBreak = true;
    }
    return;
  }

  // 2) Outdoor Cooperative Flank & Tree-Cover Swarming
  const facing = p.yaw;
  let flankIdx = 0;
  for (const [rank, e] of squad.entries()) {
    const gap = distance(e, p);
    // Closest 1-2 pressure straight in (or if already close < 4.5 m, converge directly)
    if (rank < 2 || gap < 4.5) {
      e.tactic = { role: 'pusher', x: p.x, z: p.z };
      e.preferBreak = false;
      continue;
    }
    // Remaining squad members take wide angular flank waypoints using tree trunks for cover
    const angle = facing + FLANK_ANGLES[flankIdx % FLANK_ANGLES.length];
    flankIdx++;
    const ringDist = clamp(gap * 0.55, 3.8, 7.5);
    const fx = p.x + Math.sin(angle) * ringDist;
    const fz = p.z - Math.cos(angle) * ringDist;
    const cover = nearestTreeCover(world, e, { x: fx, z: fz }, p);
    const dest = cover || { x: fx, z: fz };
    e.tactic = { role: 'flanker', x: dest.x, z: dest.z };
    e.preferBreak = false;
  }
}
