import test from 'node:test';
import assert from 'node:assert/strict';
import { addEnemy, BUILD, createRun, ENEMIES, enemyPose, GUNS, resolvePlayerBeam, shoot, STEP, stepRun, UPGRADES } from '../src/simulation.js';
import { ARENA_SIZES, DIFFICULTIES } from '../src/difficulty.js';
import { createLabyrinth, LABYRINTH_CELL, LABYRINTH_HEIGHT } from '../src/labyrinth.js';
import { ARENA_HEIGHT } from '../src/arena.js';
import { CHUNK } from '../src/world.js';
import { MAX_ACTIVE_ZOMBIES } from '../src/horde.js';

function advance(run, seconds, input = {}) {
  const steps = Math.round(seconds / STEP);
  const events = [];
  for (let i = 0; i < steps; i++) events.push(...stepRun(run, input, STEP));
  return events;
}

test('all three difficulty maze sizes (78m, 114m, 156m) have high ceilings, mix of tight and big spaces, and one exit', () => {
  assert.equal(BUILD, '2.4.2');
  assert.equal(CHUNK, 24);
  assert.equal(MAX_ACTIVE_ZOMBIES, 18);
  assert.ok(LABYRINTH_HEIGHT >= 4.0, `ceiling height should be tall (>=4.0m), got ${LABYRINTH_HEIGHT}`);
  assert.ok(LABYRINTH_CELL >= 3.0, `cell width should be wider (>=3.0m), got ${LABYRINTH_CELL}`);

  const fullRun = createRun('perf-cap', { difficulty: 'nightmare', populate: true });
  assert.ok(fullRun.enemies.length <= MAX_ACTIVE_ZOMBIES, `active zombies must cap at ${MAX_ACTIVE_ZOMBIES}`);

  for (const [key, spec] of Object.entries(DIFFICULTIES)) {
    const lab = createLabyrinth('seed-' + key, spec.mazeSize, spec.ammoScale);
    assert.equal(lab.sizeMeters, spec.mazeSize);
    assert.ok(lab.zones.length >= 12);
    assert.ok(lab.zones.every(z => z.distFromStart < Infinity));
    assert.ok(lab.exit && lab.exitZone.kind === 'exit');
    assert.ok(lab.hazards.some(h => h.kind === 'pebbles') && lab.hazards.some(h => h.kind === 'branches') && lab.hazards.some(h => h.kind === 'puddles'));

    const roomWidths = lab.zones.filter(z => z.kind === 'room').map(z => z.bounds.maxX - z.bounds.minX);
    assert.ok(roomWidths.some(w => w <= 9.1), 'must include tight rooms/spaces');
    assert.ok(roomWidths.some(w => w >= 12.0), 'must include big open rooms (>= 12m wide)');

    const perRoomCounts = new Map();
    for (const s of lab.zombieSpawns) {
      if (lab.zones[s.zoneId].kind === 'room') {
        perRoomCounts.set(s.zoneId, (perRoomCounts.get(s.zoneId) || 0) + 1);
      }
    }
    for (const count of perRoomCounts.values()) {
      assert.ok(count >= 1 && count <= 5, `room zombies must stay between 1 and 5, got ${count}`);
    }
  }
});

