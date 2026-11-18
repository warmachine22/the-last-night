export const LABYRINTH_CELL = 3.0;
export const LABYRINTH_HEIGHT = 4.35;
export const LABYRINTH_DOOR_HEIGHT = 2.65;
export const LABYRINTH_JAMB = 0.50;

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

class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false;
    this.parent[rb] = ra;
    return true;
  }
}

// Procedurally pre-generates a complete square labyrinth complex centered at (0, 0):
// interconnected small/large rooms, winding hallways, 1 perimeter exit, wall-hugging
// room-restricted zombie spawns, ground sound hazards (pebbles/branches/puddles), and stashes.
export function createLabyrinth(seed, sizeMeters = 64, ammoScale = 1.0) {
  const rng = makeRng(`${seed}:labyrinth:${sizeMeters}`);
  const cols = Math.max(16, Math.round(sizeMeters / LABYRINTH_CELL));
  const rows = cols;
  const width = cols * LABYRINTH_CELL;
  const depth = rows * LABYRINTH_CELL;
  const minX = -width / 2;
  const minZ = -depth / 2;

  const owner = Array.from({ length: rows }, () => Array(cols).fill(-1));
  const zones = [];

  const cellCenter = (c, r) => ({
    c,
    r,
    x: minX + (c + 0.5) * LABYRINTH_CELL,
    z: minZ + (r + 0.5) * LABYRINTH_CELL,
  });

  const worldToCell = (wx, wz) => [
    Math.max(0, Math.min(cols - 1, Math.floor((wx - minX) / LABYRINTH_CELL))),
    Math.max(0, Math.min(rows - 1, Math.floor((wz - minZ) / LABYRINTH_CELL))),
  ];

  const registerZone = (kind, cells) => {
    const id = zones.length;
    let cMin = cols, cMax = -1, rMin = rows, rMax = -1;
    for (const [c, r] of cells) {
      owner[r][c] = id;
      if (c < cMin) cMin = c;
      if (c > cMax) cMax = c;
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
    }
    const zone = {
      id,
      kind,
      cells,
      cellSet: new Set(cells.map(([c, r]) => r * cols + c)),
      bounds: {
        c0: cMin, c1: cMax, r0: rMin, r1: rMax,
        minX: minX + cMin * LABYRINTH_CELL,
        maxX: minX + (cMax + 1) * LABYRINTH_CELL,
        minZ: minZ + rMin * LABYRINTH_CELL,
        maxZ: minZ + (rMax + 1) * LABYRINTH_CELL,
      },
      center: {
        x: minX + ((cMin + cMax + 1) / 2) * LABYRINTH_CELL,
        z: minZ + ((rMin + rMax + 1) / 2) * LABYRINTH_CELL,
      },
      neighbors: new Set(),
      doors: [],
      wallCells: [],
      distFromStart: Infinity,
    };
    zones.push(zone);
    return zone;
  };

  // 1) Central Starting Room (3x3 cells right at world origin)
  const midC = Math.floor(cols / 2) - 1;
  const midR = Math.floor(rows / 2) - 1;
  const startCells = [];
  for (let r = midR; r <= midR + 2; r++) {
    for (let c = midC; c <= midC + 2; c++) startCells.push([c, r]);
  }
  const startZone = registerZone('start', startCells);

  // 2) Scatter a mix of tight spaces (2x2..3x2), medium rooms (3x3..4x3), and big grand chambers (5x4..7x5)
  const targetRoomAttempts = Math.round((cols * rows) / 6.5);
  for (let attempt = 0; attempt < targetRoomAttempts; attempt++) {
    const sizeRoll = rng();
    const rw = sizeRoll < 0.28 ? 5 + Math.floor(rng() * 3)
      : sizeRoll < 0.60 ? 3 + Math.floor(rng() * 2)
      : 2 + Math.floor(rng() * 2);
    const rh = sizeRoll < 0.28 ? 4 + Math.floor(rng() * 2)
      : sizeRoll < 0.60 ? 3 + Math.floor(rng() * 2)
      : 2;
    const c0 = Math.floor(rng() * (cols - rw + 1));
    const r0 = Math.floor(rng() * (rows - rh + 1));
    const pad = rng() < 0.62 ? 1 : 0; // mostly leave hallway strips between rooms

    let overlaps = false;
    for (let r = Math.max(0, r0 - pad); r <= Math.min(rows - 1, r0 + rh - 1 + pad) && !overlaps; r++) {
      for (let c = Math.max(0, c0 - pad); c <= Math.min(cols - 1, c0 + rw - 1 + pad); c++) {
        if (owner[r][c] !== -1) { overlaps = true; break; }
      }
    }
    if (overlaps) continue;

    const cells = [];
    for (let r = r0; r < r0 + rh; r++) {
      for (let c = c0; c < c0 + rw; c++) cells.push([c, r]);
    }
    registerZone('room', cells);
  }

  // 3) Carve remaining unassigned cells into tight (1-cell = 3 m) and occasional wide (2-cell = 6 m) hallway segments
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (owner[r][c] !== -1) continue;
      const hallCells = [];
      const stack = [[c, r]];
      const wideHall = rng() < 0.26;
      const maxLen = wideHall ? 6 + Math.floor(rng() * 7) : 3 + Math.floor(rng() * 6);
      const localVisited = new Set([r * cols + c]);

      while (stack.length && hallCells.length < maxLen) {
        const [cc, cr] = stack.pop();
        if (owner[cr][cc] !== -1) continue;
        hallCells.push([cc, cr]);
        if (wideHall && hallCells.length < maxLen) {
          for (const [wc, wr] of [[cc + 1, cr], [cc, cr + 1]]) {
            if (wc >= 0 && wc < cols && wr >= 0 && wr < rows && owner[wr][wc] === -1) {
              const wk = wr * cols + wc;
              if (!localVisited.has(wk)) {
                localVisited.add(wk);
                hallCells.push([wc, wr]);
                break;
              }
            }
          }
        }
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let i = dirs.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
        }
        for (const [dc, dr] of dirs) {
          const nc = cc + dc, nr = cr + dr;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          const k = nr * cols + nc;
          if (owner[nr][nc] === -1 && !localVisited.has(k)) {
            localVisited.add(k);
            stack.push([nc, nr]);
          }
        }
      }
      registerZone('hallway', hallCells);
    }
  }

  // 4) Build edge grids: '.' open inside same zone, '#' solid wall, 'D' doorway between zones, 'E' perimeter exit
  const hEdges = Array.from({ length: rows + 1 }, () => Array(cols).fill('#'));
  const vEdges = Array.from({ length: rows }, () => Array(cols + 1).fill('#'));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r + 1 < rows && owner[r][c] === owner[r + 1][c]) hEdges[r + 1][c] = '.';
      if (c + 1 < cols && owner[r][c] === owner[r][c + 1]) vEdges[r][c + 1] = '.';
    }
  }

  // Collect all candidate boundary edges separating distinct zones
  const boundaries = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = owner[r][c];
      if (c + 1 < cols && owner[r][c + 1] !== a) {
        boundaries.push({ axis: 'v', c: c + 1, r, cA: c, rA: r, cB: c + 1, rB: r, zA: a, zB: owner[r][c + 1] });
      }
      if (r + 1 < rows && owner[r + 1][c] !== a) {
        boundaries.push({ axis: 'h', c, r: r + 1, cA: c, rA: r, cB: c, rB: r + 1, zA: a, zB: owner[r + 1][c] });
      }
    }
  }
  for (let i = boundaries.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [boundaries[i], boundaries[j]] = [boundaries[j], boundaries[i]];
  }

  const openDoor = edge => {
    if (edge.axis === 'v') vEdges[edge.r][edge.c] = 'D';
    else hEdges[edge.r][edge.c] = 'D';
    const za = zones[edge.zA], zb = zones[edge.zB];
    za.neighbors.add(zb.id);
    zb.neighbors.add(za.id);
    const doorPos = edge.axis === 'v'
      ? { x: minX + edge.c * LABYRINTH_CELL, z: minZ + (edge.r + 0.5) * LABYRINTH_CELL, axis: 'v' }
      : { x: minX + (edge.c + 0.5) * LABYRINTH_CELL, z: minZ + edge.r * LABYRINTH_CELL, axis: 'h' };
    za.doors.push(doorPos);
    zb.doors.push(doorPos);
  };

  // Spanning tree guarantees 100% full maze connectivity
  const uf = new UnionFind(zones.length);
  const leftover = [];
  for (const b of boundaries) {
    if (uf.union(b.zA, b.zB)) openDoor(b);
    else leftover.push(b);
  }

  // Add controlled secondary doorways (~11%) for branching routes without losing maze feel
  const connectedPairs = new Set();
  for (const z of zones) for (const n of z.neighbors) connectedPairs.add(`${Math.min(z.id, n)}:${Math.max(z.id, n)}`);
  for (const b of leftover) {
    const pairKey = `${Math.min(b.zA, b.zB)}:${Math.max(b.zA, b.zB)}`;
    if (connectedPairs.has(pairKey)) continue;
    const touchStart = b.zA === startZone.id || b.zB === startZone.id;
    if (rng() < (touchStart ? 0.35 : 0.11)) {
      connectedPairs.add(pairKey);
      openDoor(b);
    }
  }

  // 5) BFS from startZone to rank zone depths & place the single perimeter Exit Chamber
  const bfsQueue = [startZone.id];
  startZone.distFromStart = 0;
  for (let head = 0; head < bfsQueue.length; head++) {
    const cur = zones[bfsQueue[head]];
    for (const nextId of cur.neighbors) {
      if (zones[nextId].distFromStart > cur.distFromStart + 1) {
        zones[nextId].distFromStart = cur.distFromStart + 1;
        bfsQueue.push(nextId);
      }
    }
  }

  const perimeterEdges = [];
  for (let c = 0; c < cols; c++) {
    perimeterEdges.push({ axis: 'h', r: 0, c, cell: [c, 0], nx: 0, nz: -1, x: minX + (c + 0.5) * LABYRINTH_CELL, z: minZ });
    perimeterEdges.push({ axis: 'h', r: rows, c, cell: [c, rows - 1], nx: 0, nz: 1, x: minX + (c + 0.5) * LABYRINTH_CELL, z: minZ + depth });
  }
  for (let r = 0; r < rows; r++) {
    perimeterEdges.push({ axis: 'v', c: 0, r, cell: [0, r], nx: -1, nz: 0, x: minX, z: minZ + (r + 0.5) * LABYRINTH_CELL });
    perimeterEdges.push({ axis: 'v', c: cols, r, cell: [cols - 1, r], nx: 1, nz: 0, x: minX + width, z: minZ + (r + 0.5) * LABYRINTH_CELL });
  }

  let bestExitEdge = perimeterEdges[0];
  let bestExitScore = -1;
  for (const pe of perimeterEdges) {
    const z = zones[owner[pe.cell[1]][pe.cell[0]]];
    const score = z.distFromStart + (z.kind === 'room' ? 2 : 0) + Math.hypot(pe.x, pe.z) * 0.05;
    if (score > bestExitScore) {
      bestExitScore = score;
      bestExitEdge = pe;
    }
  }
  const exitZone = zones[owner[bestExitEdge.cell[1]][bestExitEdge.cell[0]]];
  exitZone.kind = 'exit';
  if (bestExitEdge.axis === 'h') hEdges[bestExitEdge.r][bestExitEdge.c] = 'E';
  else vEdges[bestExitEdge.r][bestExitEdge.c] = 'E';

  const exitSpot = {
    x: minX + (bestExitEdge.cell[0] + 0.5) * LABYRINTH_CELL,
    z: minZ + (bestExitEdge.cell[1] + 0.5) * LABYRINTH_CELL,
    doorX: bestExitEdge.x,
    doorZ: bestExitEdge.z,
    nx: bestExitEdge.nx,
    nz: bestExitEdge.nz,
    zoneId: exitZone.id,
  };

  // Identify concealed wall-adjacent cells per zone (sorted farthest from doorways so zombies don't expose themselves early)
  for (const z of zones) {
    const scored = [];
    for (const [c, r] of z.cells) {
      const pt = cellCenter(c, r);
      const touchesWall =
        hEdges[r][c] === '#' || hEdges[r + 1][c] === '#' ||
        vEdges[r][c] === '#' || vEdges[r][c + 1] === '#';
      const minDoorDist = z.doors.length
        ? Math.min(...z.doors.map(d => Math.hypot(pt.x - d.x, pt.z - d.z)))
        : 10;
      if (touchesWall && minDoorDist >= 2.7) scored.push({ ...pt, score: minDoorDist });
    }
    scored.sort((a, b) => b.score - a.score);
    z.wallCells = scored.length ? scored : z.cells.map(([c, r]) => cellCenter(c, r));
  }

  // 6) Compile wall colliders & doorway lintels/jambs for spatial queries
  const wallBoxes = [];
  const ceilings = [];
  const thickness = 0.24;
  const jambOffset = LABYRINTH_CELL / 2 - LABYRINTH_JAMB / 2;

  const pushBox = (cx, cz, bw, bh, bd, baseY, kind, tint) => {
    wallBoxes.push({ x: cx, z: cz, y: baseY, rx: bw / 2, ry: bh / 2, rz: bd / 2, height: bh, kind, tint });
  };

  for (let r = 0; r <= rows; r++) {
    const outer = r === 0 || r === rows;
    const tint = outer ? 0x26292e : 0x35373b;
    let c = 0;
    while (c < cols) {
      const ch = hEdges[r][c];
      if (ch === '#') {
        let end = c + 1;
        while (end < cols && hEdges[r][end] === '#') end++;
        const cx = minX + ((c + end) / 2) * LABYRINTH_CELL;
        pushBox(cx, minZ + r * LABYRINTH_CELL, (end - c) * LABYRINTH_CELL + thickness * 0.4, LABYRINTH_HEIGHT, thickness, 0, 'labWall', tint);
        c = end;
        continue;
      }
      if (ch === 'D' || ch === 'E') {
        const cx = minX + (c + 0.5) * LABYRINTH_CELL;
        const cz = minZ + r * LABYRINTH_CELL;
        // Distinct 2.0m doorway frame (side jambs + top lintel)
        pushBox(cx - jambOffset, cz, LABYRINTH_JAMB, LABYRINTH_HEIGHT, thickness, 0, 'labWall', tint);
        pushBox(cx + jambOffset, cz, LABYRINTH_JAMB, LABYRINTH_HEIGHT, thickness, 0, 'labWall', tint);
        pushBox(cx, cz, LABYRINTH_CELL, LABYRINTH_HEIGHT - LABYRINTH_DOOR_HEIGHT, thickness, LABYRINTH_DOOR_HEIGHT, 'labLintel', tint);
      }
      c++;
    }
  }

  for (let c = 0; c <= cols; c++) {
    const outer = c === 0 || c === cols;
    const tint = outer ? 0x26292e : 0x35373b;
    let r = 0;
    while (r < rows) {
      const ch = vEdges[r][c];
      if (ch === '#') {
        let end = r + 1;
        while (end < rows && vEdges[end][c] === '#') end++;
        const cz = minZ + ((r + end) / 2) * LABYRINTH_CELL;
        pushBox(minX + c * LABYRINTH_CELL, cz, thickness, LABYRINTH_HEIGHT, (end - r) * LABYRINTH_CELL + thickness * 0.4, 0, 'labWall', tint);
        r = end;
        continue;
      }
      if (ch === 'D' || ch === 'E') {
        const cx = minX + c * LABYRINTH_CELL;
        const cz = minZ + (r + 0.5) * LABYRINTH_CELL;
        pushBox(cx, cz - jambOffset, thickness, LABYRINTH_HEIGHT, LABYRINTH_JAMB, 0, 'labWall', tint);
        pushBox(cx, cz + jambOffset, thickness, LABYRINTH_HEIGHT, LABYRINTH_JAMB, 0, 'labWall', tint);
        pushBox(cx, cz, thickness, LABYRINTH_HEIGHT - LABYRINTH_DOOR_HEIGHT, LABYRINTH_CELL, LABYRINTH_DOOR_HEIGHT, 'labLintel', tint);
      }
      r++;
    }
  }

  // Enclosing ceiling tiles (12x12m bays across the square complex)
  const bay = 12;
  for (let z = minZ; z < minZ + depth - 0.1; z += bay) {
    for (let x = minX; x < minX + width - 0.1; x += bay) {
      const bw = Math.min(bay, minX + width - x);
      const bd = Math.min(bay, minZ + depth - z);
      ceilings.push({ x: x + bw / 2, z: z + bd / 2, rx: bw / 2 + 0.1, bd, bw });
    }
  }

  // 7) Pre-place room-locked Zombies, Floor Sound Hazards (pebbles/branches/puddles), and Ammo/Weapons
  const zombieSpawns = [];
  const hazards = [];
  const lootSites = [];
  const HAZARD_KINDS = ['pebbles', 'branches', 'puddles'];

  for (const z of zones) {
    // Zombies: 1..5 in every room (except safe center startZone), 1..2 patrolling longer hallways
    if (z.kind === 'room' || (z.kind === 'exit' && rng() < 0.7)) {
      const count = z.cells.length >= 12 ? 3 + Math.floor(rng() * 3)
        : z.cells.length >= 6 ? 2 + Math.floor(rng() * 2)
        : 1 + Math.floor(rng() * 2);
      const pool = [...z.wallCells];
      for (let i = 0; i < Math.min(5, count) && pool.length; i++) {
        const idx = Math.floor(rng() * pool.length);
        const pt = pool.splice(idx, 1)[0];
        const kindRoll = rng();
        const kind = kindRoll < 0.55 ? 'shambler' : kindRoll < 0.86 ? 'shrieker' : 'brute';
        zombieSpawns.push({ x: pt.x, z: pt.z, zoneId: z.id, kind, yaw: rng() * Math.PI * 2 });
      }
    } else if (z.kind === 'hallway' && z.cells.length >= 4 && rng() < 0.68) {
      const midPt = z.wallCells[Math.floor(rng() * z.wallCells.length)];
      zombieSpawns.push({ x: midPt.x, z: midPt.z, zoneId: z.id, kind: rng() < 0.7 ? 'shambler' : 'shrieker', yaw: rng() * Math.PI * 2 });
    }

    // Ground sound hazards: pebbles, dry branches, small puddles offset slightly so careful players can skirt around when lit
    const hazardChance = z.kind === 'start' ? 0 : z.kind === 'room' ? 0.82 : 0.45;
    if (rng() < hazardChance) {
      const maxH = z.kind === 'room' ? Math.min(3, Math.ceil(z.cells.length / 5)) : 1;
      for (let h = 0; h < maxH; h++) {
        const cell = z.cells[Math.floor(rng() * z.cells.length)];
        const pt = cellCenter(cell[0], cell[1]);
        const ox = (rng() - 0.5) * 1.1;
        const oz = (rng() - 0.5) * 1.1;
        const hKind = HAZARD_KINDS[Math.floor(rng() * HAZARD_KINDS.length)];
        const r = hKind === 'puddles' ? 0.65 + rng() * 0.30 : 0.54 + rng() * 0.26;
        if (!hazards.some(existing => Math.hypot(existing.x - (pt.x + ox), existing.z - (pt.z + oz)) < 2.3)) {
          hazards.push({ id: `haz:${hazards.length}`, kind: hKind, x: pt.x + ox, z: pt.z + oz, r, zoneId: z.id, turn: rng() * Math.PI * 2 });
        }
      }
    }

    // Scavenged Ammo, Separate Flares & Gun Upgrades + occasional Shotgun / Carbine pickups
    if (z.kind === 'start') {
      lootSites.push({ id: 'loot:start-ammo', kind: 'ammo', x: z.center.x + 1.6, z: z.center.z - 1.6, amount: Math.max(8, Math.round(14 * ammoScale)), name: 'Reserve Ammo' });
      lootSites.push({ id: 'loot:start-flares', kind: 'flareAmmo', x: z.center.x - 1.5, z: z.center.z - 1.5, amount: 3, name: 'Spare flares' });
    } else if (z.kind === 'room') {
      if (rng() < Math.min(0.85, 0.65 * ammoScale)) {
        const cell = z.cells[Math.floor(rng() * z.cells.length)];
        const pt = cellCenter(cell[0], cell[1]);
        lootSites.push({
          id: `loot:ammo:${z.id}`,
          kind: 'ammo',
          x: pt.x,
          z: pt.z,
          amount: Math.max(6, Math.round((8 + rng() * 8) * ammoScale)),
          name: 'Ammo Box',
        });
      }
      if (rng() < 0.36) {
        const cell = z.cells[Math.floor(rng() * z.cells.length)];
        const pt = cellCenter(cell[0], cell[1]);
        lootSites.push({
          id: `loot:flares:${z.id}`,
          kind: 'flareAmmo',
          x: pt.x + 0.45,
          z: pt.z - 0.35,
          amount: 2 + Math.floor(rng() * 3),
          name: 'Spare flares',
        });
      }
    }
  }

  // Place 1 Pump Shotgun, 1 Ranger Carbine, and firearm upgrade pickups in distant non-start, non-exit rooms
  const weaponRooms = zones
    .filter(z => z.kind === 'room' && z.distFromStart >= 3)
    .sort((a, b) => b.distFromStart - a.distFromStart);
  if (weaponRooms[0]) {
    lootSites.push({ id: 'loot:shotgun', kind: 'shotgun', x: weaponRooms[0].center.x, z: weaponRooms[0].center.z, amount: 0, name: 'Pump shotgun' });
  }
  if (weaponRooms[Math.min(2, weaponRooms.length - 1)] && weaponRooms.length > 1) {
    const r2 = weaponRooms[Math.min(2, weaponRooms.length - 1)];
    lootSites.push({ id: 'loot:carbine', kind: 'carbine', x: r2.center.x, z: r2.center.z, amount: 0, name: 'Ranger carbine' });
  }
  const upgradeKinds = ['light', 'damage', 'capacity', 'reload', 'pierce'];
  const upgradeSlots = Math.min(weaponRooms.length, Math.max(5, Math.round(cols / 5)));
  for (let u = 0; u < upgradeSlots; u++) {
    const room = weaponRooms[Math.floor(((u + 1) * weaponRooms.length) / (upgradeSlots + 1))];
    if (!room) continue;
    const kind = upgradeKinds[u % upgradeKinds.length];
    const cell = room.cells[Math.floor(rng() * room.cells.length)];
    const pt = cellCenter(cell[0], cell[1]);
    lootSites.push({ id: `loot:up:${u}:${kind}`, kind, x: pt.x, z: pt.z, amount: 0, name: kind });
  }

  const zoneAt = (wx, wz) => {
    if (wx < minX || wx >= minX + width || wz < minZ || wz >= minZ + depth) return null;
    const [c, r] = worldToCell(wx, wz);
    return zones[owner[r][c]] || null;
  };

  return {
    sizeMeters,
    cols,
    rows,
    width,
    depth,
    minX,
    maxX: minX + width,
    minZ,
    maxZ: minZ + depth,
    start: { x: startZone.center.x, z: startZone.center.z },
    exit: exitSpot,
    zones,
    startZone,
    exitZone,
    wallBoxes,
    ceilings,
    zombieSpawns,
    hazards,
    lootSites,
    owner,
    hEdges,
    vEdges,
    worldToCell,
    cellCenter,
    zoneAt,
  };
}
