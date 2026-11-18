import { ARENA_SIZES, arenaSizeKey, DIFFICULTIES, difficultyKey, modeKey } from './difficulty.js';
import {
  animatedAnchors, attackContact, attackDirection, burstPhase, BURST_BRAKE, BURST_LOAD, BURST_RUN,
  enemyMotion, HIT_SEGMENTS, hitRadii, strideLength, updateEnemyFooting,
} from './enemy-motion.js';
import { MAX_ACTIVE_ZOMBIES, populateWorldRoster, syncActiveRoster } from './horde.js';
import { ARENA_SHIFT_INTERVAL } from './arena.js';
import { findMazeStep, MAX_PURSUIT_PLAYER_DIST, MAX_TETHER_FROM_HOME, updateHordeTactics } from './tactics.js';
import { angleDelta, clamp, createWorld, direction, distance, random, START } from './world.js';

export const STEP = 1 / 30;
export const BUILD = '2.4.2';

export const GUNS = {
  pistol: { name: 'Service pistol', capacities: [12, 16, 20, 24], reload: 1.45, interval: 0.28, range: 48, damage: 1, noise: 22, rounds: 1, spread: 0 },
  shotgun: { name: 'Pump shotgun', capacities: [5, 6, 7, 8], reload: 2.1, interval: 0.78, range: 28, damage: 1, noise: 28, rounds: 7, spread: 0.072 },
  smg: { name: 'Compact SMG', capacities: [24, 28, 32, 36], reload: 1.75, interval: 0.10, range: 42, damage: 1, noise: 24, rounds: 1, spread: 0.02 },
  carbine: { name: 'Ranger carbine', capacities: [16, 20, 24, 28], reload: 1.9, interval: 0.22, range: 56, damage: 1, noise: 26, rounds: 1, spread: 0 },
};

// Regular zombies die in 1 headshot or 2-3 body shots (shrieker: 2 body, shambler: 3 body).
// Brutes require 3 headshots (2 dmg each) or 6 body shots (1 dmg each).
// Speeds cap up to 3.9 mph (1.74 m/s max, +30% faster).
export const ENEMIES = {
  shambler: { speed: 0.57, chaseSpeed: 1.38, height: 1.77, width: 0.28, hp: 3, windup: 0.60, reach: 1.19 },
  shrieker: { speed: 0.73, chaseSpeed: 1.74, height: 1.66, width: 0.23, hp: 2, windup: 0.44, reach: 1.16 },
  brute: { speed: 0.49, chaseSpeed: 1.20, height: 2.0, width: 0.36, hp: 6, windup: 0.82, reach: 1.35 },
};

// One standard infinite bright narrow-cone flashlight across both modes; firearm upgrades apply to guns.
export const UPGRADES = {
  damage: { name: 'Hot loads', icon: '▲', cap: 3, color: '#ff8b70', description: '+damage & impact stagger' },
  pierce: { name: 'Piercing rounds', icon: '»', cap: 2, color: '#ffb36c', description: '+1 target per shot' },
  reload: { name: 'Speed loader', icon: '↻', cap: 3, color: '#f1cd86', description: '15% faster reload' },
  capacity: { name: 'Extended Capacity', icon: '▤', cap: 3, color: '#e2d18d', description: 'Larger firearm magazine' },
};

export const LOOT = {
  ...UPGRADES,
  ammo: { name: 'Spare rounds', icon: '⋮', color: '#bac5b8' },
  pistol: { name: 'Service pistol', icon: 'pistol', color: '#f0cc91' },
  shotgun: { name: 'Pump shotgun', icon: 'shotgun', color: '#ffd299' },
  smg: { name: 'Compact SMG', icon: 'smg', color: '#ebbc91' },
  carbine: { name: 'Ranger carbine', icon: 'carbine', color: '#e5ce98' },
  armor1: { name: 'Padded vest', icon: 'Ⅰ', color: '#9cb9ce' },
};

const POINT = { x: 0, y: 0, z: -1 };
const RESERVE_MAX = 180;
const ARENA_RESERVE_MAX = 300;
const MUZZLE_LIGHT_DURATION = 0.22;
const MUZZLE_LIGHT_RANGE = 20;
const DRY_SPARK_RANGE = 3.5;
const beamCycle = { wide: 'focus', focus: 'off', off: 'wide' };

const eye = (world, next, tall = 1.4) => ({ x: next.x, y: world.height(next.x, next.z) + tall, z: next.z });

export function magazineCapacity(player) {
  return GUNS[player.weapon].capacities[player.upgrades.capacity];
}

export function isSupply(kind) {
  return kind === 'ammo';
}

export function beamSettings(mode = 'focus') {
  const focus = mode === 'focus';
  return { range: focus ? 36 : 20, angle: focus ? 0.21 : 0.48, powerScale: focus ? 1.35 : 1.15 };
}

export function activeBeams(run) {
  return run.player.flashlight ? [run.beam].filter(Boolean) : [];
}

export function resolvedBeam(world, lamp, head) {
  if (!lamp || !head) return lamp;
  const delta = { x: lamp.origin.x - head.x, y: lamp.origin.y - head.y, z: lamp.origin.z - head.z };
  const range = Math.hypot(delta.x, delta.y, delta.z);
  if (range <= 0.01) return lamp;
  const ray = norm(delta), hit = world.raycast(head, ray, range, false);
  if (!hit) return lamp;
  return hit.t > 0.12 ? { ...lamp, origin: rayPoint(head, ray, hit.t - 0.12) } : null;
}

export function resolvePlayerBeam(run, lamp, head) {
  const p = run.player, mode = p.beam;
  if (!mode || mode === 'off') return null;
  const cast = resolvedBeam(run.world, lamp, head);
  return cast ? { ...cast, ...beamSettings(mode, run), mode } : null;
}

export function inBeam(world, beam, at) {
  if (!beam) return false;
  const dx = at.x - beam.origin.x, dy = at.y - beam.origin.y, dz = at.z - beam.origin.z;
  const d = Math.hypot(dx, dy, dz);
  return d < beam.range && dx * beam.ray.x + dy * beam.ray.y + dz * beam.ray.z >= Math.cos(beam.angle) * d
    && world.clear(beam.origin, at);
}

function norm(v) {
  const length = Math.hypot(v.x, v.y, v.z);
  return length > 0 ? { x: v.x / length, y: v.y / length, z: v.z / length } : POINT;
}

export function enemyPose(enemy) {
  const [chin, brow, chest, hips] = animatedAnchors(enemy, ENEMIES[enemy.kind].windup, 4);
  const center = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
  return { head: center(chin, brow), torso: center(chest, hips) };
}

function raySphere(origin, ray, center, radius) {
  const x = center.x - origin.x, y = center.y - origin.y, z = center.z - origin.z;
  const projection = x * ray.x + y * ray.y + z * ray.z;
  const c = x * x + y * y + z * z - radius * radius;
  if (c <= 0) return 0;
  const h = projection * projection - c;
  return h >= 0 && projection >= 0 ? Math.max(0, projection - Math.sqrt(h)) : Infinity;
}