test('infinite brighter narrow-cone flashlight works, dry-fire sparks, spray can is removed, and zombies are 30% faster', () => {
  assert.equal('battery' in UPGRADES, false);
  assert.equal('lens' in UPGRADES, false);
  assert.equal('spraycan' in GUNS, false);

  assert.ok(ENEMIES.shambler.chaseSpeed >= 1.35 && ENEMIES.shrieker.chaseSpeed >= 1.70 && ENEMIES.brute.chaseSpeed >= 1.18);
  assert.ok(DIFFICULTIES.standard.speedLimit >= 1.50 && DIFFICULTIES.nightmare.speedLimit >= 1.70);

  const flRun = createRun('fl-mode', { populate: false, difficulty: 'standard' });
  assert.equal('spraycan' in flRun.player.magazines, false);
  assert.equal(flRun.player.flashlight, true);
  assert.equal(flRun.player.beam, 'focus');
  const lamp = { origin: { x: flRun.player.x, y: flRun.player.y + 1.4, z: flRun.player.z }, ray: { x: 0, y: 0, z: -1 } };
  advance(flRun, 40, { lamp });
  assert.equal(flRun.player.battery, 1, 'flashlight must never run out of charge');
  assert.equal(flRun.player.flashlight, true);
  const focusBeam = resolvePlayerBeam(flRun, lamp, { x: flRun.player.x, y: flRun.player.y + 1.63, z: flRun.player.z });
  assert.ok(focusBeam.range >= 32 && focusBeam.angle <= 0.25 && focusBeam.powerScale > 1.1);

  flRun.player.ammo = 0;
  flRun.player.reserve = 0;
  const dryEv = stepRun(flRun, { fire: true, aim: lamp });
  assert.ok(dryEv.some(e => e.type === 'dry' && e.spark && e.range <= 4));
});

test('1 headshot kills regulars, 2-3 body shots kill regulars, brutes need 3 headshots or 6 body shots', () => {
  const run = createRun('damage-model', { populate: false, difficulty: 'hard' });
  const zoneId = run.world.labyrinth.startZone.id;
  const aimAt = point => ({
    origin: { x: run.player.x, y: point.y, z: run.player.z - 0.3 },
    ray: { x: point.x - run.player.x, y: 0, z: point.z - (run.player.z - 0.3) },
  });

  const sham1 = addEnemy(run, 'shambler', run.player.x, run.player.z - 2.1, { zoneId });
  shoot(run, aimAt(enemyPose(sham1).head));
  assert.equal(sham1.dead, true);

  const sham2 = addEnemy(run, 'shambler', run.player.x + 0.5, run.player.z - 2.1, { zoneId });
  for (let i = 0; i < 2; i++) { run.player.cooldown = 0; shoot(run, aimAt(enemyPose(sham2).torso)); assert.equal(sham2.dead, false); }
  run.player.cooldown = 0;
  shoot(run, aimAt(enemyPose(sham2).torso));
  assert.equal(sham2.dead, true);

  const shr1 = addEnemy(run, 'shrieker', run.player.x - 0.5, run.player.z - 2.1, { zoneId });
  run.player.cooldown = 0; shoot(run, aimAt(enemyPose(shr1).torso)); assert.equal(shr1.dead, false);
  run.player.cooldown = 0; shoot(run, aimAt(enemyPose(shr1).torso)); assert.equal(shr1.dead, true);

  const brute1 = addEnemy(run, 'brute', run.player.x, run.player.z + 2.0, { zoneId });
  const bruteHead = () => ({ origin: { x: run.player.x, y: enemyPose(brute1).head.y, z: run.player.z + 0.3 }, ray: { x: 0, y: 0, z: 1 } });
  for (let i = 0; i < 2; i++) { run.player.cooldown = 0; shoot(run, bruteHead()); assert.equal(brute1.dead, false); }
  run.player.cooldown = 0; shoot(run, bruteHead()); assert.equal(brute1.dead, true);

  const brute2 = addEnemy(run, 'brute', run.player.x + 1.0, run.player.z + 2.0, { zoneId });
  const bruteBody = () => ({ origin: { x: run.player.x + 1.0, y: enemyPose(brute2).torso.y, z: run.player.z + 0.3 }, ray: { x: 0, y: 0, z: 1 } });
  for (let i = 0; i < 5; i++) { run.player.cooldown = 0; run.player.ammo = 10; shoot(run, bruteBody()); assert.equal(brute2.dead, false); }
  run.player.cooldown = 0; shoot(run, bruteBody()); assert.equal(brute2.dead, true);
});

