import { buildCabinExposure, cabinPointVisible } from './cabins.js';
import { clamp, direction, distance } from './world.js';

// Find the concealed side of a tree trunk relative to the player (or an observer).
function treeHideSpot(tree, fromPos) {
  const dx = tree.x - fromPos.x, dz = tree.z - fromPos.z;
  const d = Math.hypot(dx, dz) || 1;
  const pad = tree.r + 0.78;
  return { x: tree.x + (dx / d) * pad, z: tree.z + (dz / d) * pad };
}

function cabinBlockedMask(cabin, world) {
  if (cabin._blockedMask) return cabin._blockedMask;
  const mask = new Uint8Array(cabin.cols * cabin.rows);
  for (let r = 0; r < cabin.rows; r++) {
    for (let c = 0; c < cabin.cols; c++) {
      const center = cabin.cellCenter(c, r);
      if (world.blocks(center.x, center.z, 0.38)) mask[r * cabin.cols + c] = 1;
    }
  }
  cabin._blockedMask = mask;
  return mask;
}

// Compute a concealed exterior door-trap spot tucked outside beside the doorframe or behind the retreat arc.
function doorTrapSpot(cabin, door, slotIdx, world) {
  const nx = door.axis === 'h' ? 0 : door.dir;
  const nz = door.axis === 'h' ? door.dir : 0;
  const tx = door.axis === 'h' ? 1 : 0;
  const tz = door.axis === 'h' ? 0 : 1;
  const offsets = [
    [1.85, 1.35],
    [1.85, -1.35],
    [2.95, 0],
    [2.65, 2.05],
    [2.65, -2.05],
  ];
  const [outDist, sideDist] = offsets[slotIdx % offsets.length];
  const sx = door.x + nx * outDist + tx * sideDist;
  const sz = door.z + nz * outDist + tz * sideDist;
  if (!world.blocks(sx, sz, 0.36)) return { x: sx, z: sz };
  const fallbackX = door.x + nx * 2.55;
  const fallbackZ = door.z + nz * 2.55;
  return !world.blocks(fallbackX, fallbackZ, 0.36) ? { x: fallbackX, z: fallbackZ } : { x: door.x + nx * 3.4, z: door.z + nz * 3.4 };
}

// Pick an unseen room/alcove cell inside the cabin so ambushers hide out of doorway sightlines.
function pickHiddenAmbushSpot(cabin, enemy, player, exposureGrid, blockedMask, claimedSpots) {
  const playerRoom = cabin.roomAt(player.x, player.z);
  const tryCell = (c, r, best, bestScore) => {
    const idx = r * cabin.cols + c;
    if (claimedSpots.has(idx) || blockedMask[idx] || exposureGrid[idx] !== 0) return null;
    const center = cabin.cellCenter(c, r);
    const gapToPlayer = distance(center, player);
    if (gapToPlayer < 2.8 || gapToPlayer > 14) return null;
    const candRoom = cabin.roomAt(center.x, center.z);
    const score = distance(enemy, center) + Math.abs(gapToPlayer - 5.2) * 0.75 + (candRoom === playerRoom ? 3.2 : 0);
    return score < bestScore ? { ...center, idx, score } : null;
  };

  let best = null, bestScore = Infinity;
  for (const spot of cabin.zombieSpots) {
    const res = tryCell(spot.c, spot.r, best, bestScore);
    if (res) { bestScore = res.score; best = res; }
  }
  if (!best) {
    for (let r = 0; r < cabin.rows; r++) {
      for (let c = 0; c < cabin.cols; c++) {
        const res = tryCell(c, r, best, bestScore);
        if (res) { bestScore = res.score; best = res; }
      }
    }
  }
  if (best) claimedSpots.add(best.idx);
  return best;
}

