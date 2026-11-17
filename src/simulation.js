import { findCabinStep } from './cabins.js';
import { DIFFICULTIES, difficultyKey } from './difficulty.js';
import {
  animatedAnchors, attackContact, attackDirection, burstPhase, BURST_BRAKE, BURST_LOAD, BURST_RUN,
  enemyMotion, HIT_SEGMENTS, hitRadii, strideLength, updateEnemyFooting, VITAL_HIT_RADIUS, VITAL_JOINTS,
} from './enemy-motion.js';
import { collectPart, PARTS_REQUIRED, reachableAntenna } from './extraction.js';
import { populateWorldRoster, syncActiveRoster } from './horde.js';
import { ANTENNA, CABIN_SITES, RADIO_PARTS } from './map-layout.js';
import { strategicReturnPoint, updateHordeTactics } from './tactics.js';
import { angleDelta, clamp, createWorld, direction, distance, random, START } from './world.js';

export const STEP = 1 / 30;
export const BUILD = '1.0.3';

export const GUNS = {
  pistol: { name: 'Service pistol', capacities: [6, 12, 24, 50], reload: 1.5, interval: 0.31, range: 65, damage: 1.24, noise: 44, rounds: 1, spread: 0 },
  shotgun: { name: 'Pump shotgun', capacities: [4, 5, 6, 7], reload: 2.2, interval: 0.83, range: 34, damage: 0.91, noise: 57, rounds: 7, spread: 0.077 },
  smg: { name: 'Compact SMG', capacities: [24, 28, 32, 36], reload: 1.8, interval: 0.102, range: 49, damage: 0.93, noise: 48, rounds: 1, spread: 0.02 },
  carbine: { name: 'Ranger carbine', capacities: [16, 20, 24, 28], reload: 2.0, interval: 0.24, range: 75, damage: 1.49, noise: 53, rounds: 1, spread: 0 },
  flaregun: { name: 'Flare gun', capacities: [1, 1, 1, 1], reload: 1.35, interval: 0.42 },
};

// Zombie speeds in m/s: 1.5 mph (0.67 m/s) to 2.5 mph (1.12 m/s max).
export const ENEMIES = {
  shambler: { speed: 0.72, chaseSpeed: 0.90, height: 1.77, width: 0.28, hp: 3.2, windup: 0.60, reach: 1.19 },
  shrieker: { speed: 0.88, chaseSpeed: 1.12, height: 1.66, width: 0.23, hp: 2.4, windup: 0.44, reach: 1.16 },
  brute: { speed: 0.67, chaseSpeed: 0.78, height: 2.0, width: 0.36, hp: 5.9, windup: 0.82, reach: 1.35 },
};

export const UPGRADES = {
  damage: { name: 'Hot loads', icon: '▲', cap: 3, color: '#ff8b70', description: '+15% impact stagger' },
  pierce: { name: 'Piercing rounds', icon: '»', cap: 2, color: '#ffb36c', description: '+1 target per shot' },
  reload: { name: 'Speed loader', icon: '↻', cap: 3, color: '#f1cd86', description: '15% faster reload' },
  battery: { name: 'Battery cells', icon: 'ϟ', cap: 3, color: '#a6d6a0', description: '+8 seconds of light' },
  lens: { name: 'Focus lens', icon: '◇', cap: 3, color: '#9adae6', description: '+3 metres of light' },
  capacity: { name: 'Extended Capacity', icon: '▤', cap: 3, color: '#e2d18d', description: 'Larger firearm magazine' },
};

export const LOOT = {
  ...UPGRADES,
  radioPart: { name: 'Radio Part', icon: '◈', color: '#7ee6a8' },
  ammo: { name: 'Spare rounds', icon: '⋮', color: '#bac5b8' },
  flareAmmo: { name: 'Spare flares', icon: '⁝', color: '#ff9664' },
  pistol: { name: 'Service pistol', icon: 'pistol', color: '#f0cc91' },
  shotgun: { name: 'Pump shotgun', icon: 'shotgun', color: '#ffd299' },
  smg: { name: 'Compact SMG', icon: 'smg', color: '#ebbc91' },
  carbine: { name: 'Ranger carbine', icon: 'carbine', color: '#e5ce98' },
  flaregun: { name: 'Flare gun', icon: 'flaregun', color: '#ff9c66' },
  armor1: { name: 'Padded vest', icon: 'Ⅰ', color: '#9cb9ce' },
  armor2: { name: 'Protective vest', icon: 'Ⅱ', color: '#abc5e0' },
  armor3: { name: 'Heavy plates', icon: 'Ⅲ', color: '#bbd6ec' },
};

const POINT = { x: 0, y: 0, z: -1 };
const ARMS = 0.29;
const RESERVE_MAX = 125;
const FLARE_RESERVE_MAX = 49;
const FLARE_BURN = 10;
const FLARE_FLIGHT = 2.5;
const FLARE_SPEED = 23;
const FLARE_GRAVITY = 18;
const beamCycle = { wide: 'focus', focus: 'off', off: 'wide' };
const eye = (world, next, tall = 1.4) => ({ x: next.x, y: world.height(next.x, next.z) + tall, z: next.z });

