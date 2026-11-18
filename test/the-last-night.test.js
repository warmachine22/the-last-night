import test from 'node:test';
import assert from 'node:assert/strict';
import { addEnemy, BUILD, createRun, ENEMIES, enemyPose, GUNS, shoot, STEP, stepRun, UPGRADES } from '../src/simulation.js';
import { DIFFICULTIES } from '../src/difficulty.js';
import { createLabyrinth, LABYRINTH_CELL, LABYRINTH_HEIGHT } from '../src/labyrinth.js';

function advance(run, seconds, input = {}) {
  const steps = Math.round(seconds / STEP);
  const events = [];
  for (let i = 0; i < steps; i++) events.push(...stepRun(run, input, STEP));
  return events;
}

test('all three difficulty maze sizes (78m, 114m, 156m) have high ceilings, mix of tight and big spaces, and one exit', () => {
  assert.equal(BUILD, '2.2.0');
  assert.ok(LABYRINTH_HEIGHT >= 4.0, `ceiling height should be tall (>=4.0m), got ${LABYRINTH_HEIGHT}`);
  assert.ok(LABYRINTH_CELL >= 3.0, `cell width should be wider (>=3.0m), got ${LABYRINTH_CELL}`);

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

test('non-upgradable 30s flashlight works, dry-fire sparks, spray can is removed, and zombies are 30% faster', () => {
  assert.equal('battery' in UPGRADES, false);
  assert.equal('lens' in UPGRADES, false);
  assert.equal('spraycan' in GUNS, false);

  assert.ok(ENEMIES.shambler.chaseSpeed >= 1.35 && ENEMIES.shrieker.chaseSpeed >= 1.70 && ENEMIES.brute.chaseSpeed >= 1.18);
  assert.ok(DIFFICULTIES.standard.speedLimit >= 1.50 && DIFFICULTIES.nightmare.speedLimit >= 1.70);

  const flRun = createRun('fl-mode', { populate: false, difficulty: 'standard' });
  assert.equal('spraycan' in flRun.player.magazines, false);
  assert.equal(flRun.player.flashlight, true);
  const lamp = { origin: { x: flRun.player.x, y: flRun.player.y + 1.4, z: flRun.player.z }, ray: { x: 0, y: 0, z: -1 } };
  advance(flRun, 15, { lamp });
  assert.ok(flRun.player.battery > 0.45 && flRun.player.battery < 0.55);
  advance(flRun, 15.1, { lamp });
  assert.equal(flRun.player.flashlight, false);
  advance(flRun, 5.1, {});
  assert.equal(flRun.player.battery, 1);

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