// Pick an intact breakableWall on an off-axis room boundary and return its hidden side for stealth breaching.
function pickFlankWall(cabin, enemy, player, claimedWalls) {
  const playerRoom = cabin.roomAt(player.x, player.z);
  const fwd = direction(player.yaw);
  let best = null, bestScore = Infinity;
  for (const bw of cabin.breakableWalls) {
    if (bw.broken || claimedWalls.has(bw.id)) continue;
    const dPlayer = distance(bw, player);
    if (dPlayer > 12.5) continue;
    const cellA = cabin.cellCenter(bw.cellA[0], bw.cellA[1]);
    const cellB = cabin.cellCenter(bw.cellB[0], bw.cellB[1]);
    const side = distance(cellA, player) >= distance(cellB, player) ? cellA : cellB;
    const dx = (bw.x - player.x) / (dPlayer || 1);
    const dz = (bw.z - player.z) / (dPlayer || 1);
    const frontAlign = dx * fwd.x + dz * fwd.z;
    const roomA = cabin.roomAt(cellA.x, cellA.z);
    const roomB = cabin.roomAt(cellB.x, cellB.z);
    const bordersPlayer = roomA === playerRoom || roomB === playerRoom;
    const score = distance(enemy, side) + (frontAlign > 0.72 ? 4.5 : 0) + (bordersPlayer ? -2.2 : 1.0);
    if (score < bestScore) {
      bestScore = score;
      best = { wall: bw, stage: side };
    }
  }
  if (best) claimedWalls.add(best.wall.id);
  return best;
}

// Choose an occluded lateral or rear cell in the cabin so flankers wrap around instead of funneling down one corridor.
function pickStealthFlankCell(cabin, enemy, player, exposureGrid, blockedMask) {
  const fwd = direction(player.yaw);
  const sideBias = enemy.id % 2 === 0 ? 1 : -1;
  let best = null, bestScore = Infinity;
  for (let r = 0; r < cabin.rows; r++) {
    for (let c = 0; c < cabin.cols; c++) {
      const idx = r * cabin.cols + c;
      if (blockedMask[idx]) continue;
      const center = cabin.cellCenter(c, r);
      const dPlayer = distance(center, player);
      if (dPlayer < 2.2 || dPlayer > 11.5) continue;
      const dx = (center.x - player.x) / dPlayer;
      const dz = (center.z - player.z) / dPlayer;
      const frontDot = dx * fwd.x + dz * fwd.z;
      const sideDot = (dx * -fwd.z + dz * fwd.x) * sideBias;
      const exposed = exposureGrid[idx] > 0;
      const score = (exposed ? 7.5 : 0) + Math.max(0, frontDot) * 4.5 - sideDot * 1.4 + Math.abs(dPlayer - 4.2) * 0.65 + distance(enemy, center) * 0.28;
      if (score < bestScore) {
        bestScore = score;
        best = center;
      }
    }
  }
  return best || { x: player.x, z: player.z };
}

