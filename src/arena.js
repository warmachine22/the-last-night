export const ARENA_HEIGHT = 4.35;
export const ARENA_DOOR_HEIGHT = 2.65;
export const ARENA_DOOR_WIDTH = 2.2;
export const ARENA_SHIFT_INTERVAL = 30;
export const ARENA_SHIFT_SPEED = ARENA_HEIGHT / 1.55;

function hash(value) {
  let h = 2166136261;
  for (const ch of String(value)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function makeRng(seed) {
  let state = hash(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function circleHitsBox(x, z, radius, bx, bz, rx, rz) {
  const dx = Math.max(0, Math.abs(x - bx) - rx);
  const dz = Math.max(0, Math.abs(z - bz) - rz);
  return dx * dx + dz * dz < radius * radius;
}

function rayAABB(origin, ray, minX, maxX, minY, maxY, minZ, maxZ, max) {
  let near = -Infinity, far = max;
  let nx = 0, ny = 0, nz = 0;
  for (const [axis, o, d, lo, hi] of [
    [0, origin.x, ray.x, minX, maxX],
    [1, origin.y, ray.y, minY, maxY],
    [2, origin.z, ray.z, minZ, maxZ],
  ]) {
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    let sign = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      sign = 1;
    }
    if (t1 > near) {
      near = t1;
      nx = axis === 0 ? sign : 0;
      ny = axis === 1 ? sign : 0;
      nz = axis === 2 ? sign : 0;
    }
    if (t2 < far) far = t2;
    if (near > far) return null;
  }
  if (near <= 0.001 || near > max) return null;
  return { t: near, normal: { x: nx, y: ny, z: nz } };
}

// Builds a 6-sided regular hexagonal combat arena with 6 doorway entry alcoves and
// a uniform grid of floor cubes that shift vertically in multi-block patterns every 30 s.
export function createArena(seed, { diameter = 24, cellSize = 2.2 } = {}) {
  const rng = makeRng(`${seed}:arena:${diameter}`);
  const apothem = diameter / 2;
  const circumradius = apothem / Math.cos(Math.PI / 6);
  const sideLen = 2 * apothem * Math.tan(Math.PI / 6);
  const doorHalf = ARENA_DOOR_WIDTH / 2;
  const wallThickness = 0.28;
  const alcoveDepth = 3.2;

  // 6 hexagon faces (apothem normals at 30°, 90°, 150°, 210°, 270°, 330°)
  const faces = Array.from({ length: 6 }, (_, i) => {
    const angle = (i * Math.PI) / 3 + Math.PI / 6;
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const tx = -nz;
    const tz = nx;
    return {
      id: i,
      angle,
      nx,
      nz,
      tx,
      tz,
      cx: nx * apothem,
      cz: nz * apothem,
      spawnX: nx * (apothem + 1.15),
      spawnZ: nz * (apothem + 1.15),
      entryX: nx * Math.max(2, apothem - cellSize * 0.9),
      entryZ: nz * Math.max(2, apothem - cellSize * 0.9),
      yaw: Math.atan2(-nx, nz),
    };
  });

  // Interior cube grid strictly inside the hexagon
  const halfExtent = apothem + cellSize * 0.5;
  const gridRadius = Math.floor(halfExtent / cellSize);
  const cols = gridRadius * 2 + 1;
  const rows = cols;
  const minX = -(cols * cellSize) / 2;
  const minZ = -(rows * cellSize) / 2;

  const tiles = [];
  const tileGrid = Array.from({ length: rows }, () => Array(cols).fill(null));
  const cubeMargin = cellSize * 0.45 + 0.35;

  const insideHex = (x, z, margin = 0) => {
    for (const f of faces) {
      if (x * f.nx + z * f.nz > apothem - margin) return false;
    }
    return true;
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = minX + (c + 0.5) * cellSize;
      const cz = minZ + (r + 0.5) * cellSize;
      if (!insideHex(cx, cz, 0.08)) continue;
      const nearDoor = faces.some(f => Math.hypot(cx - f.cx, cz - f.cz) < cellSize * 1.15);
      const nearCenter = Math.hypot(cx, cz) < cellSize * 0.85;
      const canRaise = insideHex(cx, cz, cubeMargin) && !nearDoor;
      const tile = {
        id: tiles.length,
        c,
        r,
        x: cx,
        z: cz,
        size: cellSize,
        height: 0,
        targetHeight: 0,
        nearDoor,
        nearCenter,
        canRaise,
        solid: false,
      };
      tileGrid[r][c] = tile;
      tiles.push(tile);
    }
  }

  const worldToCell = (wx, wz) => [
    Math.max(0, Math.min(cols - 1, Math.floor((wx - minX) / cellSize))),
    Math.max(0, Math.min(rows - 1, Math.floor((wz - minZ) / cellSize))),
  ];

  const tileAt = (wx, wz) => {
    const [c, r] = worldToCell(wx, wz);
    return tileGrid[r]?.[c] || null;
  };

  function nearestWalkableTile(wx, wz, blockedSet = null) {
    const direct = tileAt(wx, wz);
    if (direct && !direct.solid && (!blockedSet || !blockedSet.has(direct.id))) return direct;
    let best = null;
    let bestDist = Infinity;
    for (const t of tiles) {
      if (t.solid || (blockedSet && blockedSet.has(t.id))) continue;
      const d = (t.x - wx) ** 2 + (t.z - wz) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return best;
  }

  // Pre-build wall / doorway jamb / alcove colliders for rendering & raycasting
  const wallSegments = [];
  for (const f of faces) {
    const segW = Math.max(0.4, (sideLen - ARENA_DOOR_WIDTH) / 2);
    const jambOffset = doorHalf + segW / 2;
    const angleY = Math.atan2(-f.nx, -f.nz);
    // Left & right wall segments flanking the 6 doorways
    wallSegments.push({
      x: f.cx - f.tx * jambOffset,
      z: f.cz - f.tz * jambOffset,
      y: ARENA_HEIGHT / 2,
      w: segW + 0.14,
      h: ARENA_HEIGHT,
      d: wallThickness,
      angleY,
      tint: 0x383b40,
    });
    wallSegments.push({
      x: f.cx + f.tx * jambOffset,
      z: f.cz + f.tz * jambOffset,
      y: ARENA_HEIGHT / 2,
      w: segW + 0.14,
      h: ARENA_HEIGHT,
      d: wallThickness,
      angleY,
      tint: 0x383b40,
    });
    // Doorway lintel
    wallSegments.push({
      x: f.cx,
      z: f.cz,
      y: (ARENA_HEIGHT + ARENA_DOOR_HEIGHT) / 2,
      w: ARENA_DOOR_WIDTH + 0.12,
      h: ARENA_HEIGHT - ARENA_DOOR_HEIGHT,
      d: wallThickness,
      angleY,
      tint: 0x2d3035,
    });
    // Short dark exterior spawn alcove behind each doorway so zombies emerge out of darkness
    wallSegments.push({
      x: f.cx + f.nx * alcoveDepth - f.tx * 0,
      z: f.cz + f.nz * alcoveDepth,
      y: ARENA_DOOR_HEIGHT / 2 + 0.2,
      w: ARENA_DOOR_WIDTH + 0.6,
      h: ARENA_DOOR_HEIGHT + 0.4,
      d: 0.24,
      angleY,
      tint: 0x1e2024,
    });
    for (const side of [-1, 1]) {
      wallSegments.push({
        x: f.cx + f.nx * (alcoveDepth / 2) + f.tx * side * (doorHalf + 0.14),
        z: f.cz + f.nz * (alcoveDepth / 2) + f.tz * side * (doorHalf + 0.14),
        y: ARENA_DOOR_HEIGHT / 2 + 0.2,
        w: 0.24,
        h: ARENA_DOOR_HEIGHT + 0.4,
        d: alcoveDepth,
        angleY,
        tint: 0x24262b,
      });
    }
  }

  // BFS reachability check BEFORE shifting: verifies player, every living zombie,
  // and all 6 doorway entries belong to one connected partition with zero blocked pockets.
  function allZonesConnected(blockedSet, originTile, requiredTiles) {
    if (!originTile || blockedSet.has(originTile.id)) return false;
    const seen = new Set([originTile.id]);
    const queue = [originTile];
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = tileGrid[cur.r + dr]?.[cur.c + dc];
        if (!next || blockedSet.has(next.id) || seen.has(next.id)) continue;
        seen.add(next.id);
        queue.push(next);
      }
    }
    for (const req of requiredTiles) {
      if (req && !seen.has(req.id)) return false;
    }
    return true;
  }

  // Picks unoccupied multi-cube formations (2, 3, or 4 consecutive blocks / L-shapes)
  // while leaving tiles under the player, any zombie, or doorway openings completely clear
  // and pre-validating full room reachability so raised blocks never partition the arena.
  function shiftLayout(occupants = [], initial = false) {
    const halfTile = cellSize / 2;
    const occupied = new Set();
    const requiredTiles = [];
    for (const occ of occupants) {
      const pad = occ.radius ?? 0.55;
      for (const t of tiles) {
        if (circleHitsBox(occ.x, occ.z, pad, t.x, t.z, halfTile, halfTile)) {
          occupied.add(t.id);
        }
      }
      if (insideHex(occ.x, occ.z, 0)) {
        const ot = nearestWalkableTile(occ.x, occ.z);
        if (ot) requiredTiles.push(ot);
      }
    }
    for (const f of faces) {
      const dt = nearestWalkableTile(f.entryX, f.entryZ);
      if (dt) requiredTiles.push(dt);
    }

    const originTile = requiredTiles[0] || nearestWalkableTile(0, 0);
    const chosen = new Set();
    const raisePool = tiles.filter(t => t.canRaise && !(initial && t.nearCenter) && !occupied.has(t.id));
    const budget = Math.max(3, Math.round(raisePool.length * (initial ? 0.22 : 0.30)));

    for (let i = raisePool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [raisePool[i], raisePool[j]] = [raisePool[j], raisePool[i]];
    }

    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const diagAndOrth = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc || dr) diagAndOrth.push([dc, dr]);
      }
    }

    for (const seedTile of raisePool) {
      if (chosen.size >= budget) break;
      if (chosen.has(seedTile.id)) continue;

      // Form 2, 3, or 4 consecutive blocks (straight bars or L-shapes)
      const len = 2 + Math.floor(rng() * 3);
      const shape = [seedTile];
      let [dc, dr] = dirs[Math.floor(rng() * dirs.length)];
      let cur = seedTile;
      for (let step = 1; step < len; step++) {
        if (step >= 2 && rng() < 0.42) {
          [dc, dr] = rng() < 0.5 ? [-dr, dc] : [dr, -dc];
        }
        const next = tileGrid[cur.r + dr]?.[cur.c + dc];
        if (!next || !next.canRaise || (initial && next.nearCenter) || occupied.has(next.id) || chosen.has(next.id)) break;
        if (shape.includes(next)) break;
        shape.push(next);
        cur = next;
      }

      if (shape.length < 2) continue;
      // 8-connected spacing check so shapes never pinch diagonally or seal off sightlines/alleys
      const touchesChosen = shape.some(s => diagAndOrth.some(([x, y]) => {
        const nb = tileGrid[s.r + y]?.[s.c + x];
        return nb && chosen.has(nb.id) && !shape.includes(nb);
      }));
      if (touchesChosen) continue;

      for (const s of shape) chosen.add(s.id);
      if (!allZonesConnected(chosen, originTile, requiredTiles)) {
        for (const s of shape) chosen.delete(s.id);
      }
    }

    for (const t of tiles) {
      t.targetHeight = t.canRaise && chosen.has(t.id) ? ARENA_HEIGHT : 0;
    }
    return chosen.size;
  }

  function stepAnimation(dt) {
    let moving = false;
    for (const t of tiles) {
      const diff = t.targetHeight - t.height;
      if (Math.abs(diff) > 0.001) {
        const step = Math.sign(diff) * Math.min(Math.abs(diff), ARENA_SHIFT_SPEED * dt);
        t.height += step;
        moving = true;
      } else {
        t.height = t.targetHeight;
      }
      t.solid = t.height >= 0.45;
    }
    return moving;
  }

  function openFloorPoints(count = 6) {
    const open = tiles.filter(t => !t.nearDoor && t.targetHeight === 0 && t.height < 0.3);
    for (let i = open.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [open[i], open[j]] = [open[j], open[i]];
    }
    return open.slice(0, count);
  }

  function blocks(x, z, radius = 0.26, allowDoorAlcove = false) {
    // Check hexagon perimeter walls (allowing passage cleanly through the 6 doorways into alcoves)
    for (const f of faces) {
      const dot = x * f.nx + z * f.nz;
      const along = Math.abs(x * f.tx + z * f.tz);
      const inDoorGap = along <= doorHalf - radius;
      if (dot > apothem - radius) {
        if (!allowDoorAlcove || !inDoorGap) return true;
        if (dot > apothem + alcoveDepth - radius - 0.2) return true;
        return false;
      }
    }

    // Check active raised floor cubes around (x, z)
    const [cc, cr] = worldToCell(x, z);
    const half = cellSize / 2;
    for (let r = Math.max(0, cr - 1); r <= Math.min(rows - 1, cr + 1); r++) {
      for (let c = Math.max(0, cc - 1); c <= Math.min(cols - 1, cc + 1); c++) {
        const t = tileGrid[r][c];
        if (!t || !t.solid) continue;
        if (circleHitsBox(x, z, radius, t.x, t.z, half, half)) return true;
      }
    }
    return false;
  }

  function raycast(origin, ray, range, ground = true) {
    let bestT = range, bestKind = null, bestNormal = null;
    if (ground) {
      if (ray.y < -1e-4 && origin.y > 0) {
        const floorT = -origin.y / ray.y;
        if (floorT > 0 && floorT < bestT) { bestT = floorT; bestKind = 'floor'; bestNormal = { x: 0, y: 1, z: 0 }; }
      }
      if (ray.y > 1e-4 && origin.y < ARENA_HEIGHT) {
        const ceilT = (ARENA_HEIGHT - origin.y) / ray.y;
        if (ceilT > 0 && ceilT < bestT) { bestT = ceilT; bestKind = 'ceiling'; bestNormal = { x: 0, y: -1, z: 0 }; }
      }
    }

    // Ray vs 6 hexagon walls (handling open doorway cutouts)
    for (const f of faces) {
      const denom = ray.x * f.nx + ray.z * f.nz;
      if (denom <= 1e-6) continue;
      const t = (apothem - (origin.x * f.nx + origin.z * f.nz)) / denom;
      if (t <= 0.001 || t >= bestT) continue;
      const hx = origin.x + ray.x * t, hz = origin.z + ray.z * t, hy = origin.y + ray.y * t;
      const along = Math.abs(hx * f.tx + hz * f.tz);
      if (along <= sideLen / 2 + 0.05) {
        if (along < doorHalf && hy >= 0 && hy <= ARENA_DOOR_HEIGHT) {
          const backT = (apothem + alcoveDepth - (origin.x * f.nx + origin.z * f.nz)) / denom;
          if (backT > t && backT < bestT) {
            bestT = backT;
            bestKind = 'labWall';
            bestNormal = { x: -f.nx, y: 0, z: -f.nz };
          }
          continue;
        }
        bestT = t;
        bestKind = hy > ARENA_DOOR_HEIGHT ? 'labLintel' : 'labWall';
        bestNormal = { x: -f.nx, y: 0, z: -f.nz };
      }
    }

    // Fast 2D DDA across cube grid for raised pillars
    const half = cellSize / 2;
    let c = Math.max(0, Math.min(cols - 1, Math.floor((origin.x - minX) / cellSize)));
    let r = Math.max(0, Math.min(rows - 1, Math.floor((origin.z - minZ) / cellSize)));
    const stepC = ray.x >= 0 ? 1 : -1;
    const stepR = ray.z >= 0 ? 1 : -1;
    const tDeltaX = Math.abs(ray.x) > 1e-7 ? cellSize / Math.abs(ray.x) : Infinity;
    const tDeltaZ = Math.abs(ray.z) > 1e-7 ? cellSize / Math.abs(ray.z) : Infinity;
    let tMaxX = Math.abs(ray.x) > 1e-7 ? ((minX + (c + (ray.x >= 0 ? 1 : 0)) * cellSize) - origin.x) / ray.x : Infinity;
    let tMaxZ = Math.abs(ray.z) > 1e-7 ? ((minZ + (r + (ray.z >= 0 ? 1 : 0)) * cellSize) - origin.z) / ray.z : Infinity;

    for (let step = 0; step < cols + rows + 4; step++) {
      const tile = tileGrid[r]?.[c];
      if (tile && tile.solid) {
        const hit = rayAABB(origin, ray, tile.x - half, tile.x + half, 0, tile.height, tile.z - half, tile.z + half, bestT);
        if (hit && hit.t < bestT) {
          bestT = hit.t;
          bestKind = 'labWall';
          bestNormal = hit.normal;
          break;
        }
      }
      const nextT = Math.min(tMaxX, tMaxZ);
      if (nextT > bestT) break;
      if (tMaxX < tMaxZ) { c += stepC; tMaxX += tDeltaX; }
      else { r += stepR; tMaxZ += tDeltaZ; }
      if (c < 0 || c >= cols || r < 0 || r >= rows) break;
    }

    return bestKind ? { t: bestT, kind: bestKind, normal: bestNormal, object: null } : null;
  }

  function findStep(fromPos, toPos) {
    // Zombies inside an exterior doorway alcove first walk cleanly inward through their open door
    for (const f of faces) {
      if (fromPos.x * f.nx + fromPos.z * f.nz > apothem - 0.15) {
        return { x: f.entryX, z: f.entryZ };
      }
    }

    const startTile = nearestWalkableTile(fromPos.x, fromPos.z);
    const goalTile = nearestWalkableTile(toPos.x, toPos.z);
    if (!startTile || !goalTile) return toPos;
    const sc = startTile.c, sr = startTile.r;
    const tc = goalTile.c, tr = goalTile.r;
    if (sc === tc && sr === tr) return toPos;

    const key = (c, r) => r * cols + c;
    const goalKey = key(tc, tr);
    const queue = [[sc, sr]];
    const parent = new Map([[key(sc, sr), null]]);
    const maxNodes = rows * cols + 16;

    let found = false;
    for (let head = 0; head < queue.length && queue.length < maxNodes; head++) {
      const [c, r] = queue[head];
      if (key(c, r) === goalKey) { found = true; break; }
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        const nb = tileGrid[nr]?.[nc];
        if (!nb) continue;
        if ((nb.solid || nb.targetHeight > 0) && key(nc, nr) !== goalKey) continue;
        const nk = key(nc, nr);
        if (parent.has(nk)) continue;
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
    const nextTile = tileGrid[cur[1]]?.[cur[0]];
    return nextTile ? { x: nextTile.x, z: nextTile.z } : toPos;
  }

  // Initial cube formation right at run start with safe margin around player spawn (0, 0)
  shiftLayout([{ x: 0, z: 0, radius: cellSize * 1.1 }], true);
  for (const t of tiles) {
    t.height = t.targetHeight;
    t.solid = t.height >= 0.45;
  }

  const raiseTiles = tiles.filter(t => t.canRaise);

  return {
    diameter,
    apothem,
    circumradius,
    sideLen,
    cellSize,
    cols,
    rows,
    faces,
    tiles,
    raiseTiles,
    tileGrid,
    wallSegments,
    start: { x: 0, z: 0 },
    shiftLayout,
    stepAnimation,
    openFloorPoints,
    blocks,
    raycast,
    findStep,
    tileAt,
    allZonesConnected,
  };
}