test('idle zombies wait hidden without wandering past doors, ambush from behind, chase briefly out, return home, and cap voices at <= 4', () => {
  const run = createRun('ambush-ai', { populate: false, difficulty: 'standard' });
  const lab = run.world.labyrinth;
  const room = lab.zones.find(z => z.kind === 'room' && z.doors.length > 0 && z.wallCells.length >= 2 && Math.hypot(z.wallCells[0].x, z.wallCells[0].z) < 22);
  assert.ok(room);

  // 1) Hidden idle zombies stay completely still at e.home instead of wandering past doorways
  const spot = room.wallCells[0];
  const ambusher = addEnemy(run, 'shrieker', spot.x, spot.z, { zoneId: room.id });
  advance(run, 2.0, {});
  assert.equal(ambusher.tactic?.role, 'ambushIdle');
  assert.equal(ambusher.moveSpeed, 0);
  assert.ok(Math.hypot(ambusher.x - spot.x, ambusher.z - spot.z) < 0.05, 'idle zombie must hold concealed corner');

  // 2) Walking past / turning back inside/near room doorway triggers rear ambush & short pursuit across doorway
  const door = room.doors[0];
  const ddx = door.x - spot.x, ddz = door.z - spot.z, dlen = Math.hypot(ddx, ddz) || 1;
  const stepDist = Math.min(2.8, dlen * 0.8);
  run.player.x = spot.x + (ddx / dlen) * stepDist;
  run.player.z = spot.z + (ddz / dlen) * stepDist;
  run.player.yaw = Math.atan2(ddx, -ddz); // facing away from ambusher!
  advance(run, 0.4, {});
  assert.equal(ambusher.alerted, true, 'passing zombie with back turned should trigger rear ambush');
  assert.equal(ambusher.reason, 'ambush');

  // Step player outside (> room corner distance, < MAX_TETHER_FROM_HOME) -> chases out briefly
  run.player.x = door.x + (door.x - room.center.x) * 0.45;
  run.player.z = door.z + (door.z - room.center.z) * 0.45;
  advance(run, 1.5, {});
  assert.ok(ambusher.tactic?.role === 'pursuit');

  // 3) Getting too far away causes zombie to break chase and return to e.home
  run.player.x = spot.x + 24;
  advance(run, 0.8, {});
  assert.equal(ambusher.tactic?.role, 'returning');

  // 4) Audio cap: even with 10 close alerted zombies, only <= 4 emit voices simultaneously
  const crowdRun = createRun('voice-cap', { populate: false, difficulty: 'standard' });
  const zList = [];
  for (let i = 0; i < 10; i++) {
    const z = addEnemy(crowdRun, 'shambler', crowdRun.player.x + (i % 3) * 0.5, crowdRun.player.z - 2.0 - Math.floor(i / 3) * 0.4, {
      zoneId: crowdRun.world.labyrinth.startZone.id,
    });
    z.alerted = true;
    z.nextVoice = 0;
    zList.push(z);
  }
  const ev = advance(crowdRun, 0.1, {});
  const voicedIds = new Set(ev.filter(e => e.type === 'voice').map(e => e.id));
  assert.ok(voicedIds.size <= 4, `at most 4 closest zombies may vocalize, got ${voicedIds.size}`);
});

test('ground hazards (pebbles, branches, puddles) alert room zombies and reaching exit wins', () => {
  const run = createRun('hazard-exit', { populate: false, difficulty: 'standard' });
  const lab = run.world.labyrinth;
  const haz = lab.hazards[0];
  assert.ok(haz);
  const z = addEnemy(run, 'shambler', haz.x + 1.5, haz.z, { zoneId: haz.zoneId });
  run.player.x = haz.x - 0.1;
  run.player.z = haz.z;
  const ev = stepRun(run, { moveX: 1, moveZ: 0, walk: false });
  assert.ok(ev.some(e => e.type === 'hazardStep'));
  advance(run, 0.35, {});
  assert.equal(z.alerted, true);

  const ex = run.world.exit;
  run.player.x = ex.x;
  run.player.z = ex.z;
  advance(run, 0.6, { moveX: ex.doorX - ex.x, moveZ: ex.doorZ - ex.z });
  assert.equal(run.status, 'escaped');
});