function rayCapsule(origin, ray, first, last, radius) {
  const dx = last.x - first.x, dy = last.y - first.y, dz = last.z - first.z;
  const x = origin.x - first.x, y = origin.y - first.y, z = origin.z - first.z;
  const length2 = dx * dx + dy * dy + dz * dz;
  const projection = dx * ray.x + dy * ray.y + dz * ray.z;
  const from = dx * x + dy * y + dz * z;
  const originRay = x * ray.x + y * ray.y + z * ray.z;
  const a = length2 - projection * projection;
  const b = length2 * originRay - from * projection;
  const c = length2 * (x * x + y * y + z * z - radius * radius) - from * from;
  if (c <= 0 && from >= 0 && from <= length2) return 0;
  const d = b * b - a * c;
  if (a > 1e-8 && d >= 0) {
    const t = (-b - Math.sqrt(d)) / a, across = from + t * projection;
    if (t >= 0 && across >= 0 && across <= length2) return t;
  }
  return Math.min(raySphere(origin, ray, first, radius), raySphere(origin, ray, last, radius));
}

const rayPoint = (origin, ray, t) => ({
  x: origin.x + ray.x * t, y: origin.y + ray.y * t, z: origin.z + ray.z * t,
});

function muzzleCover(world, aim) {
  if (!aim.viewOrigin) return null;
  const head = aim.viewOrigin, o = aim.origin;
  const dx = o.x - head.x, dy = o.y - head.y, dz = o.z - head.z;
  const range = Math.hypot(dx, dy, dz);
  if (range <= 0.01) return null;
  const ray = { x: dx / range, y: dy / range, z: dz / range };
  const hit = world.raycast(head, ray, range);
  return hit && hit.t <= range ? { zone: 'cover', surface: hit.kind, point: rayPoint(head, ray, hit.t), ray } : null;
}

function prepareTargets(run, origin, ray, range, spread = 0) {
  const targets = [];
  const horizontal = Math.hypot(ray.x, ray.z);
  for (const e of run.enemies) {
    if (e.dead) continue;
    const x = e.x - origin.x, z = e.z - origin.z, gap = Math.hypot(x, z);
    if (gap > range + 1.2) continue;
    if (horizontal > 0.01 && (x * ray.x + z * ray.z < -horizontal || Math.abs(x * ray.z - z * ray.x) / horizontal > 0.98 + gap * spread * 1.8)) continue;
    targets.push({ e, points: animatedAnchors(e, ENEMIES[e.kind].windup), radii: hitRadii(e.kind) });
  }
  return targets;
}

function traceRay(world, origin, ray, range, targets) {
  const solid = world.raycast(origin, ray, range);
  const limit = solid?.t ?? range;
  const hits = [];
  for (const { e, points, radii } of targets) {
    let best = limit, zone = null;
    for (const [i, [a, b, tag]] of HIT_SEGMENTS.entries()) {
      const radius = tag === 'head' ? radii[i] * 1.18 : radii[i];
      const t = rayCapsule(origin, ray, points[a], points[b], radius);
      if (t < best) { best = t; zone = tag; }
    }
    if (zone) hits.push({ e, t: best, zone, head: zone === 'head', point: rayPoint(origin, ray, best) });
  }
  hits.sort((a, b) => a.t - b.t);
  return { hits, cover: solid && { zone: 'cover', surface: solid.kind, point: rayPoint(origin, ray, solid.t) } };
}

export function traceAim(run, aim) {
  if (!aim?.origin || !aim?.ray) return null;
  const blocked = muzzleCover(run.world, aim);
  if (blocked) return blocked;
  const { range } = GUNS[run.player.weapon], ray = norm(aim.ray);
  const { hits, cover } = traceRay(run.world, aim.origin, ray, range, prepareTargets(run, aim.origin, ray, range));
  if (!hits.length) return cover;
  const first = hits[0];
  return { ...first, zone: first.head ? 'head' : 'armor' };
}

function emit(run, type, data = {}) {
  run.events.push({ type, ...data });
}

function pickSpawnDoor(run, usedDoors = []) {
  const arena = run.world.arena, p = run.player, wave = run.wave;
  const fwd = direction(p.yaw);
  const scored = arena.faces.map(f => {
    const dx = f.cx - p.x, dz = f.cz - p.z;
    const d = Math.hypot(dx, dz) || 1;
    const lookDot = (dx * fwd.x + dz * fwd.z) / d;
    return { id: f.id, lookDot, inFront: lookDot > 0.32 };
  });

  const mostInFront = [...scored].sort((a, b) => b.lookDot - a.lookDot)[0];
  if (wave && mostInFront && mostInFront.id !== wave.lastFrontDoor) {
    wave.lastFrontDoor = mostInFront.id;
    wave.frontDoorSpawns = 0;
  }

  // After 2 front spawns while camping a doorway, force subsequent spawns behind/outside player's view
  const blockFront = Boolean(wave && wave.frontDoorSpawns >= 2);
  let pool = scored.filter(s => (!blockFront || !s.inFront) && s.lookDot <= 0.25);
  if (!pool.length) pool = scored.filter(s => !s.inFront);
  if (!pool.length) pool = scored;

  // Strongly prefer doors behind the player (lowest lookDot) and spread multi-zombie bursts cleanly
  pool.sort((a, b) => a.lookDot - b.lookDot);
  const behindSlice = pool.slice(0, Math.max(2, Math.ceil(pool.length * 0.7)));
  const fresh = behindSlice.filter(s => !usedDoors.includes(s.id));
  const choices = fresh.length ? fresh : behindSlice;
  const pick = choices[Math.floor(run.rng() * choices.length)];
  if (wave && pick.inFront) wave.frontDoorSpawns = (wave.frontDoorSpawns || 0) + 1;
  return pick.id;
}

function buildWaveQueue(run, waveNum) {
  const total = 5 + waveNum * 3;
  const queue = [];
  let remaining = total;
  while (remaining > 0) {
    // Bursts of 1..5 zombies entering through doorways
    const maxBurst = waveNum === 1 ? 3 : 5;
    const burst = Math.min(remaining, 1 + Math.floor(run.rng() * maxBurst));
    const entries = [];
    for (let i = 0; i < burst; i++) {
      const roll = run.rng();
      const bruteChance = waveNum >= 2 ? Math.min(0.28, 0.08 + waveNum * 0.03) : 0;
      const shriekerChance = Math.min(0.38, 0.18 + waveNum * 0.03);
      const kind = roll < bruteChance ? 'brute' : roll < bruteChance + shriekerChance ? 'shrieker' : 'shambler';
      entries.push({ kind });
    }
    queue.push(entries);
    remaining -= burst;
  }
  return { number: waveNum, total, spawned: 0, cleared: 0, queue, burstTimer: 0.4, intermission: 0, lastFrontDoor: -1, frontDoorSpawns: 0 };
}

function spawnWaveRewards(run, clearedWave) {
  const arena = run.world.arena;
  const p = run.player;
  const spots = arena.openFloorPoints(8);
  let idx = 0;
  const place = (kind, amount = 0) => {
    const pt = spots[idx % spots.length] || { x: 0, z: 0 };
    idx++;
    const angle = (idx * 2.1);
    const rx = spots.length ? pt.x : Math.cos(angle) * 2.5;
    const rz = spots.length ? pt.z : Math.sin(angle) * 2.5;
    setLoot(run, kind, rx, rz, `wave:${clearedWave}:${kind}:${idx}`, amount, LOOT[kind].name);
  };

  // Generous ammunition rewards
  place('ammo', 16 + clearedWave * 4);
  place('ammo', 14 + clearedWave * 4);
  place('ammo', 12 + clearedWave * 3);

  // Better guns across early waves
  if (clearedWave === 1 && !Object.hasOwn(p.magazines, 'shotgun')) place('shotgun');
  else if (clearedWave === 2 && !Object.hasOwn(p.magazines, 'smg')) place('smg');
  else if (clearedWave >= 3 && !Object.hasOwn(p.magazines, 'carbine')) place('carbine');
  else if (p.armor < 1) place('armor1');

  if (p.armor < 1 && clearedWave % 2 === 0) place('armor1');

  // Gun upgrades between every wave
  const weaponUpgradePool = ['damage', 'capacity', 'reload', 'pierce'].filter(u => (p.upgrades[u] || 0) < UPGRADES[u].cap);
  if (weaponUpgradePool.length) {
    const first = weaponUpgradePool[(clearedWave - 1 + Math.floor(run.rng() * weaponUpgradePool.length)) % weaponUpgradePool.length];
    place(first);
    const secondPool = weaponUpgradePool.filter(u => u !== first);
    if (secondPool.length) {
      place(secondPool[Math.floor(run.rng() * secondPool.length)]);
    }
  }
}