export function magazineCapacity(player) {
  return GUNS[player.weapon].capacities[player.upgrades.capacity];
}

export function flarePower(age) {
  if (age <= 5) return 1;
  const fade = clamp((25 - age) / 20, 0, 1);
  return fade * fade * (3 - 2 * fade);
}

export function isSupply(kind) {
  return kind === 'ammo' || kind === 'flareAmmo';
}

export function signalFlarePower(age) {
  const fade = clamp((FLARE_BURN - age) / (FLARE_BURN - 1.5), 0, 1);
  return fade * fade * (3 - 2 * fade);
}

function isFlareTarget(reason) {
  return reason === 'loot flare' || reason === 'signal flare';
}

export function beamSettings(player, mode = player.beam) {
  const focus = mode === 'focus';
  return { range: (focus ? 23 : 15) + player.upgrades.lens * 3, angle: focus ? 0.25 : 0.49 };
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
  return cast ? { ...cast, ...beamSettings(p, mode), mode } : null;
}

function norm(v) {
  const length = Math.hypot(v.x, v.y, v.z);
  return length > 0 ? { x: v.x / length, y: v.y / length, z: v.z / length } : POINT;
}

export function inBeam(world, beam, at) {
  if (!beam) return false;
  const dx = at.x - beam.origin.x, dy = at.y - beam.origin.y, dz = at.z - beam.origin.z;
  const d = Math.hypot(dx, dy, dz);
  return d < beam.range && dx * beam.ray.x + dy * beam.ray.y + dz * beam.ray.z >= Math.cos(beam.angle) * d
    && world.clear(beam.origin, at);
}

export function enemyPose(enemy) {
  const [chin, brow, chest, hips] = animatedAnchors(enemy, ENEMIES[enemy.kind].windup, 4);
  const center = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
  return { head: center(chin, brow), torso: center(chest, hips) };
}

export function enemyVitalPoint(enemy) {
  const points = animatedAnchors(enemy, ENEMIES[enemy.kind].windup);
  return points[enemy.vitalJoint ?? 2];
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
    // Check the lit vital joint sphere first so own arms/torso never block a clean shot at the red target.
    if (e.revealed) {
      const vp = points[e.vitalJoint ?? 2];
      const tVital = raySphere(origin, ray, vp, VITAL_HIT_RADIUS);
      if (tVital < limit) {
        hits.push({ e, t: tVital, zone: 'vital', vitalHit: true, point: rayPoint(origin, ray, tVital) });
        continue;
      }
    }
    let best = limit, zone = null;
    for (const [i, [a, b, tag]] of HIT_SEGMENTS.entries()) {
      const radius = tag === 'head' ? radii[i] * 1.18 : radii[i];
      const t = rayCapsule(origin, ray, points[a], points[b], radius);
      if (t < best) { best = t; zone = tag; }
    }
    if (zone) hits.push({ e, t: best, zone, vitalHit: false, point: rayPoint(origin, ray, best) });
  }
  hits.sort((a, b) => a.t - b.t);
  return { hits, cover: solid && { zone: 'cover', surface: solid.kind, point: rayPoint(origin, ray, solid.t) } };
}

export function traceAim(run, aim) {
  if (!aim?.origin || !aim?.ray) return null;
  const blocked = muzzleCover(run.world, aim);
  if (run.player.weapon === 'flaregun') {
    const flare = createSignalFlare(aim, blocked);
    while (flare.age < FLARE_FLIGHT && !flare.landed) advanceFlare(run.world, flare, 0.12);
    return flare.landed ? { zone: 'cover', point: flare } : null;
  }
  if (blocked) return blocked;
  const { range } = GUNS[run.player.weapon], ray = norm(aim.ray);
  const { hits, cover } = traceRay(run.world, aim.origin, ray, range, prepareTargets(run, aim.origin, ray, range));
  if (!hits.length) return cover;
  const first = hits[0];
  return { ...first, zone: first.vitalHit ? 'head' : 'armor' };
}

function emit(run, type, data = {}) {
  run.events.push({ type, ...data });
}

export function createRun(seed = 'last-night', { populate = true, difficulty = 'standard' } = {}) {
  const world = createWorld(seed);
  const key = difficultyKey(difficulty);
  const upgrades = Object.fromEntries(Object.keys(UPGRADES).map(k => [k, 0]));
  const magazines = { pistol: GUNS.pistol.capacities[0], flaregun: 1 };

  const run = {
    seed,
    difficulty: key,
    rules: DIFFICULTIES[key],
    world,
    populate,
    rng: random(seed + ':run'),
    time: 0,
    status: 'playing',
    player: {
      x: START.x,
      z: START.z,
      y: world.height(START.x, START.z),
      yaw: 0,
      eyeHeight: 1.63,
      weapon: 'pistol',
      magazines,
      get ammo() { return this.magazines[this.weapon]; },
      set ammo(value) { this.magazines[this.weapon] = value; },
      reserve: 42,
      flares: 8,
      get equippedReserve() { return this.weapon === 'flaregun' ? this.flares : this.reserve; },
      set equippedReserve(value) {
        if (this.weapon === 'flaregun') this.flares = value;
        else this.reserve = value;
      },
      armor: 0,
      protection: 0,
      cooldown: 0,
      reload: null,
      flashlight: true,
      battery: 1,
      beam: 'wide',
      upgrades,
      kills: 0,
      headshots: 0,
      noisePeak: -1,
      stepTimer: 0,
      travelX: 0,
      travelZ: 0,
    },
    roster: [],
    enemies: [],
    corpses: [],
    loot: [],
    settledLoot: new Set(),
    signalFlares: [],
    noises: [],
    events: [],
    offer: null,
    beam: null,
    search: {
      parts: [],
      required: PARTS_REQUIRED,
      assembled: false,
      discovered: new Set(),
      antennaReached: false,
    },
    counts: { indoor: 0, outdoor: 0, total: 0 },
    nextId: 1,
    nextAttack: 0,
    nextSwarmTick: 0,
    nextTacticsTick: 0,
    lastChunkCheck: -Infinity,
    metrics: { shots: 0, dryFire: 0, deflects: 0, wallBreaks: 0, roundsPicked: 0, upgrades: 0, pickups: {}, damage: {} },
  };

  syncLoot(run);
  if (populate) populateWorldRoster(run, addEnemy);
  return run;
}