test('Fight in Tight Space mode builds a 6-sided 6-door arena with connected paths, reliable doorway pathfinding, and infinite bright narrow beam', () => {
  for (const [sizeKey, spec] of Object.entries(ARENA_SIZES)) {
    const arenaRun = createRun('arena-' + sizeKey, { mode: 'arena', arenaSize: sizeKey, populate: true });
    const arena = arenaRun.world.arena;
    assert.ok(arena);
    assert.equal(arena.faces.length, 6, 'arena must be 6-sided');
    assert.equal(arena.diameter, spec.diameter);

    // Every doorway alcove allows zombie movement into the 6-sided chamber & stays reachable
    for (const face of arena.faces) {
      assert.equal(arena.blocks(face.spawnX, face.spawnZ, 0.25, true), false, `doorway ${face.id} must be open for zombies`);
    }

    // Repeated 30s layout shifts must NEVER create a complete partition blocking player from any doorway or zombie
    for (let s = 0; s < 10; s++) {
      const occ = [
        { x: (s - 5) * 0.4, z: (s % 3 - 1) * 0.6, radius: 0.65 },
        { x: arena.faces[s % 6].entryX, z: arena.faces[s % 6].entryZ, radius: 0.55 },
      ];
      arena.shiftLayout(occ, false);
      const blockedSet = new Set(arena.tiles.filter(t => t.targetHeight > 0).map(t => t.id));
      const pTile = arena.tileAt(occ[0].x, occ[0].z) || arena.tiles[0];
      const reqTiles = arena.faces.map(f => arena.tileAt(f.entryX, f.entryZ));
      assert.equal(arena.allZonesConnected(blockedSet, pTile, reqTiles), true, `${sizeKey} shift ${s} partitioned arena!`);
    }

    // One standard bright infinite narrow beam across modes (no flashlight upgrade)
    const lampAim = { origin: { x: 0, y: 1.4, z: 0 }, ray: { x: 0, y: 0, z: -1 } };
    const arenaBeam = resolvePlayerBeam(arenaRun, lampAim, { x: 0, y: 1.63, z: 0 });
    assert.ok(arenaBeam.range >= 32 && arenaBeam.angle <= 0.25 && arenaBeam.powerScale >= 1.2);
    assert.equal('light' in UPGRADES, false);
    assert.ok(arenaRun.player.reserve >= 50, 'arena should start with generous reserve ammo');
  }

  // Test doorway pathfinding: spawn a zombie at EVERY one of the 6 doorway alcoves and verify it walks into the room to player
  const navRun = createRun('arena-nav', { mode: 'arena', arenaSize: 'medium', populate: false });
  const navZombies = navRun.world.arena.faces.map(face => {
    const z = addEnemy(navRun, 'shrieker', face.spawnX, face.spawnZ, { yaw: face.yaw, dormant: false });
    z.alerted = true;
    return z;
  });
  for (let i = 0; i < Math.round(14 / STEP); i++) {
    navRun.player.protection = 1;
    stepRun(navRun, {}, STEP);
  }
  for (const [idx, z] of navZombies.entries()) {
    const dist = Math.hypot(z.x - navRun.player.x, z.z - navRun.player.z);
    assert.ok(dist < 3.0, `zombie from doorway ${idx} failed to pathfind to player (ended ${dist.toFixed(1)}m away at ${z.x.toFixed(1)}, ${z.z.toFixed(1)})`);
  }

  // Test 5-zombie simultaneous burst inside one doorway (never wedges in doorway) + behind-player anti-camping spawns + 4-voice handoff
  const packRun = createRun('door-pack', { mode: 'arena', arenaSize: 'compact', populate: false });
  const face0 = packRun.world.arena.faces[0];
  const pack = [];
  for (let i = 0; i < 5; i++) {
    const z = addEnemy(packRun, i === 0 ? 'brute' : 'shrieker', face0.spawnX + face0.tx * (i - 2) * 0.14, face0.spawnZ, { yaw: face0.yaw, dormant: false });
    z.alerted = true;
    pack.push(z);
  }
  for (let i = 0; i < Math.round(6 / STEP); i++) {
    packRun.player.protection = 1;
    stepRun(packRun, {}, STEP);
  }
  for (const z of pack) {
    assert.ok(z.x * face0.nx + z.z * face0.nz < packRun.world.arena.apothem - 0.5, 'all 5 doorway zombies must clear the entranceway');
  }

  // Test closest-4 voice handoff when one of the top 4 is killed
  assert.equal(packRun.audibleIds.size, 4);
  const rankedBefore = [...packRun.enemies].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  const fifth = rankedBefore[4];
  assert.equal(packRun.audibleIds.has(fifth.id), false);
  rankedBefore[0].dead = true;
  const handoffEvents = advance(packRun, 0.25, {});
  assert.equal(packRun.audibleIds.has(fifth.id), true, '5th closest zombie must promote into top 4 audio slots on kill');
  assert.ok(handoffEvents.some(e => e.type === 'voice' && e.id === fifth.id), 'promoted zombie must start making sound promptly');

  // Test anti-camping: staring directly at doorway 0 spawns bursts behind the player after at most 2 front spawns
  const campRun = createRun('anti-camp', { mode: 'arena', arenaSize: 'medium', populate: true });
  const campFace = campRun.world.arena.faces[0];
  campRun.player.yaw = Math.atan2(campFace.cx, -campFace.cz); // stare straight at door 0
  campRun.wave.frontDoorSpawns = 2; // after player already caught 2 in front
  campRun.wave.lastFrontDoor = campFace.id;
  const campEvents = advance(campRun, 1.0, { yaw: campRun.player.yaw });
  const burstEvt = campEvents.find(e => e.type === 'doorBurst');
  assert.ok(burstEvt && burstEvt.doors.every(d => d !== campFace.id && d !== 1 && d !== 5), 'camping a doorway must force subsequent bursts behind player view');

  // Wave bursts spawn from 6 doors, clearing Wave 1 spawns rewards + Wave 2, and t=30s shifts unoccupied floor cubes
  const run = createRun('arena-shift', { mode: 'arena', arenaSize: 'compact', populate: true });
  const burstEvents = advance(run, 1.0, {});
  assert.ok(burstEvents.some(e => e.type === 'doorBurst') && run.enemies.length >= 1);

  let sawShift = false;
  for (let i = 0; i < Math.round(31 / STEP); i++) {
    run.player.protection = 1;
    const ev = stepRun(run, {}, STEP);
    if (ev.some(e => e.type === 'earthShift')) {
      sawShift = true;
      break;
    }
  }
  assert.equal(sawShift, true, 'arena floor cubes must shift at 30 seconds');
  for (let i = 0; i < Math.round(2.0 / STEP); i++) {
    run.player.protection = 1;
    stepRun(run, {}, STEP);
  }
  const raisedCount = run.world.arena.tiles.filter(t => t.height >= ARENA_HEIGHT * 0.9).length;
  assert.ok(raisedCount >= 2, `raised floor cubes should reach ceiling height, got ${raisedCount}`);
  assert.equal(run.world.blocks(run.player.x, run.player.z, 0.27), false, 'shifting floor must never trap the player');

  // Clear remaining wave enemies and verify abundant ammo + shotgun + gun upgrades spawn (no flashlight upgrade)
  run.wave.queue = [];
  for (const e of run.roster) e.dead = true;
  run.enemies = [];
  const clearEv = advance(run, 0.2, {});
  assert.ok(clearEv.some(e => e.type === 'waveClear'));
  assert.equal(run.loot.some(l => l.kind === 'light'), false, 'flashlight upgrade should not spawn');
  assert.ok(run.loot.filter(l => l.kind === 'ammo').length >= 3, 'multiple generous ammo pickups should spawn between waves');
  assert.ok(run.loot.some(l => l.kind in UPGRADES), 'gun upgrades should spawn between waves');
  assert.ok(run.loot.some(l => l.kind === 'shotgun'));
});