export function createRun(seed = 'last-night', { populate = true, difficulty = 'standard', mode = 'labyrinth', arenaSize = 'medium' } = {}) {
  const runMode = modeKey(mode);
  const key = runMode === 'arena' ? arenaSizeKey(arenaSize) : difficultyKey(difficulty);
  const rules = runMode === 'arena' ? ARENA_SIZES[key] : DIFFICULTIES[key];
  const world = runMode === 'arena'
    ? createWorld(seed, { mode: 'arena', diameter: rules.diameter, cellSize: rules.cellSize })
    : createWorld(seed, { mode: 'labyrinth', mazeSize: rules.mazeSize, ammoScale: rules.ammoScale });
  const upgrades = Object.fromEntries(Object.keys(UPGRADES).map(k => [k, 0]));
  const magazines = { pistol: GUNS.pistol.capacities[0] };

  const run = {
    seed,
    mode: runMode,
    difficulty: key,
    arenaSize: runMode === 'arena' ? key : null,
    rules,
    world,
    populate,
    rng: random(seed + ':run'),
    time: 0,
    status: 'playing',
    player: {
      x: world.start.x,
      z: world.start.z,
      y: world.height(world.start.x, world.start.z),
      yaw: 0,
      eyeHeight: 1.63,
      weapon: 'pistol',
      magazines,
      get ammo() { return this.magazines[this.weapon]; },
      set ammo(value) { this.magazines[this.weapon] = value; },
      reserve: runMode === 'arena' ? 60 : 42,
      get equippedReserve() { return this.reserve; },
      set equippedReserve(value) { this.reserve = value; },
      armor: 0,
      protection: 0,
      cooldown: 0,
      reload: null,
      flashlight: true,
      battery: 1,
      beam: 'focus',
      upgrades,
      kills: 0,
      headshots: 0,
      noisePeak: -1,
      stepTimer: 0,
      travelX: 0,
      travelZ: 0,
      lastWallBump: -9,
    },
    roster: [],
    enemies: [],
    corpses: [],
    loot: [],
    settledLoot: new Set(),
    noises: [],
    events: [],
    offer: null,
    beam: null,
    wave: runMode === 'arena' ? { number: 1, total: 0, spawned: 0, cleared: 0, queue: [], burstTimer: 0, intermission: 0 } : null,
    arenaShift: runMode === 'arena' ? { nextAt: ARENA_SHIFT_INTERVAL, version: 0, moving: false } : null,
    counts: { total: 0, zones: world.labyrinth ? world.labyrinth.zones.length : 6 },
    nextId: 1,
    nextAttack: 0,
    nextTacticsTick: 0,
    lastChunkCheckX: -1e9,
    lastChunkCheckZ: -1e9,
    metrics: { shots: 0, dryFire: 0, wallBreaks: 0, roundsPicked: 0, upgrades: 0, hazardsTriggered: 0, pickups: {}, damage: {} },
  };

  if (runMode === 'arena') {
    if (populate) run.wave = buildWaveQueue(run, 1);
  } else {
    syncLoot(run);
    if (populate) populateWorldRoster(run, addEnemy);
  }
  return run;
}

export function addEnemy(run, kind, x, z, meta = {}) {
  const enemy = {
    id: run.nextId++,
    kind,
    appearance: run.rng() < 0.5 ? kind : `${kind}-alt`,
    x,
    z,
    y: run.world.height(x, z),
    yaw: meta.yaw ?? run.rng() * Math.PI * 2,
    hp: ENEMIES[kind].hp,
    pace: 0.84 + run.rng() * 0.28,
    gait: run.rng() * Math.PI * 2,
    moveSpeed: 0,
    stride: 0,
    turnRate: 0,
    startAge: 0,
    hitAge: 1,
    hitFrom: 'Front',
    poseTime: run.time,
    previousTransform: { x, y: run.world.height(x, z), z, yaw: 0 },
    footing: null,
    plantLocks: null,
    turnSide: run.rng() < 0.5 ? 1 : -1,
    stuck: 0,
    roam: run.rng() * 6,
    stun: 0,
    slow: 0,
    windup: 0,
    recover: 0,
    stumble: 0,
    stumbleDuration: 0.7,
    nextStumble: 4 + run.rng() * 6,
    burstStart: 0,
    burst: 0,
    brakeUntil: 0,
    nextBurst: 2 + run.rng() * 3,
    nextThink: run.rng() * 0.22,
    nextVoice: 1 + run.rng() * 4,
    lastVoice: -9,
    voiceBand: 2,
    voiceVariation: run.rng(),
    dead: false,
    dormant: meta.dormant ?? false,
    alerted: false,
    zoneId: meta.zoneId ?? run.world.zoneAt(x, z)?.id ?? null,
    home: { x, z },
    patrolTarget: null,
    patrolUntil: 0,
    tactic: null,
    memory: null,
    target: null,
    reason: 'wallProwl',
    route: null,
    changedAt: 0,
  };
  enemy.previousTransform.yaw = enemy.yaw;
  if (!run.roster.includes(enemy)) run.roster.push(enemy);
  if (!run.enemies.includes(enemy) && (run.mode === 'arena' || distance(enemy, run.player) <= 24)) run.enemies.push(enemy);
  return enemy;
}

export function setLoot(run, kind, x, z, id = 'drop:' + run.nextId++, amount = 0, name = '') {
  if (run.settledLoot.has(id) || run.loot.some(item => item.id === id)) return null;
  const y = run.world.height(x, z);
  const loot = { id, kind, x, z, y, born: run.time, amount, name, landmark: !id.startsWith('drop:') };
  run.loot.push(loot);
  return loot;
}

function syncLoot(run) {
  const { player: p, world } = run;
  if (!world.arena) {
    const known = new Set(run.loot.map(item => item.id));
    for (const area of world.around(p.x, p.z, 54)) {
      for (const site of area.loot) {
        if (known.has(site.id) || run.settledLoot.has(site.id)) continue;
        setLoot(run, site.kind, site.x, site.z, site.id, site.amount || 0, site.name || '');
      }
    }
  }
  run.loot = run.loot.filter(item => !item.lost);
}

function noise(run, kind, origin, radius, span, zoneId = null) {
  run.noises.push({
    kind,
    origin: { ...origin },
    radius,
    born: run.time,
    span,
    zoneId: zoneId ?? run.world.zoneAt(origin.x, origin.z)?.id ?? null,
  });
  if (run.noises.length > 40) run.noises.shift();
}

