import { createLabyrinth, LABYRINTH_CELL, LABYRINTH_DOOR_HEIGHT, LABYRINTH_HEIGHT } from './labyrinth.js';

export const CHUNK = 48;
export const START = { x: 0, z: 0 };

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

function rayAABB(origin, ray, minX, maxX, minY, maxY, minZ, maxZ, max) {
  let near = 0, far = max;
  for (const [o, d, lo, hi] of [
    [origin.x, ray.x, minX, maxX],
    [origin.y, ray.y, minY, maxY],
    [origin.z, ray.z, minZ, maxZ],
  ]) {
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let a = (lo - o) / d, b = (hi - o) / d;
      if (a > b) [a, b] = [b, a];
      near = Math.max(near, a);
      far = Math.min(far, b);
      if (near > far) return Infinity;
    }
  }
  return near;
}

function circleHitsBox(x, z, radius, bx, bz, rx, rz) {
  const dx = Math.max(0, Math.abs(x - bx) - rx);
  const dz = Math.max(0, Math.abs(z - bz) - rz);
  return dx * dx + dz * dz < radius * radius;
}

export function createWorld(seed, opts = {}) {
  const mazeSize = opts.mazeSize || 64;
  const ammoScale = opts.ammoScale || 1.0;
  const labyrinth = createLabyrinth(seed, mazeSize, ammoScale);
  const { cols, rows, minX, maxX, minZ, maxZ, hEdges, vEdges } = labyrinth;
  const ht = 0.12;
  const pad = 0.048;
  const chunks = new Map();

  const makeChunk = (cx, cz) => {
    const left = cx * CHUNK, top = cz * CHUNK;
    const right = left + CHUNK, bottom = top + CHUNK;
    const inChunk = (x, z) => x >= left && x < right && z >= top && z < bottom;
    return {
      key: `${cx},${cz}`,
      cx,
      cz,
      x: left,
      z: top,
      floor: {
        x: Math.max(left, minX),
        z: Math.max(top, minZ),
        w: Math.max(0, Math.min(right, maxX) - Math.max(left, minX)),
        d: Math.max(0, Math.min(bottom, maxZ) - Math.max(top, minZ)),
      },
      colliders: labyrinth.wallBoxes.filter(b => inChunk(b.x, b.z)),
      ceilings: labyrinth.ceilings.filter(c => inChunk(c.x, c.z)),
      hazards: labyrinth.hazards.filter(h => inChunk(h.x, h.z)),
      loot: labyrinth.lootSites.filter(l => inChunk(l.x, l.z)),
      exit: inChunk(labyrinth.exit.x, labyrinth.exit.z) ? labyrinth.exit : null,
    };
  };

  function chunk(cx, cz) {
    const key = `${cx},${cz}`;
    let value = chunks.get(key);
    if (!value) {
      value = makeChunk(cx, cz);
      chunks.set(key, value);
    }
    return value;
  }

  function around(x, z, radius) {
    const result = [];
    for (let j = Math.floor((z - radius) / CHUNK); j <= Math.floor((z + radius) / CHUNK); j++) {
      for (let i = Math.floor((x - radius) / CHUNK); i <= Math.floor((x + radius) / CHUNK); i++) {
        result.push(chunk(i, j));
      }
    }
    return result;
  }

  const height = () => 0;

  function insideMaze(x, z, margin = 0) {
    return x >= minX + margin && x <= maxX - margin && z >= minZ + margin && z <= maxZ - margin;
  }

  // O(1) wall-edge & doorway jamb collision lookup directly on the labyrinth grid
  function blocks(x, z, radius = 0.26) {
    if (!insideMaze(x, z, radius)) return true;
    const cc = Math.floor((x - minX) / LABYRINTH_CELL);
    const cr = Math.floor((z - minZ) / LABYRINTH_CELL);
    const cLo = Math.max(0, cc - 1), cHi = Math.min(cols - 1, cc + 1);
    const rLo = Math.max(0, cr - 1), rHi = Math.min(rows - 1, cr + 1);

    for (let r = rLo; r <= rHi + 1 && r <= rows; r++) {
      const zLine = minZ + r * LABYRINTH_CELL;
      if (Math.abs(z - zLine) > radius + ht) continue;
      for (let c = cLo; c <= cHi; c++) {
        const ch = hEdges[r][c];
        if (ch === '.') continue;
        const xCell = minX + (c + 0.5) * LABYRINTH_CELL;
        if (ch === '#') {
          if (circleHitsBox(x, z, radius, xCell, zLine, LABYRINTH_CELL / 2 + pad, ht)) return true;
        } else if (ch === 'D' || ch === 'E') {
          if (circleHitsBox(x, z, radius, xCell - 0.85, zLine, 0.15, ht)) return true;
          if (circleHitsBox(x, z, radius, xCell + 0.85, zLine, 0.15, ht)) return true;
        }
      }
    }

    for (let c = cLo; c <= cHi + 1 && c <= cols; c++) {
      const xLine = minX + c * LABYRINTH_CELL;
      if (Math.abs(x - xLine) > radius + ht) continue;
      for (let r = rLo; r <= rHi; r++) {
        const ch = vEdges[r][c];
        if (ch === '.') continue;
        const zCell = minZ + (r + 0.5) * LABYRINTH_CELL;
        if (ch === '#') {
          if (circleHitsBox(x, z, radius, xLine, zCell, ht, LABYRINTH_CELL / 2 + pad)) return true;
        } else if (ch === 'D' || ch === 'E') {
          if (circleHitsBox(x, z, radius, xLine, zCell - 0.85, ht, 0.15)) return true;
          if (circleHitsBox(x, z, radius, xLine, zCell + 0.85, ht, 0.15)) return true;
        }
      }
    }
    return false;
  }

  function move(point, dx, dz, radius) {
    if (!blocks(point.x + dx, point.z + dz, radius)) {
      point.x += dx;
      point.z += dz;
      return { clipped: false };
    }
    let movedAny = false;
    if (Math.abs(dx) > 1e-6 && !blocks(point.x + dx, point.z, radius)) {
      point.x += dx;
      movedAny = true;
    }
    if (Math.abs(dz) > 1e-6 && !blocks(point.x, point.z + dz, radius)) {
      point.z += dz;
      movedAny = true;
    }
    return { clipped: !movedAny || Math.abs(dx) > 1e-6 || Math.abs(dz) > 1e-6 };
  }

  function testCellEdges(origin, ray, c, r, limit) {
    let bestT = Infinity, bestKind = null;
    const hitEdge = (loX, hiX, loY, hiY, loZ, hiZ, kind) => {
      const t = rayAABB(origin, ray, loX, hiX, loY, hiY, loZ, hiZ, Math.min(limit, bestT));
      if (t < bestT && t <= limit) { bestT = t; bestKind = kind; }
    };

    const x0 = minX + c * LABYRINTH_CELL, x1 = x0 + LABYRINTH_CELL;
    const z0 = minZ + r * LABYRINTH_CELL, z1 = z0 + LABYRINTH_CELL;

    for (const [edgeR, zL] of [[r, z0], [r + 1, z1]]) {
      const ch = hEdges[edgeR]?.[c];
      if (!ch || ch === '.') continue;
      if (ch === '#') {
        hitEdge(x0 - pad, x1 + pad, 0, LABYRINTH_HEIGHT, zL - ht, zL + ht, 'labWall');
      } else {
        hitEdge(x0, x0 + 0.30, 0, LABYRINTH_HEIGHT, zL - ht, zL + ht, 'labWall');
        hitEdge(x1 - 0.30, x1, 0, LABYRINTH_HEIGHT, zL - ht, zL + ht, 'labWall');
        hitEdge(x0, x1, LABYRINTH_DOOR_HEIGHT, LABYRINTH_HEIGHT, zL - ht, zL + ht, 'labLintel');
      }
    }

    for (const [edgeC, xL] of [[c, x0], [c + 1, x1]]) {
      const ch = vEdges[r]?.[edgeC];
      if (!ch || ch === '.') continue;
      if (ch === '#') {
        hitEdge(xL - ht, xL + ht, 0, LABYRINTH_HEIGHT, z0 - pad, z1 + pad, 'labWall');
      } else {
        hitEdge(xL - ht, xL + ht, 0, LABYRINTH_HEIGHT, z0, z0 + 0.30, 'labWall');
        hitEdge(xL - ht, xL + ht, 0, LABYRINTH_HEIGHT, z1 - 0.30, z1, 'labWall');
        hitEdge(xL - ht, xL + ht, LABYRINTH_DOOR_HEIGHT, LABYRINTH_HEIGHT, z0, z1, 'labLintel');
      }
    }

    return bestKind ? { t: bestT, kind: bestKind } : null;
  }

  // Fast 2D Grid DDA raycast through traversed labyrinth cells
  function raycast(origin, ray, range, ground = true) {
    let limit = range;
    let groundKind = null;
    if (ground) {
      if (ray.y < -1e-4 && origin.y > 0) {
        const floorT = -origin.y / ray.y;
        if (floorT > 0 && floorT < limit) { limit = floorT; groundKind = 'floor'; }
      }
      if (ray.y > 1e-4 && origin.y < LABYRINTH_HEIGHT) {
        const ceilT = (LABYRINTH_HEIGHT - origin.y) / ray.y;
        if (ceilT > 0 && ceilT < limit) { limit = ceilT; groundKind = 'ceiling'; }
      }
    }

    let c = clamp(Math.floor((origin.x - minX) / LABYRINTH_CELL), 0, cols - 1);
    let r = clamp(Math.floor((origin.z - minZ) / LABYRINTH_CELL), 0, rows - 1);
    const stepC = ray.x >= 0 ? 1 : -1;
    const stepR = ray.z >= 0 ? 1 : -1;
    const tDeltaX = Math.abs(ray.x) > 1e-7 ? LABYRINTH_CELL / Math.abs(ray.x) : Infinity;
    const tDeltaZ = Math.abs(ray.z) > 1e-7 ? LABYRINTH_CELL / Math.abs(ray.z) : Infinity;
    let tMaxX = Math.abs(ray.x) > 1e-7
      ? ((minX + (c + (ray.x >= 0 ? 1 : 0)) * LABYRINTH_CELL) - origin.x) / ray.x : Infinity;
    let tMaxZ = Math.abs(ray.z) > 1e-7
      ? ((minZ + (r + (ray.z >= 0 ? 1 : 0)) * LABYRINTH_CELL) - origin.z) / ray.z : Infinity;

    let bestT = limit, bestKind = groundKind;
    const maxSteps = cols + rows + 4;
    for (let step = 0; step < maxSteps; step++) {
      if (c >= 0 && c < cols && r >= 0 && r < rows) {
        const hit = testCellEdges(origin, ray, c, r, bestT);
        if (hit && hit.t < bestT) {
          bestT = hit.t;
          bestKind = hit.kind;
        }
      }
      const nextT = Math.min(tMaxX, tMaxZ);
      if (nextT > bestT || nextT > limit) break;
      if (tMaxX < tMaxZ) {
        c += stepC;
        tMaxX += tDeltaX;
      } else {
        r += stepR;
        tMaxZ += tDeltaZ;
      }
      if (c < -1 || c > cols || r < -1 || r > rows) break;
    }

    return bestKind ? { t: bestT, kind: bestKind, object: null } : null;
  }

  function clear(a, b, ground = false) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    return len <= 0.14 || !raycast(a, { x: dx / len, y: dy / len, z: dz / len }, len - 0.12, ground);
  }

  return {
    seed,
    phase: 0,
    labyrinth,
    start: labyrinth.start,
    exit: labyrinth.exit,
    bounds: { min: minX, max: maxX },
    sizeMeters: mazeSize,
    height,
    zoneAt: labyrinth.zoneAt,
    chunk,
    around,
    blocks,
    move,
    raycast,
    clear,
  };
}