export function strategicReturnPoint(run, enemy) {
  const { world, player: p } = run;
  const cabin = (enemy.cabinId && world.getCabin(enemy.cabinId)) || world.cabinAtPoint(enemy.x, enemy.z, 2);
  if (cabin) {
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
  for (const area of world.around(midX, midZ, 13)) {
    for (const tree of area.trees) {
      if (tree.r < 0.34) continue;
      const hide = treeHideSpot(tree, player);
      const dz = distance(zombie, hide), dd = distance(hide, dest);
      if (dz + dd > zToDest + 5.2) continue;
      if (distance(hide, player) < 3.4 || world.blocks(hide.x, hide.z, 0.35)) continue;
      const score = dz + dd * 0.85;
      if (score < bestScore) { bestScore = score; best = hide; }
    }
  }
  return best;
}

// Bias outdoor flankers toward the player's lateral & rear arcs rather than straight ahead.
const FLANK_ANGLES = [1.85, -1.85, 2.6, -2.6, 1.15, -1.15];

// Coordinate horde tactics using combat tokens/slots, LoS-avoiding stealth flanking,
// unseen room ambushes, interior wall breaches, and outdoor exit-sealing.
export function updateHordeTactics(run) {
  const { player: p, world, time } = run;
  const playerCabin = world.cabinAtPoint(p.x, p.z, 2.4);
  const awake = run.enemies.filter(e => !e.dead && !e.dormant && distance(e, p) < 34);
  run.cabinOccupied = null;

  // Squad awareness & pacing (Left 4 Dead director principle: never trigger an entire building into one doorway rush)
  const primary = awake.find(e => e.target?.chase);
  if (primary) {
    if (playerCabin) {
      // Outdoors: silently recruit up to 2 nearby zombies outside the cabin to circle and seal exits
      let outsideRecruited = 0;
      for (const e of run.enemies) {
        if (e.dead || !e.dormant || (e.cabinId === playerCabin.id && playerCabin.contains(e.x, e.z, 1.5))) continue;
        if (distance(e, p) > 28) continue;
        e.dormant = false;
        e.alerted = true;
        e.memory = { x: p.x, z: p.z, score: 1.25, reason: 'cabin trap', id: 'horde', chase: true, until: time + run.rules.memorySeconds + 2 };
        if (++outsideRecruited >= 2) break;
      }

      // Indoors: cap rapid cascade so back-room zombies wait silently in ambush or behind breakable walls
      const indoorAwakeCount = awake.filter(e => playerCabin.contains(e.x, e.z, 1.5)).length;
      if (indoorAwakeCount < 4) {
        let indoorRecruited = 0;
        for (const e of run.enemies) {
          if (e.dead || !e.dormant || e.cabinId !== playerCabin.id) continue;
          const d = distance(e, p);
          const nearWall = playerCabin.breakableWalls.some(w => !w.broken && distance(e, w) < 4.5);
          if (d > 8.2 && !nearWall) continue;
          e.dormant = false;
          e.alerted = true;
          e.memory = { x: p.x, z: p.z, score: 1.15, reason: 'indoor alert', id: 'horde', chase: true, until: time + run.rules.memorySeconds };
          if (++indoorRecruited >= 1 || indoorAwakeCount + indoorRecruited >= 4) break;
        }
      }
    } else {
      let recruited = 0;
      for (const e of run.enemies) {
        if (e.dead || !e.dormant) continue;
        const d = distance(e, p);
        if (d > 22 || distance(e, primary) > 16) continue;
        e.dormant = false;
        e.alerted = true;
        e.memory = { x: p.x, z: p.z, score: 1.35, reason: 'horde alert', id: 'horde', chase: true, until: time + run.rules.memorySeconds };
        if (++recruited >= 4) break;
      }
    }
  }

  const squad = run.enemies
    .filter(e => !e.dead && !e.dormant && e.target?.chase && distance(e, p) < 34)
    .sort((a, b) => distance(a, p) - distance(b, p));

  for (const e of run.enemies) {
    if (e.dead || e.dormant || !e.target?.chase || distance(e, p) >= 34) {
      e.tactic = null;
      e.preferBreak = false;
    }
  }
  if (!squad.length) return;

  // 1) Cabin Trap Tactics when player is inside or right at a cabin
  if (playerCabin) {
    const exposureGrid = buildCabinExposure(playerCabin, p, p.yaw);
    const blockedMask = cabinBlockedMask(playerCabin, world);
    const occupied = new Map();
    const key = (c, r) => r * playerCabin.cols + c;
    for (const e of squad) {
      if (!playerCabin.contains(e.x, e.z, 1.0)) continue;
      const [c, r] = playerCabin.worldToCell(e.x, e.z);
      const k = key(c, r);
      occupied.set(k, (occupied.get(k) || 0) + 1);
    }
    run.cabinOccupied = { cabinId: playerCabin.id, cells: occupied, exposureGrid };

    const indoor = [];
    const outdoor = [];
    for (const e of squad) {
      if (playerCabin.contains(e.x, e.z, 1.4)) indoor.push(e);
      else outdoor.push(e);
    }

    // 1A) Outdoor exit-sealing: zombies outside approach around the cabin exterior to trap every exit,
    // prioritizing the door closest to the player so retreating turns into an exterior ambush.
    const sortedDoors = [...(playerCabin.doors || [])].sort((a, b) => distance(a, p) - distance(b, p));
    const doorSlots = [];
    if (sortedDoors.length) {
      const cap = Math.min(4, sortedDoors.length * 2 + 1);
      for (let i = 0; i < cap; i++) {
        const door = sortedDoors[i === 2 && sortedDoors.length > 1 ? 1 : i % sortedDoors.length];
        doorSlots.push({ door, spot: doorTrapSpot(playerCabin, door, i, world) });
      }
    }

    let doorIdx = 0;
    let outFlankIdx = 0;
    const facing = p.yaw;
    for (const e of outdoor) {
      if (doorIdx < doorSlots.length) {
        const slot = doorSlots[doorIdx++];
        e.tactic = {
          role: 'doorSealer',
          cabinId: playerCabin.id,
          doorX: slot.door.x,
          doorZ: slot.door.z,
          x: slot.spot.x,
          z: slot.spot.z,
          holdNearDoor: true,
        };
        e.preferBreak = false;
        continue;
      }
      const angle = facing + FLANK_ANGLES[outFlankIdx % FLANK_ANGLES.length];
      outFlankIdx++;
      const ringDist = clamp(distance(e, p) * 0.55, 4.2, 8.2);
      const fx = p.x + Math.sin(angle) * ringDist;
      const fz = p.z - Math.cos(angle) * ringDist;
      const cover = nearestTreeCover(world, e, { x: fx, z: fz }, p);
      const dest = cover || { x: fx, z: fz };
      e.tactic = { role: 'flanker', x: dest.x, z: dest.z };
      e.preferBreak = false;
    }

    // 1B) Indoor tokens & stealth maneuvers:
    // Strictly 1 frontal pusher at a time; others split across hidden corners, interior breakable walls, and stealth flank routes.
    let pushers = 0, breachers = 0, waiters = 0;
    const claimedWalls = new Set();
    const claimedSpots = new Set();
    const playerRoom = playerCabin.roomAt(p.x, p.z);

    for (const e of indoor) {
      const gap = distance(e, p);
      const enemyRoom = playerCabin.roomAt(e.x, e.z);
      const canSeePlayer = cabinPointVisible(playerCabin, p, e.x, e.z);

      // Token 1: strictly ONE frontal pusher (plus anyone already in immediate lunge reach <= 2.3m)
      if ((pushers < 1 && (canSeePlayer || enemyRoom === playerRoom || gap < 4.5)) || gap < 2.3) {
        e.tactic = { role: 'pusher', x: p.x, z: p.z };
        e.preferBreak = false;
        pushers++;
        continue;
      }

      // Slot 2: stealth interior wall breachers attacking from hidden adjacent rooms/sides
      if (breachers < 3 && playerCabin.breakableWalls.some(w => !w.broken)) {
        const pick = pickFlankWall(playerCabin, e, p, claimedWalls);
        if (pick) {
          e.tactic = { role: 'wallAmbusher', x: pick.stage.x, z: pick.stage.z, targetWall: pick.wall };
          e.preferBreak = true;
          breachers++;
          continue;
        }
      }

      // Slot 3: corner/alcove ambush waiters holding out of doorway sight until the player moves in
      if (waiters < 6 && gap > 3.6) {
        const currentHidden = !canSeePlayer && enemyRoom !== playerRoom && gap < 11.5;
        const holdSpot = currentHidden ? { x: e.x, z: e.z } : pickHiddenAmbushSpot(playerCabin, e, p, exposureGrid, blockedMask, claimedSpots);
        if (holdSpot) {
          e.tactic = { role: 'cornerAmbush', x: holdSpot.x, z: holdSpot.z, room: playerCabin.roomAt(holdSpot.x, holdSpot.z) };
          e.preferBreak = false;
          waiters++;
          continue;
        }
      }

      // Slot 4: remaining indoor zombies take stealth LoS-avoiding flank paths to side/behind the player
      const flankCell = pickStealthFlankCell(playerCabin, e, p, exposureGrid, blockedMask);
      e.tactic = { role: 'stealthFlanker', x: flankCell.x, z: flankCell.z };
      e.preferBreak = true;
    }
    return;
  }

  // 2) Outdoor Cooperative Flank & Tree-Cover Encirclement (2 frontal pushers max, rest wide behind trees)
  const facing = p.yaw;
  let pushers = 0;
  let flankIdx = 0;
  for (const e of squad) {
    const gap = distance(e, p);
    if (pushers < 2 || gap < 3.6) {
      e.tactic = { role: 'pusher', x: p.x, z: p.z };
      e.preferBreak = false;
      pushers++;
      continue;
    }
    const angle = facing + FLANK_ANGLES[flankIdx % FLANK_ANGLES.length];
    flankIdx++;
    const ringDist = clamp(gap * 0.55, 4.0, 8.0);
    const fx = p.x + Math.sin(angle) * ringDist;
    const fz = p.z - Math.cos(angle) * ringDist;
    const cover = nearestTreeCover(world, e, { x: fx, z: fz }, p);
    const dest = cover || { x: fx, z: fz };
    e.tactic = { role: 'flanker', x: dest.x, z: dest.z };
    e.preferBreak = false;
  }
}