function alertMuzzleZone(run, flashOrigin) {
  const { world, time } = run;
  const shooterZoneId = world.zoneAt(flashOrigin.x, flashOrigin.z)?.id ?? null;
  for (const e of run.enemies) {
    if (e.dead) continue;
    const flatDist = distance(e, flashOrigin);
    if (flatDist > MUZZLE_LIGHT_RANGE) continue;
    if (e.zoneId !== shooterZoneId && flatDist > 10) continue;
    if (!world.clear(flashOrigin, eye(world, e, ENEMIES[e.kind].height * 0.58))) continue;
    e.dormant = false;
    e.alerted = true;
    e.memory = {
      x: flashOrigin.x,
      z: flashOrigin.z,
      score: 1.8,
      reason: 'muzzle flash',
      id: 'flash',
      chase: true,
      until: time + run.rules.memorySeconds,
    };
  }
}

function eliminate(run, e, headshot) {
  const p = run.player;
  e.dead = true;
  e.hp = 0;
  p.kills++;
  if (headshot) p.headshots++;
  run.corpses.push({
    ...e,
    headshot,
    diedAt: run.time,
    fallAge: 0,
    fallFrom: enemyMotion(e, ENEMIES[e.kind].windup),
  });
  if (run.corpses.length > 20) run.corpses.shift();
  emit(run, 'kill', { ...enemyPose(e).torso, kind: e.kind, headshot });
  const dropChance = run.mode === 'arena' ? (e.kind === 'brute' ? 1 : 0.80) : 0.65;
  if (run.rng() < dropChance) {
    const amount = run.mode === 'arena' ? 6 + Math.floor(run.rng() * 7) : 6 + Math.floor(run.rng() * 5);
    setLoot(run, 'ammo', e.x, e.z, undefined, amount);
  }
}

export function shoot(run, aim) {
  const { player: p, world } = run, gun = GUNS[p.weapon];
  if (run.status !== 'playing' || p.cooldown > 0 || p.reload) return;
  const o = aim.origin, center = norm(aim.ray);
  const blocked = muzzleCover(world, aim);
  const flashOrigin = blocked ? rayPoint(blocked.point, blocked.ray, -0.045) : o;

  if (!p.ammo) {
    if (startReload(run)) return;
    run.metrics.dryFire++;
    p.cooldown = 0.34;
    emit(run, 'dry', {
      reason: 'Out of ammo — weak spark',
      x: flashOrigin.x, y: flashOrigin.y, z: flashOrigin.z,
      ray: center,
      range: DRY_SPARK_RANGE,
      duration: 0.12,
      spark: true,
    });
    return;
  }

  p.ammo--;
  p.cooldown = gun.interval;
  p.noisePeak = run.time + 0.45;
  run.metrics.shots++;
  noise(run, 'gunshot', flashOrigin, gun.noise, 2.4);
  emit(run, 'shot', {
    ...flashOrigin,
    ray: center,
    weapon: p.weapon,
    blocked: Boolean(blocked),
    range: MUZZLE_LIGHT_RANGE,
    duration: MUZZLE_LIGHT_DURATION,
  });
  if (!p.ammo) startReload(run);

  if (!blocked) {
    const possible = prepareTargets(run, o, center, gun.range, gun.spread);
    const hits = new Map();
    for (let shot = 0; shot < gun.rounds; shot++) {
      const spread = p.weapon === 'shotgun' && shot === 0 ? 0 : gun.spread;
      const ray = spread === 0 ? center : norm({
        x: center.x + (run.rng() - 0.5) * spread * 2,
        y: center.y + (run.rng() - 0.5) * spread * 2,
        z: center.z + (run.rng() - 0.5) * spread * 2,
      });
      const { hits: candidates, cover } = traceRay(world, o, ray, gun.range, possible);
      const penetrates = 1 + (p.weapon === 'shotgun' && shot !== 0 ? 0 : p.upgrades.pierce);
      for (let i = 0; i < Math.min(penetrates, candidates.length); i++) {
        const hit = candidates[i];
        const current = hits.get(hit.e) || { head: false, leg: false, point: hit.point };
        if (hit.head) current.head = true;
        if (hit.zone === 'leg') current.leg = true;
        hits.set(hit.e, current);
      }
      if (cover && shot === 0 && candidates.length < penetrates) {
        emit(run, 'impact', { ...cover.point, surface: cover.surface });
      }
    }

    for (const [enemy, hit] of hits) {
      enemy.dormant = false;
      enemy.alerted = true;
      enemy.memory = { x: p.x, z: p.z, score: 2.0, reason: 'attacked', id: 'attacked', chase: true, until: run.time + run.rules.memorySeconds };
      noise(run, 'shriek', enemy, 12, 1.8, enemy.zoneId);
      enemyVoice(run, enemy, 'shriek');

      // Regular zombies: headshot = instant kill, body = 2-3 hits.
      // Brutes (6 HP): 3 headshots (2 dmg each) or 6 body shots (1 dmg each). Hot loads L2+ deals +1 dmg.
      const bonus = Math.floor((p.upgrades.damage || 0) / 2);
      const dmg = hit.head ? (enemy.kind === 'brute' ? 2 + bonus : enemy.hp) : 1 + bonus;
      enemy.hp -= dmg;
      emit(run, 'impact', { ...hit.point, surface: 'body' });

      if (enemy.hp <= 0) {
        eliminate(run, enemy, hit.head);
      } else {
        enemy.stun = 0.08 + p.upgrades.damage * 0.04;
        enemy.hitFrom = attackDirection(enemy, center);
        enemy.hitAge = 0;
        if (hit.leg) enemy.slow = 0.6;
      }
    }
  } else {
    emit(run, 'impact', { ...blocked.point, surface: blocked.surface });
  }

  alertMuzzleZone(run, flashOrigin);
}

export function startReload(run) {
  const p = run.player, gun = GUNS[p.weapon];
  if (p.reload || !p.reserve || p.ammo >= magazineCapacity(p) || run.status !== 'playing') return false;
  const duration = gun.reload * 0.85 ** p.upgrades.reload;
  p.reload = { duration, left: duration, weapon: p.weapon };
  emit(run, 'reload', { weapon: p.weapon });
  return true;
}

function takeLoot(run, confirm) {
  const p = run.player;
  const nearby = run.loot.filter(l => !l.lost && Math.abs(l.x - p.x) < 1.6 && distance(l, p) < 1.32)
    .sort((a, b) => distance(a, p) - distance(b, p));
  run.offer = null;

  for (const l of nearby) {
    const k = l.kind;
    if (Object.hasOwn(p.magazines, k) || (k.startsWith('armor') && Number(k.at(-1)) <= p.armor)) continue;
    if (!run.world.clear(eye(run.world, p, 0.6), { ...l, y: l.y + 0.44 })) continue;

    if (k in GUNS || k.startsWith('armor')) {
      run.offer ??= l;
      continue;
    }

    if (k === 'ammo') {
      const cap = run.mode === 'arena' ? ARENA_RESERVE_MAX : RESERVE_MAX;
      const got = Math.max(0, Math.min(cap - p.reserve, l.amount || 6));
      if (!got) continue;
      p.reserve += got;
      run.metrics.roundsPicked += got;
      take(run, l, '+' + got + ' rounds');
    } else if (k in UPGRADES && p.upgrades[k] < UPGRADES[k].cap) {
      p.upgrades[k]++;
      run.metrics.upgrades++;
      const effect = k === 'capacity'
        ? magazineCapacity(p) + (p.weapon === 'shotgun' ? ' shells' : ' rounds')
        : UPGRADES[k].description;
      take(run, l, UPGRADES[k].name + ' · ' + effect);
    }
  }

  const item = run.offer;
  if (!confirm || !item) return;
  if (item.kind in GUNS) {
    const cap = GUNS[item.kind].capacities[p.upgrades.capacity];
    if (run.mode === 'arena') {
      p.magazines[item.kind] = cap;
    } else {
      p.magazines[item.kind] = Math.min(cap, Math.max(4, p.reserve));
      p.reserve = Math.max(0, p.reserve - p.magazines[item.kind]);
    }
    equipWeapon(p, item.kind);
  } else {
    p.armor = Number(item.kind.at(-1));
  }
  take(run, item, LOOT[item.kind].name);
  run.offer = null;
}