export function addEnemy(run, kind, x, z, meta = {}) {
  const vitalJoint = meta.vitalJoint ?? VITAL_JOINTS[Math.floor(run.rng() * VITAL_JOINTS.length)];
  const enemy = {
    id: run.nextId++,
    kind,
    appearance: run.rng() < 0.5 ? kind : `${kind}-alt`,
    vitalJoint,
    revealed: false,
    revealGlow: 0,
    x,
    z,
    y: run.world.height(x, z),
    yaw: run.rng() * Math.PI * 2,
    hp: ENEMIES[kind].hp,
    pace: 0.94 + run.rng() * 0.16,
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
    breach: 0,
    breachWall: null,
    stumble: 0,
    stumbleDuration: 0.7,
    nextStumble: 4 + run.rng() * 6,
    burstStart: 0,
    burst: 0,
    brakeUntil: 0,
    nextBurst: 2 + run.rng() * 3,
    nextThink: run.rng() * 0.25,
    nextVoice: 1 + run.rng() * 4,
    lastVoice: -9,
    voiceBand: 2,
    voiceVariation: run.rng(),
    dead: false,
    dormant: meta.dormant ?? true,
    alerted: false,
    indoor: Boolean(meta.indoor),
    cabinId: meta.cabinId || null,
    ambushStyle: meta.ambushStyle || 'forest',
    home: { x, z },
    tactic: null,
    preferBreak: false,
    returning: null,
    memory: null,
    target: null,
    reason: 'dormant',
    route: null,
    swapAfter: 0,
    changedAt: 0,
  };
  enemy.previousTransform.yaw = enemy.yaw;
  if (!run.roster.includes(enemy)) run.roster.push(enemy);
  if (!run.enemies.includes(enemy) && distance(enemy, run.player) <= 75) run.enemies.push(enemy);
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
  const known = new Set(run.loot.map(item => item.id));
  for (const area of world.around(p.x, p.z, 84)) {
    for (const site of area.loot) {
      if (known.has(site.id) || run.settledLoot.has(site.id)) continue;
      setLoot(run, site.kind, site.x, site.z, site.id, site.amount || 0, site.name || '');
    }
  }
  run.loot = run.loot.filter(item => !item.lost);
}

function noise(run, kind, origin, radius, span) {
  run.noises.push({ kind, origin: { ...origin }, radius, born: run.time, span });
  if (run.noises.length > 48) run.noises.shift();
}

function eliminate(run, e, vital) {
  const p = run.player;
  e.dead = true;
  e.revealed = false;
  p.kills++;
  if (vital) p.headshots++;
  run.corpses.push({
    ...e,
    headshot: vital,
    diedAt: run.time,
    fallAge: 0,
    fallFrom: enemyMotion(e, ENEMIES[e.kind].windup),
  });
  if (run.corpses.length > 24) run.corpses.shift();
  emit(run, 'kill', { ...enemyPose(e).torso, kind: e.kind, headshot: vital });
  if (run.rng() < 0.42) setLoot(run, 'ammo', e.x, e.z, undefined, 4 + Math.floor(run.rng() * 4));
}

function createSignalFlare(aim, blocked) {
  const ray = norm(aim.ray);
  const point = blocked ? rayPoint(blocked.point, blocked.ray, -0.045) : aim.origin;
  return {
    ...point,
    age: 0,
    landed: false,
    vx: blocked ? 0 : ray.x * FLARE_SPEED,
    vy: blocked ? 0 : ray.y * FLARE_SPEED,
    vz: blocked ? 0 : ray.z * FLARE_SPEED,
  };
}