function equipWeapon(player, weapon) {
  player.weapon = weapon;
  player.reload = null;
  player.cooldown = Math.max(player.cooldown, 0.25);
}

function cycleWeapon(run) {
  const p = run.player, weapons = Object.keys(p.magazines);
  if (weapons.length < 2) return;
  const next = weapons[(weapons.indexOf(p.weapon) + 1) % weapons.length];
  equipWeapon(p, next);
  emit(run, 'weaponSwitch', { weapon: next });
}

function take(run, loot, message) {
  loot.lost = true;
  if (loot.landmark) run.settledLoot.add(loot.id);
  run.metrics.pickups[loot.kind] = (run.metrics.pickups[loot.kind] || 0) + 1;
  emit(run, 'pickup', { kind: loot.kind, message });
}

function perception(run, e, gap, lamps) {
  const { world, player: p, time, rules } = run;
  const origin = eye(world, e, ENEMIES[e.kind].height * 0.87);
  const playerEye = eye(world, p, p.eyeHeight * 0.8);
  const get = (x, z, score, reason, id, chase) => ({ x, z, score, reason, id, chase });
  let best = null;
  const offer = candidate => { if (!best || candidate.score > best.score) best = candidate; };

  if (world.arena) {
    e.dormant = false;
    e.alerted = true;
    e.returning = null;
    e.target = get(p.x, p.z, 2.5, 'arena', 'player', true);
    e.reason = 'arena';
    return;
  }

  const home = e.home || { x: e.x, z: e.z };
  const overTether = distance(e, home) > MAX_TETHER_FROM_HOME || distance(p, home) > MAX_PURSUIT_PLAYER_DIST + 1.5;

  // Blind zombie awareness in darkness: physical bump radius + doorway rear ambush when player passes by
  const playerZone = world.zoneAt(p.x, p.z);
  const myZone = e.zoneId != null ? world.labyrinth.zones[e.zoneId] : null;
  const sameZone = playerZone && e.zoneId === playerZone.id;
  const nearDoorOfZone = myZone && myZone.doors.some(d => distance(p, d) < 2.6);
  const blindRange = rules.blindSight + (sameZone ? 0.25 : 0);
  const clearEye = gap < 6.0 && world.clear(origin, playerEye);

  if (!overTether && clearEye) {
    if (gap < blindRange) {
      const firstTouch = !e.alerted;
      e.dormant = false;
      e.alerted = true;
      e.returning = null;
      offer(get(p.x, p.z, 3.5, 'bump', 'player', true));
      if (firstTouch) enemyVoice(run, e, 'shriek');
    } else if ((sameZone || nearDoorOfZone) && gap < 5.4) {
      // Ambush trigger when player walks past a doorway or turns their back inside the room
      const fwd = direction(p.yaw);
      const toEnemyDot = ((e.x - p.x) * fwd.x + (e.z - p.z) * fwd.z) / (gap || 1);
      if (toEnemyDot < 0.22 || gap < 3.2) {
        const firstAmbush = !e.alerted;
        e.dormant = false;
        e.alerted = true;
        e.returning = null;
        offer(get(p.x, p.z, 2.8, 'ambush', 'ambush', true));
        if (firstAmbush) enemyVoice(run, e, 'shriek');
      }
    }
  }

  // Flashlight beam touching zombie or doorway splash draws zombie toward light origin
  if (!overTether && lamps.length) {
    const torsoPt = { ...origin, y: ENEMIES[e.kind].height * 0.58 };
    const groundPt = { ...origin, y: 0.28 };
    for (const light of lamps) {
      if (gap >= light.range + 4) continue;
      if (inBeam(world, light, origin) || inBeam(world, light, torsoPt) || inBeam(world, light, groundPt)) {
        e.dormant = false;
        e.alerted = true;
        e.returning = null;
        offer(get(light.origin.x, light.origin.z, 1.35 - gap / (light.range + 8) * 0.5, 'flashlight', 'lamp', true));
      }
    }
  }

  // Noise events (gunshots, shrieks, pebbles/branches/puddles, loud footsteps) scoped cleanly to zone / unoccluded threshold
  if (!overTether) {
    for (let i = run.noises.length - 1; i >= 0; i--) {
      const n = run.noises[i], age = time - n.born, d = distance(origin, n.origin);
      if (age > n.span || d >= n.radius) continue;
      const isSameZone = n.zoneId != null && e.zoneId === n.zoneId;
      if (!isSameZone && d > 9.5) continue;
      const occluded = !world.clear(origin, n.origin, false);
      if (!isSameZone && occluded) continue;
      const radius = n.radius * (occluded ? 0.55 : 1);
      if (d >= radius) continue;
      const weight = n.kind === 'gunshot' ? 1.4 : n.kind === 'shriek' ? 1.15 : n.kind === 'puddles' || n.kind === 'branches' || n.kind === 'pebbles' ? 1.35 : 0.85;
      const score = (1 - d / radius) * (1 - age / n.span) * weight;
      if (score > 0.14) {
        e.dormant = false;
        e.alerted = true;
        e.returning = null;
        offer(get(n.origin.x, n.origin.z, score, n.kind, n.kind, true));
      }
    }
  }

  if (best?.chase) {
    e.memory = { ...best, until: time + rules.memorySeconds };
  }

  if (!best && e.memory?.until > time && distance(e, e.memory) > 0.9 && !overTether) {
    best = { ...e.memory, score: 0.2, reason: 'searching', chase: true };
  }

  if ((!best && e.memory && e.memory.until <= time) || overTether) {
    if (e.alerted || e.memory) e.returning = { x: home.x, z: home.z };
    e.memory = null;
    e.alerted = false;
  }

  const nextReason = best?.reason || (e.returning ? 'returning' : 'ambushIdle');
  if (nextReason !== e.reason) e.changedAt = time;
  e.reason = nextReason;
  e.target = best;
}

function hurt(run, enemy) {
  const p = run.player;
  if (p.protection > 0) return;
  run.metrics.damage[enemy.kind] = (run.metrics.damage[enemy.kind] || 0) + 1;
  if (p.armor > 0) {
    p.armor--;
    p.protection = 0.82;
    emit(run, 'armorHit', { armor: p.armor, kind: enemy.kind });
    return;
  }
  p.reload = null;
  run.status = 'dead';
  run.death = {
    kind: enemy.kind,
    yaw: angleDelta(Math.atan2(enemy.x - p.x, enemy.z - p.z), p.yaw),
    attacker: { id: enemy.id, x: enemy.x, y: enemy.y + ENEMIES[enemy.kind].height, z: enemy.z },
  };
  emit(run, 'death', { ...run.death });
}

function enemyVoice(run, enemy, type, contactPoint) {
  const height = type === 'swing' ? 1.1 : ENEMIES[enemy.kind].height * 0.84;
  const position = contactPoint || { x: enemy.x, y: enemy.y + height, z: enemy.z };
  emit(run, type, { id: enemy.id, ...position, kind: enemy.kind });
}

function voiceCadence(run, enemy, gap) {
  const { time } = run;
  const band = gap <= 5 ? 0 : gap <= 12 ? 1 : 2;
  if (band < enemy.voiceBand) {
    enemy.nextVoice = Math.min(enemy.nextVoice, Math.max(time, enemy.lastVoice + 0.48));
    enemy.voiceBand = band;
  }
  if (gap > 12.65) enemy.voiceBand = 2;
  else if (gap > 5.65 && enemy.voiceBand === 0) enemy.voiceBand = 1;
  if (gap > 28 || time < enemy.lastVoice + 0.48 || time < enemy.nextVoice) return;
  enemyVoice(run, enemy, 'voice');
  enemy.lastVoice = time;
  const variation = (enemy.voiceVariation + time * 0.53) % 1;
  enemy.nextVoice = time + (gap <= 5 ? 1.2 + variation * 0.4 : gap <= 12 ? 1.8 + variation * 0.8 : 2.3 + variation * 1.1);
}

function attack(run, enemy, gap, dt) {
  const p = run.player, shape = ENEMIES[enemy.kind];
  const toward = Math.atan2(p.x - enemy.x, enemy.z - p.z);
  const torso = { x: p.x, y: p.y + Math.min(1.17, p.eyeHeight * 0.73), z: p.z };
  const canReach = range => distance(enemy, p) < range && run.world.clear(eye(run.world, enemy, 1.02), torso);
  enemy.recover = Math.max(0, enemy.recover - dt);

  if (enemy.attackAge !== undefined) {
    const age = enemy.attackAge, windup = enemy.attackWindup;
    const contact = attackContact(enemy.kind);
    if (age < windup) {
      enemy.yaw += clamp(angleDelta(toward, enemy.yaw), -dt * 3.0, dt * 3.0);
      const power = Math.min(run.rules.speedLimit, shape.chaseSpeed * 0.85);
      if (age > windup * 0.58 && gap > 0.74 && Math.abs(angleDelta(toward, enemy.yaw)) < 0.52) {
        const stepX = Math.sin(enemy.yaw) * power * dt;
        const stepZ = -Math.cos(enemy.yaw) * power * dt;
        const zone = enemy.zoneId != null ? run.world.labyrinth.zones[enemy.zoneId] : null;
        if (!zone || isInsideOwnZone(run.world.labyrinth, zone, enemy.x + stepX, enemy.z + stepZ)) {
          run.world.move(enemy, stepX, stepZ, shape.width * 0.83);
          enemy.y = run.world.height(enemy.x, enemy.z);
        }
      }
    }
    enemy.attackAge = age + dt;
    enemy.windup = Math.max(0, windup - enemy.attackAge);
    if (age < windup && enemy.attackAge + 1e-9 >= windup) {
      enemy.attackAge = windup;
      enemy.windup = 0;
      const hands = animatedAnchors(enemy, shape.windup);
      const right = hands[12], left = hands[6];
      const reaches = (elbow, hand) => {
        const x = hand.x - elbow.x, z = hand.z - elbow.z;
        const t = clamp(((torso.x - elbow.x) * x + (torso.z - elbow.z) * z) / (x * x + z * z || 1), 0, 1);
        const arm = { x: elbow.x + t * x, z: elbow.z + t * z, y: elbow.y + t * (hand.y - elbow.y) };
        const body = { ...torso, y: clamp(arm.y, p.y + 0.69, torso.y) };
        return Math.hypot(arm.x - body.x, arm.y - body.y, arm.z - body.z) < 0.50 && run.world.clear(arm, body);
      };
      if (canReach(shape.reach + 0.48) && (reaches(hands[11], right) || reaches(hands[5], left))) hurt(run, enemy);
      enemyVoice(run, enemy, 'swing', distance(right, p) < distance(left, p) ? right : left);
    }
    if (enemy.attackAge >= windup / contact) {
      enemy.attackAge = undefined;
      enemy.attackFrom = null;
      enemy.recover = enemy.kind === 'brute' ? 0.65 : 0.28;
    }
    return true;
  }

  const triggerReach = shape.reach + (enemy.kind === 'shrieker' ? 0.54 : 0.36);
  if (enemy.recover <= 0 && run.nextAttack <= run.time && canReach(triggerReach)) {
    enemy.attackFrom = enemyMotion(enemy, shape.windup).filter(clip => clip[2] > 0);
    enemy.burstStart = enemy.burst = enemy.brakeUntil = 0;
    enemy.attackClip = 'Attack';
    enemy.attackWindup = shape.windup;
    enemy.attackAge = 0;
    enemy.windup = enemy.attackWindup;
    enemy.moveSpeed = enemy.stride = 0;
    enemy.footing = enemy.plantLocks = null;
    run.nextAttack = run.time + 0.33;
    enemyVoice(run, enemy, 'windup');
    enemy.lastVoice = run.time;
    return true;
  }
  return false;
}