function advanceFlare(world, flare, dt) {
  const remaining = Math.min(dt, FLARE_FLIGHT - flare.age);
  const dx = flare.vx * remaining, dz = flare.vz * remaining;
  const dy = (flare.vy - 0.5 * FLARE_GRAVITY * remaining) * remaining;
  const length = Math.hypot(dx, dy, dz);
  const ray = length ? { x: dx / length, y: dy / length, z: dz / length } : POINT;
  const hit = length ? world.raycast(flare, ray, length) : null;
  flare.age += remaining;
  flare.vy -= FLARE_GRAVITY * remaining;
  const point = rayPoint(flare, ray, hit ? Math.max(0, hit.t - 0.04) : length);
  if (hit || flare.age >= FLARE_FLIGHT) {
    flare.landed = true;
    const ground = world.height(point.x, point.z);
    const below = hit?.kind !== 'earth' && point.y > ground + 0.13
      ? world.raycast(point, { x: 0, y: -1, z: 0 }, point.y - ground) : null;
    point.y = (below && below.kind !== 'earth' ? point.y - below.t : ground) + 0.13;
  }
  Object.assign(flare, point);
}

function updateSignalFlares(run, dt) {
  run.signalFlares = run.signalFlares.filter(flare => run.time - flare.born < FLARE_BURN);
  for (const flare of run.signalFlares) {
    if (flare.landed) continue;
    advanceFlare(run.world, flare, dt);
    if (!flare.landed) continue;
    flare.born = run.time;
    run.nextSwarmTick = Math.min(run.nextSwarmTick, run.time);
    emit(run, 'signalFlare', { x: flare.x, y: flare.y, z: flare.z });
  }
}

export function shoot(run, aim) {
  const { player: p, world } = run, gun = GUNS[p.weapon];
  if (run.status !== 'playing' || p.cooldown > 0 || p.reload) return;
  if (!p.ammo) {
    if (startReload(run)) return;
    run.metrics.dryFire++;
    p.cooldown = 0.32;
    emit(run, 'dry', { reason: p.weapon === 'flaregun' ? 'No spare flares' : 'No spare rounds' });
    return;
  }
  const o = aim.origin, center = norm(aim.ray);
  const blocked = muzzleCover(world, aim);
  p.ammo--;
  p.cooldown = gun.interval;
  const flashOrigin = blocked ? rayPoint(blocked.point, blocked.ray, -0.045) : o;
  if (p.weapon === 'flaregun') {
    run.signalFlares.push({ ...createSignalFlare(aim, blocked), id: 'signal:' + run.nextId++, born: run.time });
    noise(run, 'flare launch', flashOrigin, 8, 0.8);
    emit(run, 'shot', { ...flashOrigin, ray: center, weapon: p.weapon, blocked: Boolean(blocked) });
    startReload(run);
    return;
  }
  p.noisePeak = run.time + 0.45;
  run.metrics.shots++;
  noise(run, 'gunshot', flashOrigin, gun.noise, 3.0);
  emit(run, 'shot', { ...flashOrigin, ray: center, weapon: p.weapon, blocked: Boolean(blocked) });
  if (!p.ammo) startReload(run);
  if (blocked) {
    emit(run, 'impact', { ...blocked.point, surface: blocked.surface });
    return;
  }

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
      const current = hits.get(hit.e) || { vitalHit: false, leg: false, point: hit.point };
      if (hit.vitalHit) current.vitalHit = true;
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
    // Attacked monster shrieks, alerting nearby zombies!
    noise(run, 'shriek', enemy, 22, 2.0);
    enemyVoice(run, enemy, 'shriek');

    if (hit.vitalHit) {
      emit(run, 'impact', { ...hit.point, surface: 'body' });
      eliminate(run, enemy, true);
    } else {
      // Invulnerable in dark or non-vital shot: deflects with brief stagger and calls attention
      run.metrics.deflects++;
      enemy.stun = 0.08 + p.upgrades.damage * 0.04;
      enemy.hitFrom = attackDirection(enemy, center);
      enemy.hitAge = 0;
      if (hit.leg) enemy.slow = 0.6;
      emit(run, 'impact', { ...hit.point, surface: 'armor' });
      emit(run, 'deflect', { ...hit.point, revealed: enemy.revealed, vitalJoint: enemy.vitalJoint });
    }
  }
}