function navigate(run, e, tx, tz, dt) {
  const cfg = ENEMIES[e.kind], { time, world } = run;
  const labyrinth = world.labyrinth;
  const arena = world.arena;

  // Concealed zombies wait silently & motionless in their corner until ambush/alert triggers
  if (!arena && e.tactic?.role === 'ambushIdle' && !e.target?.chase) {
    const face = Math.atan2((e.tactic.lookX ?? tx) - e.x, (e.tactic.lookZ ?? tz) - e.z);
    e.yaw += clamp(angleDelta(face, e.yaw), -dt * 3, dt * 3);
    e.moveSpeed = 0;
    e.stride = 0;
    return;
  }

  let stepTarget;
  if (arena) {
    const shiftVer = run.arenaShift?.version || 0;
    const navKey = `a:${Math.round(tx)}:${Math.round(tz)}:${shiftVer}`;
    if (e._mazeNav && e._mazeNav.key === navKey && time < e._mazeNav.until && distance(e, e._mazeNav.target) > 0.35) {
      stepTarget = e._mazeNav.target;
    } else {
      stepTarget = arena.findStep(e, { x: tx, z: tz });
      e._mazeNav = { key: navKey, target: stepTarget, until: time + 0.30 };
    }
  } else {
    // Multi-room grid navigation (cached 0.32 s) so ambushing zombies can cross doorways briefly and return home
    const [tc, tr] = labyrinth.worldToCell(tx, tz);
    const navKey = `${tc}:${tr}:${e.tactic?.role || ''}`;
    if (e._mazeNav && e._mazeNav.key === navKey && time < e._mazeNav.until && distance(e, e._mazeNav.target) > 0.4) {
      stepTarget = e._mazeNav.target;
    } else {
      stepTarget = findMazeStep(labyrinth, e, { x: tx, z: tz });
      e._mazeNav = { key: navKey, target: stepTarget, until: time + 0.32 };
    }
  }

  const inArenaDoorway = Boolean(arena && arena.faces.some(f => e.x * f.nx + e.z * f.nz > arena.apothem - 1.25));
  const desired = Math.atan2(stepTarget.x - e.x, e.z - stepTarget.z);
  let vx = Math.sin(desired), vz = -Math.cos(desired);
  const sepWeight = inArenaDoorway ? 0.20 : 1.15;
  for (const other of run.enemies) {
    if (other === e || other.dead) continue;
    const dx = e.x - other.x, dz = e.z - other.z, d = dx * dx + dz * dz;
    if (d > 0.001 && d < 0.92) {
      vx += dx * (0.92 - d) / Math.sqrt(d) * sepWeight;
      vz += dz * (0.92 - d) / Math.sqrt(d) * sepWeight;
    }
  }

  const targetAngle = Math.atan2(vx, -vz), look = e.kind === 'brute' ? 3.2 : 5.2;
  const turnDelta = clamp(angleDelta(targetAngle, e.yaw), -dt * look, dt * look);
  e.yaw += turnDelta;
  e.turnRate = turnDelta / dt;

  const burst = burstPhase(e, time), isBurst = burst === 'Sprint';
  const phase = e.gait;
  const stepPace = 1 + (e.kind === 'brute' ? 0.14 : 0.11) * Math.sin(2 * phase) + (e.kind === 'shambler' ? 0.14 : 0.06) * Math.sin(phase);
  const progress = e.stumble > 0 ? 1 - e.stumble / e.stumbleDuration : 0;
  const stumblePace = progress > 0 ? 1 - 0.43 * Math.sin(Math.PI * progress) + 0.16 * Math.sin(2 * Math.PI * progress) : 1;

  const baseSpeed = e.target?.chase ? Math.min(run.rules.speedLimit, cfg.chaseSpeed * run.rules.aggroScale) : cfg.speed * 1.15;
  const speedTarget = (isBurst ? run.rules.speedLimit : baseSpeed * e.pace * stepPace * stumblePace)
    * (e.slow > 0 ? 0.58 : 1) * (e.stun > 0 ? 0.45 : 1) * (e.recover > 0.32 ? 0.35 : 1);
  const previous = e.moveSpeed;
  const targetSpeed = Math.min(run.rules.speedLimit, burst === 'BurstLoad' ? 0.22 : burst === 'Brake' ? speedTarget * 0.66 : speedTarget);
  const speed = e.moveSpeed += clamp(targetSpeed - e.moveSpeed, -dt * 5.6, dt * (e.kind === 'brute' ? 2.6 : 5.4));
  if (previous < 0.13 && speed >= 0.13) e.startAge = 0;

  const oldX = e.x, oldZ = e.z, radius = cfg.width * 0.83;
  const allowAlcove = Boolean(arena);
  const turnAngles = inArenaDoorway ? [0, 0.35, -0.35, 0.72, -0.72, 1.15, -1.15] : [0, 0.59, -0.59, 1.15, -1.15, 1.72, -1.72, 2.22];
  const baseProbe = inArenaDoorway ? Math.max(0.32, speed * 0.24) : Math.max(0.64, speed * 0.44);
  for (const turn of turnAngles) {
    const vector = direction(e.yaw + turn * e.turnSide);
    if (world.blocks(e.x + vector.x * baseProbe, e.z + vector.z * baseProbe, radius + 0.05, allowAlcove)) continue;
    world.move(e, vector.x * dt * speed, vector.z * dt * speed, radius, allowAlcove);
    if (turn) e.yaw += clamp(turn * e.turnSide, -dt * look, dt * look);
    if (distance(e, { x: oldX, z: oldZ }) > 0.001) break;
  }

  const moved = Math.hypot(e.x - oldX, e.z - oldZ);
  e.stuck = moved < 0.001 ? e.stuck + dt : Math.max(0, e.stuck - dt * 3);
  if (e.stuck > 0.85) { e.turnSide *= -1; e.stuck = 0; }
  if (moved > 0.012 && !burst && time > e.nextStumble) {
    e.stumbleDuration = (e.kind === 'brute' ? 0.92 : e.kind === 'shrieker' ? 0.49 : 0.75) * (1.17 - 0.19 * e.pace);
    e.stumble = e.stumbleDuration;
    e.nextStumble = time + 3.7 + run.rng() * 6.5;
  }
  e.stride = moved / dt;
  const sprintStride = 1.95 * cfg.height / ENEMIES.shambler.height;
  const stride = isBurst || burst === 'Brake' ? sprintStride : strideLength(e.kind);
  e.gait += moved * Math.PI * 2 / stride;
  e.y = world.height(e.x, e.z);
  updateEnemyFooting(world, e, cfg.windup, distance(run.player, e));
}

function updateEnemies(run, dt, lamps) {
  const { player: p, time } = run;
  syncActiveRoster(run);
  if (time >= run.nextTacticsTick) {
    updateHordeTactics(run);
    run.nextTacticsTick = time + 0.30;
  }

  // Restrict ambient/threat vocalizations to ONLY the 4 closest living zombies.
  // When a closest zombie dies and a new survivor enters the top 4, immediately hand off voice cadence.
  const prevAudible = run.audibleIds || new Set();
  const audible = run.enemies
    .filter(e => !e.dead && (e.alerted || e.target?.chase || distance(e, p) < 8.0))
    .map(e => ({ e, id: e.id, gap: distance(e, p) }))
    .filter(entry => entry.gap <= 28)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 4);
  const voiceAllowed = new Set(audible.map(entry => entry.id));
  for (const entry of audible) {
    if (!prevAudible.has(entry.id)) {
      entry.e.nextVoice = Math.min(entry.e.nextVoice, time + 0.08);
    }
  }
  run.audibleIds = voiceAllowed;

  for (const e of run.enemies) {
    if (e.dead) continue;
    const gap = distance(e, p);

    if (time >= e.nextThink) {
      perception(run, e, gap, lamps);
      e.nextThink = time + (gap < 18 ? 0.18 : 0.38) + run.rng() * 0.08;
    }

    e.stun = Math.max(0, e.stun - dt);
    e.slow = Math.max(0, e.slow - dt);
    e.stumble = Math.max(0, e.stumble - dt);
    e.poseTime = time;
    Object.assign(e.previousTransform, { x: e.x, y: e.y, z: e.z, yaw: e.yaw });
    e.startAge += dt;
    e.hitAge += dt;
    e.turnRate = 0;

    if (attack(run, e, gap, dt)) continue;

    const nav = e.target?.chase
      ? { x: e.target.x, z: e.target.z }
      : (e.tactic || e.home || { x: e.x, z: e.z });
    e.route = nav;
    navigate(run, e, nav.x, nav.z, dt);
    if (voiceAllowed.has(e.id)) voiceCadence(run, e, gap);
  }
}

export function inspectFlashlights(run, input) {
  const p = run.player;
  if (input.toggleLight) {
    if (!p.flashlight && p.battery <= 0) emit(run, 'light', { on: false, empty: true });
    else { p.flashlight = !p.flashlight; emit(run, 'light', { on: p.flashlight }); }
  }
  if (input.toggleBeam) {
    p.beam = beamCycle[p.beam] || 'wide';
    if (p.beam !== 'off') p.flashlight = true;
    emit(run, 'beam', { mode: p.beam });
  }
}

function checkHazards(run, moved, dt, walkHeld) {
  const { player: p, world, time } = run;
  if (moved <= 0.002) return;
  const creeping = Boolean(walkHeld) || (moved / dt < 1.38);
  const playerZoneId = world.zoneAt(p.x, p.z)?.id ?? null;
  for (const area of world.around(p.x, p.z, 2)) {
    for (const h of area.hazards) {
      if (time < (h.cooldownUntil || 0)) continue;
      if (Math.hypot(p.x - h.x, p.z - h.z) <= h.r + 0.18) {
        h.cooldownUntil = time + 0.90;
        run.metrics.hazardsTriggered++;
        const radius = creeping ? 6.5 : 15.0;
        emit(run, 'hazardStep', { kind: h.kind, x: p.x, y: p.y, z: p.z, quiet: creeping });
        noise(run, h.kind, p, radius, 2.2, h.zoneId ?? playerZoneId);
        return;
      }
    }
  }
}

function stepArenaState(run, dt) {
  const { world, player: p, wave, arenaShift } = run;
  const arena = world.arena;
  if (!arena) return;

  // 1) 30-second shifting floor cubes (never trapping player or any zombie)
  if (run.time >= arenaShift.nextAt) {
    const occupants = [{ x: p.x, z: p.z, radius: 0.65 }];
    for (const e of run.enemies) {
      if (!e.dead) occupants.push({ x: e.x, z: e.z, radius: 0.55 });
    }
    arena.shiftLayout(occupants, false);
    arenaShift.version++;
    arenaShift.nextAt = run.time + ARENA_SHIFT_INTERVAL;
    for (const e of run.enemies) e._mazeNav = null;
    emit(run, 'earthShift', { x: p.x, y: p.y, z: p.z, version: arenaShift.version });
  }
  arenaShift.moving = arena.stepAnimation(dt);

  if (!run.populate || !wave) return;

  // 2) Inter-wave breather countdown
  if (wave.intermission > 0) {
    wave.intermission = Math.max(0, wave.intermission - dt);
    if (wave.intermission === 0) {
      run.wave = buildWaveQueue(run, wave.number + 1);
      emit(run, 'waveStart', { wave: run.wave.number });
    }
    return;
  }

  // 3) Burst doorway spawns (1..5 zombies per burst across the 6 doors)
  const aliveCount = run.roster.reduce((sum, e) => sum + (e.dead ? 0 : 1), 0);
  if (wave.queue.length > 0) {
    wave.burstTimer -= dt;
    if (wave.burstTimer <= 0 && aliveCount < MAX_ACTIVE_ZOMBIES) {
      const burst = wave.queue[0];
      const allowed = Math.min(burst.length, MAX_ACTIVE_ZOMBIES - aliveCount);
      const batch = burst.splice(0, allowed);
      if (burst.length === 0) wave.queue.shift();
      const usedDoors = [];
      for (const spec of batch) {
        const doorIdx = spec.doorIdx != null ? spec.doorIdx : pickSpawnDoor(run, usedDoors);
        usedDoors.push(doorIdx);
        const face = arena.faces[doorIdx % 6];
        const side = (run.rng() - 0.5) * 0.45;
        const back = run.rng() * 0.40;
        const sx = face.spawnX + face.tx * side + face.nx * back;
        const sz = face.spawnZ + face.tz * side + face.nz * back;
        const zombie = addEnemy(run, spec.kind, sx, sz, { yaw: face.yaw, dormant: false });
        zombie.alerted = true;
        wave.spawned++;
      }
      wave.burstTimer = Math.max(2.1, 4.4 - wave.number * 0.24) + run.rng() * 1.4;
      emit(run, 'doorBurst', { count: batch.length, wave: wave.number, doors: usedDoors });
    }
    return;
  }

  // 4) Wave cleared -> spawn rewards & intermission
  if (aliveCount === 0) {
    run.roster = [];
    run.enemies = [];
    spawnWaveRewards(run, wave.number);
    wave.intermission = 7.5;
    emit(run, 'waveClear', { wave: wave.number, nextWave: wave.number + 1 });
  }
}

export function stepRun(run, input = {}, dt = STEP) {
  run.events = [];
  if (run.status !== 'playing') return [];
  const p = run.player, world = run.world;
  run.time += dt;
  if (input.yaw !== undefined) p.yaw = input.yaw;
  if (input.eyeHeight !== undefined) p.eyeHeight = input.eyeHeight;
  p.protection = Math.max(0, p.protection - dt);
  p.cooldown = Math.max(0, p.cooldown - dt);

  if (p.reload) {
    p.reload.left -= dt;
    if (p.reload.left <= 0) {
      const need = magazineCapacity(p) - p.ammo;
      const takeRounds = Math.min(need, p.reserve);
      p.ammo += takeRounds;
      p.reserve -= takeRounds;
      p.reload = null;
      emit(run, 'reloaded', { weapon: p.weapon, ammo: p.ammo });
    }
  }

  if (input.reload) startReload(run);
  if (input.cycleWeapon) cycleWeapon(run);
  inspectFlashlights(run, input);

  // Continuous infinite flashlight charge (never depletes; toggle on/off or wide/focus anytime)
  p.battery = 1;
  const activeLight = p.flashlight && p.beam !== 'off' && !input.lampUnavailable;

  if (world.arena) stepArenaState(run, dt);

  const moveX = input.moveX || 0, moveZ = input.moveZ || 0;
  const length = Math.hypot(moveX, moveZ);
  const speed = input.walk ? 1.25 : 2.65;
  const oldX = p.x, oldZ = p.z;
  const dx = (length > 1 ? moveX / length : moveX) * speed * dt + (input.roomX || 0);
  const dz = (length > 1 ? moveZ / length : moveZ) * speed * dt + (input.roomZ || 0);
  if (dx || dz) {
    const moveRes = world.move(p, dx, dz, 0.27);
    if (moveRes.clipped && run.time >= p.lastWallBump) {
      p.lastWallBump = run.time + 0.45;
      emit(run, 'wallBump', { x: p.x, y: p.y, z: p.z });
    }
  }
  p.y = world.height(p.x, p.z);
  p.travelX = (p.x - oldX) / dt;
  p.travelZ = (p.z - oldZ) / dt;

  const moved = Math.hypot(p.x - oldX, p.z - oldZ);
  if (moved > 0.005) {
    p.stepTimer += moved;
    if (p.stepTimer >= 0.72) {
      p.stepTimer = 0;
      const running = !input.walk && moved / dt > 1.55;
      if (running) noise(run, 'footstep', p, 11, 0.55);
      emit(run, 'step', { x: p.x, y: p.y, z: p.z, running });
    }
    checkHazards(run, moved, dt, input.walk);
  }

  if (Math.hypot(p.x - run.lastChunkCheckX, p.z - run.lastChunkCheckZ) > 8) {
    run.lastChunkCheckX = p.x;
    run.lastChunkCheckZ = p.z;
    syncLoot(run);
  }

  if ((input.fire || (input.fireHeld && p.weapon === 'smg')) && !input.weaponUnavailable && input.aim) {
    shoot(run, input.aim);
  }

  takeLoot(run, input.interact);

  const exit = world.exit;
  if (exit && (distance(p, { x: exit.doorX, z: exit.doorZ }) < 1.45 || (distance(p, exit) < 1.0 && world.zoneAt(p.x, p.z)?.id === exit.zoneId && distance(p, { x: exit.doorX, z: exit.doorZ }) < 1.85))) {
    run.status = 'escaped';
    emit(run, 'extraction', { ...exit });
  }

  const head = eye(world, p, p.eyeHeight);
  run.beam = activeLight ? resolvePlayerBeam(run, input.lamp, head) : null;
  updateEnemies(run, dt, activeBeams(run));
  for (const corpse of run.corpses) corpse.fallAge = Math.min(1.5, corpse.fallAge + dt);
  return run.events;
}

export function inventorySnapshot(run) {
  const p = run.player;
  return {
    mode: run.mode,
    wave: run.wave?.number || 0,
    weapons: Object.entries(p.magazines).map(([k, mag]) => ({
      key: k,
      name: GUNS[k].name,
      equipped: p.weapon === k,
      ammo: mag,
      capacity: GUNS[k].capacities[p.upgrades.capacity],
    })),
    reserve: p.reserve,
    armor: p.armor,
    kills: p.kills,
    time: run.time,
    difficulty: run.rules.name,
    upgrades: Object.entries(UPGRADES).map(([k, u]) => ({
      key: k,
      name: u.name,
      level: p.upgrades[k],
      cap: u.cap,
    })),
  };
}