export function startReload(run) {
  const p = run.player, gun = GUNS[p.weapon];
  if (p.reload || !p.equippedReserve || p.ammo >= magazineCapacity(p) || run.status !== 'playing') return false;
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

    if (k === 'radioPart') {
      if (collectPart(run, l)) {
        const count = run.search.parts.length;
        const msg = count >= PARTS_REQUIRED
          ? `Collected ${l.name} (${count}/${PARTS_REQUIRED}) — Bring parts to the Radio Tower!`
          : `Collected ${l.name} (${count}/${PARTS_REQUIRED})`;
        take(run, l, msg);
      }
      continue;
    }

    if (k in GUNS || k.startsWith('armor')) {
      run.offer ??= l;
      continue;
    }

    if (k === 'ammo') {
      const got = Math.max(0, Math.min(RESERVE_MAX - p.reserve, l.amount || 7));
      if (!got) continue;
      p.reserve += got;
      run.metrics.roundsPicked += got;
      take(run, l, '+' + got + ' rounds');
    } else if (k === 'flareAmmo') {
      const got = Math.max(0, Math.min(FLARE_RESERVE_MAX - p.flares, l.amount || 3));
      if (!got) continue;
      p.flares += got;
      take(run, l, '+' + got + ' flares');
    } else if (k in UPGRADES && p.upgrades[k] < UPGRADES[k].cap) {
      p.upgrades[k]++;
      run.metrics.upgrades++;
      const effect = k === 'capacity'
        ? p.weapon === 'flaregun' ? 'Firearm magazines expanded'
          : magazineCapacity(p) + (p.weapon === 'shotgun' ? ' shells' : ' rounds')
        : UPGRADES[k].description;
      take(run, l, UPGRADES[k].name + ' · ' + effect);
    }
  }

  const item = run.offer;
  if (!confirm || !item) return;
  if (item.kind in GUNS) {
    p.magazines[item.kind] = 0;
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

function flareAssignments(run) {
  const { world, player: p } = run;
  const next = new Map();
  const signalBudget = Math.max(2, Math.round(run.enemies.length * 0.55));
  const signals = run.signalFlares.filter(flare => flare.landed).sort((a, b) => b.born - a.born);
  for (const item of signals) {
    if (next.size >= signalBudget) break;
    if (distance(item, p) > 66) continue;
    const power = signalFlarePower(run.time - item.born);
    if (power < 0.04) continue;
    const range = 26 * Math.sqrt(power);
    const nearby = run.enemies.filter(e => !e.dead && distance(e, item) < range && distance(p, e) > 3.0);
    const lit = { ...item, y: item.y + 0.12 };
    const limit = Math.min(8, signalBudget - next.size);
    const choices = nearby.filter(e => !next.has(e.id) && world.clear(eye(world, e), lit))
      .sort((a, b) => distance(a, item) - distance(b, item));
    for (const e of choices.slice(0, limit)) {
      e.dormant = false;
      next.set(e.id, { ...item, power, range, reason: 'signal flare' });
    }
  }
  run.guards = next;
}

function perception(run, e, gap, lamps) {
  const { world, player: p, time, rules } = run;
  const origin = eye(world, e, ENEMIES[e.kind].height * 0.87);
  const playerEye = eye(world, p, p.eyeHeight * 0.8);
  const get = (x, z, score, reason, id, chase) => ({ x, z, score, reason, id, chase });
  let best = null;
  const offer = candidate => { if (!best || candidate.score > best.score) best = candidate; };

  const playerSpeed = Math.hypot(p.travelX, p.travelZ);
  const isMoving = playerSpeed > 0.15;
  const isLit = Boolean(lamps.length || time < p.noisePeak);
  const clearSight = world.clear(origin, playerEye);

  // Action-driven sight & ambush triggers:
  // 1) In total darkness & standing still: only detect at tight bump radius (rules.darkSight ~ 1.8m)
  // 2) Dormant ambush monsters hidden in bushes/trees/rooms trigger if you pass within triggerRadius (~3.5-4.6m)
  // 3) If you shine a light or are already chased & visible in range, normal sight applies
  const sightRange = !isLit && !isMoving
    ? rules.darkSight
    : e.dormant
      ? (isLit ? 12 : playerSpeed > 1.6 ? rules.triggerRadius + 1.6 : rules.triggerRadius)
      : (isLit ? 20 : isMoving ? 6.5 : rules.darkSight);

  if (gap < sightRange && clearSight) {
    const ambushWake = e.dormant;
    e.dormant = false;
    e.alerted = true;
    offer(get(p.x, p.z, gap < 3.2 ? 4 : 1.2, ambushWake ? 'ambush' : 'saw player', 'player', true));
    if (ambushWake) enemyVoice(run, e, 'shriek');
  }

  // Flashlight cone touching the monster or nearby beam splash
  if (lamps.length) {
    const litGround = { ...origin, y: e.y + 0.28 };
    for (const light of lamps) {
      if (gap >= light.range + 5) continue;
      if (inBeam(world, light, origin) || inBeam(world, light, litGround) ||
        (gap < 8 && world.clear(origin, rayPoint(light.origin, light.ray, 0.4)))) {
        e.dormant = false;
        e.alerted = true;
        offer(get(light.origin.x, light.origin.z, 1.12 - gap / (light.range + 10) * 0.55, 'flashlight', 'lamp', true));
      }
    }
  }

  // Noise events (running footsteps, gunshots, wallBreak crashes, attacked-zombie shrieks)
  for (let i = run.noises.length - 1; i >= 0; i--) {
    const n = run.noises[i], age = time - n.born, d = distance(origin, n.origin);
    if (age > n.span || d >= n.radius) continue;
    const occluded = !world.clear(origin, n.origin, false);
    const radius = n.radius * (occluded ? (n.kind === 'gunshot' ? 0.72 : 0.56) : 1);
    if (d >= radius) continue;
    const weight = n.kind === 'gunshot' ? 1.32 : n.kind === 'shriek' ? 1.15 : n.kind === 'wallBreak' ? 1.18 : 0.94;
    const score = (1 - d / radius) * (1 - age / n.span) * weight;
    if (score > 0.12) {
      e.dormant = false;
      e.alerted = true;
      offer(get(n.origin.x, n.origin.z, score, n.kind, n.kind, true));
    }
  }

  // Signal flares divert zombies
  const guard = run.guards?.get(e.id);
  if (guard) {
    offer(get(guard.x, guard.z, (1.5 - 0.39 * distance(e, guard) / guard.range) * guard.power, guard.reason, guard.id, false));
  }

  if (best?.chase) {
    e.returning = null;
    e.memory = { ...best, until: time + (best.reason === 'gunshot' ? rules.memorySeconds + 3 : rules.memorySeconds) };
  }

  // If no current stimulus, search last-known memory until it expires, then re-orient to strategic cover
  if (!best && e.memory?.until > time && distance(e, e.memory) > 1.2) {
    best = { ...e.memory, score: 0.2, reason: 'searching', chase: true };
  }

  if (!best && e.memory && e.memory.until <= time) {
    e.memory = null;
    e.alerted = false;
    e.tactic = null;
    e.returning = strategicReturnPoint(run, e);
  }

  if (!best && e.returning) {
    if (distance(e, e.returning) > 1.3) {
      best = get(e.returning.x, e.returning.z, 0.1, 'returning', 'return', false);
    } else {
      e.returning = null;
      e.dormant = true;
      e.yaw = Math.atan2(p.x - e.x, e.z - p.z);
    }
  }

  const nextReason = best?.reason || (e.dormant ? 'dormant' : 'searching');
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
  if (enemy.dormant) return;
  const { time } = run;
  const band = gap <= 5 ? 0 : gap <= 12 ? 1 : 2;
  if (band < enemy.voiceBand) {
    enemy.nextVoice = Math.min(enemy.nextVoice, Math.max(time, enemy.lastVoice + 0.48));
    enemy.voiceBand = band;
  }
  if (gap > 12.65) enemy.voiceBand = 2;
  else if (gap > 5.65 && enemy.voiceBand === 0) enemy.voiceBand = 1;
  if (gap > 21 || time < enemy.lastVoice + 0.48 || time < enemy.nextVoice) return;
  enemyVoice(run, enemy, 'voice');
  enemy.lastVoice = time;
  const variation = (enemy.voiceVariation + time * 0.53) % 1;
  enemy.nextVoice = time + (gap <= 5 ? 1.23 + variation * 0.27 : gap <= 12 ? 1.95 + variation * 0.90 : 4.1 + variation * 2.15);
}

function breakWall(run, enemy, wall) {
  if (!wall || wall.broken) return;
  wall.broken = true;
  wall.hp = 0;
  run.metrics.wallBreaks++;
  emit(run, 'wallBreak', {
    id: wall.id, cabinId: wall.cabinId,
    x: wall.x, y: wall.y, z: wall.z,
    rx: wall.rx, ry: wall.ry, rz: wall.rz,
  });
  noise(run, 'wallBreak', wall, 26, 2.2);
  enemyVoice(run, enemy, 'shriek');
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
        run.world.move(enemy, Math.sin(enemy.yaw) * power * dt, -Math.cos(enemy.yaw) * power * dt, shape.width * 0.83);
        enemy.y = run.world.height(enemy.x, enemy.z);
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
  const cfg = ENEMIES[e.kind], { time, world, player: p } = run;

  // Door blockers & corner ambushers hold strategic positions until the player gets close or shines a light
  if ((e.tactic?.role === 'doorBlocker' && e.tactic.holdNearDoor && distance(e, p) > 2.6) ||
      (e.tactic?.role === 'cornerWaiter' && distance(e, p) > 4.8 && !e.revealed)) {
    const face = Math.atan2(p.x - e.x, e.z - p.z);
    e.yaw += clamp(angleDelta(face, e.yaw), -dt * 4, dt * 4);
    e.moveSpeed = 0;
    e.stride = 0;
    return;
  }

  // Indoor room & doorway pathfinding + breakable wall ambush breaches
  let destX = tx, destZ = tz;
  const cabin = (e.cabinId && world.getCabin(e.cabinId)) || world.cabinAtPoint(e.x, e.z, 2.5);
  if (e.tactic?.role === 'breacher' && e.tactic.targetWall && !e.tactic.targetWall.broken) {
    const bw = e.tactic.targetWall;
    if (distance(e, bw) < 2.05) {
      e.breachWall = bw;
      e.breach += dt;
      e.yaw += clamp(angleDelta(Math.atan2(bw.x - e.x, e.z - bw.z), e.yaw), -dt * 6, dt * 6);
      if (e.breach >= 0.26) {
        breakWall(run, e, bw);
        e.breach = 0;
        e.breachWall = null;
        e.tactic.targetWall = null;
      }
      e.moveSpeed = 0.2;
      return;
    }
    destX = bw.x;
    destZ = bw.z;
  } else if (cabin && (cabin.contains(e.x, e.z, 2.2) || cabin.contains(tx, tz, 1.8))) {
    const step = findCabinStep(cabin, e, { x: tx, z: tz }, true, Boolean(e.preferBreak));
    if (step.wall && !step.wall.broken && distance(e, step.wall) < 1.95) {
      e.breachWall = step.wall;
      e.breach += dt;
      e.yaw += clamp(angleDelta(Math.atan2(step.wall.x - e.x, e.z - step.wall.z), e.yaw), -dt * 6, dt * 6);
      if (e.breach >= 0.28) {
        breakWall(run, e, step.wall);
        e.breach = 0;
        e.breachWall = null;
      }
      e.moveSpeed = 0.2;
      return;
    }
    if (step.reachable) { destX = step.target.x; destZ = step.target.z; }
  }
  e.breach = Math.max(0, e.breach - dt * 2);

  const desired = Math.atan2(destX - e.x, e.z - destZ);
  let vx = Math.sin(desired), vz = -Math.cos(desired);
  for (const other of run.enemies) {
    if (other === e || other.dead || other.dormant) continue;
    const dx = e.x - other.x, dz = e.z - other.z, d = dx * dx + dz * dz;
    if (d > 0.001 && d < 0.98) {
      vx += dx * (0.98 - d) / Math.sqrt(d) * 1.15;
      vz += dz * (0.98 - d) / Math.sqrt(d) * 1.15;
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

  // Zombie chase speed stays between 1.5 and 2.5 mph (0.67-1.12 m/s) so the player can outrun them
  const baseChase = e.target?.chase ? Math.min(run.rules.speedLimit, cfg.chaseSpeed * run.rules.aggroScale) : cfg.speed;
  const speedTarget = (isBurst ? run.rules.speedLimit : baseChase * e.pace * stepPace * stumblePace)
    * (e.target ? 1 : 0.6) * (e.slow > 0 ? 0.58 : 1) * (e.stun > 0 ? 0.45 : 1) * (e.recover > 0.32 ? 0.35 : 1);
  const previous = e.moveSpeed;
  const targetSpeed = Math.min(run.rules.speedLimit, burst === 'BurstLoad' ? 0.22 : burst === 'Brake' ? speedTarget * 0.66 : speedTarget);
  const speed = e.moveSpeed += clamp(targetSpeed - e.moveSpeed, -dt * 5.6, dt * (e.kind === 'brute' ? 2.6 : 5.4));
  if (previous < 0.13 && speed >= 0.13) e.startAge = 0;

  const oldX = e.x, oldZ = e.z, radius = cfg.width * 0.83;
  for (const turn of [0, 0.59, -0.59, 1.15, -1.15, 1.72, -1.72, 2.22]) {
    const vector = direction(e.yaw + turn * e.turnSide);
    const probe = Math.max(0.68, speed * 0.44);
    if (world.blocks(e.x + vector.x * probe, e.z + vector.z * probe, radius + 0.06)) continue;
    world.move(e, vector.x * dt * speed, vector.z * dt * speed, radius);
    if (turn) e.yaw += clamp(turn * e.turnSide, -dt * look, dt * look);
    if (distance(e, { x: oldX, z: oldZ }) > 0.001) break;
  }

  const moved = Math.hypot(e.x - oldX, e.z - oldZ);
  e.stuck = moved < 0.001 ? e.stuck + dt : Math.max(0, e.stuck - dt * 3);
  if (e.stuck > 1.0) { e.turnSide *= -1; e.roam += 1.6; e.stuck = 0; }
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
  const { player: p, world, time } = run;
  syncActiveRoster(run);
  if (time >= run.nextSwarmTick) {
    flareAssignments(run);
    run.nextSwarmTick = time + 0.26;
  }
  if (time >= run.nextTacticsTick) {
    updateHordeTactics(run);
    run.nextTacticsTick = time + 0.34;
  }

  for (const e of run.enemies) {
    if (e.dead) continue;
    const gap = distance(e, p);

    if (time >= e.nextThink) {
      perception(run, e, gap, lamps);
      e.nextThink = time + (gap < 22 ? 0.18 : 0.42) + run.rng() * 0.08;
    }

    // Check if the player's flashlight is illuminating this monster
    const vitalPt = enemyVitalPoint(e);
    const torsoPt = eye(world, e, ENEMIES[e.kind].height * 0.58);
    const headPt = eye(world, e, ENEMIES[e.kind].height * 0.88);
    e.revealed = Boolean(lamps.length && lamps.some(lamp =>
      inBeam(world, lamp, vitalPt) || inBeam(world, lamp, torsoPt) || inBeam(world, lamp, headPt)));
    e.revealGlow = clamp(e.revealGlow + (e.revealed ? dt * 9 : -dt * 5), 0, 1);

    e.stun = Math.max(0, e.stun - dt);
    e.slow = Math.max(0, e.slow - dt);
    e.stumble = Math.max(0, e.stumble - dt);
    e.poseTime = time;
    Object.assign(e.previousTransform, { x: e.x, y: e.y, z: e.z, yaw: e.yaw });
    e.startAge += dt;
    e.hitAge += dt;
    e.turnRate = 0;

    if (e.dormant) {
      e.moveSpeed = 0;
      e.stride = 0;
      continue;
    }

    if (e.kind === 'shrieker' && e.attackAge === undefined) {
      const clear = e.target?.chase && gap > 2.4 && gap < 14 && world.clear(eye(world, e), eye(world, p));
      if (time >= e.nextBurst && clear) {
        e.burstStart = time + BURST_LOAD;
        e.burst = e.burstStart + BURST_RUN;
        e.brakeUntil = e.burst + BURST_BRAKE;
        e.nextBurst = e.brakeUntil + 2.8 + run.rng() * 2.2;
        enemyVoice(run, e, 'shriek');
      }
    }

    if (attack(run, e, gap, dt)) continue;
    const target = e.target;
    if (target) {
      const useTactic = target.chase && e.tactic && !isFlareTarget(e.reason);
      const navX = useTactic ? e.tactic.x : target.x;
      const navZ = useTactic ? e.tactic.z : target.z;
      e.route = { x: navX, z: navZ };
      navigate(run, e, navX, navZ, dt);
    } else {
      e.moveSpeed = 0;
      e.stride = 0;
    }
    voiceCadence(run, e, gap);
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
      const takeRounds = Math.min(need, p.equippedReserve);
      p.ammo += takeRounds;
      p.equippedReserve -= takeRounds;
      p.reload = null;
      emit(run, 'reloaded', { weapon: p.weapon, ammo: p.ammo });
    }
  }

  if (input.reload) startReload(run);
  if (input.cycleWeapon) cycleWeapon(run);
  inspectFlashlights(run, input);

  // Limited, upgradable battery tension
  const runtime = 30 + p.upgrades.battery * 8;
  const activeLight = p.flashlight && p.beam !== 'off' && !input.lampUnavailable;
  if (activeLight) {
    p.battery = Math.max(0, p.battery - dt / runtime);
    if (p.battery === 0) {
      p.flashlight = false;
      emit(run, 'light', { on: false, empty: true });
    }
  } else {
    p.battery = Math.min(1, p.battery + dt / 5);
  }

  const moveX = input.moveX || 0, moveZ = input.moveZ || 0;
  const length = Math.hypot(moveX, moveZ);
  const speed = input.walk ? 1.30 : 2.72;
  const oldX = p.x, oldZ = p.z;
  const dx = (length > 1 ? moveX / length : moveX) * speed * dt + (input.roomX || 0);
  const dz = (length > 1 ? moveZ / length : moveZ) * speed * dt + (input.roomZ || 0);
  if (dx || dz) world.move(p, dx, dz, 0.27);
  p.y = world.height(p.x, p.z);
  p.travelX = (p.x - oldX) / dt;
  p.travelZ = (p.z - oldZ) / dt;

  const moved = Math.hypot(p.x - oldX, p.z - oldZ);
  if (moved > 0.005) {
    p.stepTimer += moved;
    if (p.stepTimer >= 0.72) {
      p.stepTimer = 0;
      const running = moved / dt > 1.55;
      if (running) noise(run, 'footstep', p, 15, 0.55);
      emit(run, 'step', { x: p.x, y: p.y, z: p.z, running });
    }
  }

  // Track discovered cabins for the player's Map
  for (const site of CABIN_SITES) {
    if (!run.search.discovered.has(site.id) && Math.abs(p.x - site.x) <= site.halfW + 4 && Math.abs(p.z - site.z) <= site.halfD + 4) {
      run.search.discovered.add(site.id);
    }
  }
  if (!run.search.antennaReached && distance(p, ANTENNA) <= ANTENNA.radius + 4) {
    run.search.antennaReached = true;
  }

  if (Math.hypot(p.x - (run.lastChunkCheckX ?? -1e9), p.z - (run.lastChunkCheckZ ?? -1e9)) > 10) {
    run.lastChunkCheckX = p.x;
    run.lastChunkCheckZ = p.z;
    syncLoot(run);
  }

  if ((input.fire || (input.fireHeld && p.weapon === 'smg')) && !input.weaponUnavailable && input.aim) {
    shoot(run, input.aim);
  }

  // Antenna extraction interaction or loot pickup
  const antenna = reachableAntenna(run);
  takeLoot(run, input.interact && !antenna);
  if (antenna) {
    run.offer = antenna;
    if (input.interact) {
      if (antenna.ready) {
        run.status = 'escaped';
        emit(run, 'extraction', { ...antenna });
      } else {
        emit(run, 'dry', { reason: `Radio incomplete: ${antenna.collected}/${antenna.required} parts found` });
      }
    }
  }

  updateSignalFlares(run, dt);
  const head = eye(world, p, p.eyeHeight);
  run.beam = activeLight ? resolvePlayerBeam(run, input.lamp, head) : null;
  updateEnemies(run, dt, activeBeams(run));

  for (const corpse of run.corpses) corpse.fallAge = Math.min(1.5, corpse.fallAge + dt);
  return run.events;
}

export function inventorySnapshot(run) {
  const p = run.player;
  return {
    parts: run.search.parts.map(part => part.name),
    partsCollected: run.search.parts.length,
    partsRequired: PARTS_REQUIRED,
    allParts: RADIO_PARTS.map(part => ({
      id: part.id,
      name: part.name,
      collected: run.search.parts.some(c => c.id === part.id),
    })),
    weapons: Object.entries(p.magazines).map(([k, mag]) => ({
      key: k,
      name: GUNS[k].name,
      equipped: p.weapon === k,
      ammo: mag,
      capacity: GUNS[k].capacities[p.upgrades.capacity],
    })),
    reserve: p.reserve,
    flares: p.flares,
    armor: p.armor,
    upgrades: Object.entries(UPGRADES).map(([k, u]) => ({
      key: k,
      name: u.name,
      level: p.upgrades[k],
      cap: u.cap,
    })),
    discoveredCabins: run.search.discovered.size,
    totalCabins: CABIN_SITES.length,
  };
}
