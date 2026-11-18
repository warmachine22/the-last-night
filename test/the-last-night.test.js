import test from 'node:test';
import assert from 'node:assert/strict';
import { addEnemy, BUILD, createRun, enemyPose, shoot, STEP, stepRun, UPGRADES } from '../src/simulation.js';
import { DIFFICULTIES } from '../src/difficulty.js';
import { createLabyrinth } from '../src/labyrinth.js';

function advance(run, seconds, input = {}) {
  const steps = Math.round(seconds / STEP);
  const events = [];
  for (let i = 0; i < steps; i++) events.push(...stepRun(run, input, STEP));
  return events;
}

test('all three difficulty maze sizes (64m, 96m, 144m) generate fully connected rooms, hallways, hazards, and one exit', () => {
  assert.equal(BUILD, '2.0.1');
  for (const [key, spec] of Object.entries(DIFFICULTIES)) {
    const lab = createLabyrinth('seed-' + key, spec.mazeSize, spec.ammoScale);
    assert.equal(lab.sizeMeters, spec.mazeSize);
    assert.ok(lab.zones.length >= 12);
    assert.ok(lab.zones.every(z => z.distFromStart < Infinity), `${key} must be 100% connected from center start`);
    assert.ok(lab.exit && lab.exitZone.kind === 'exit');
    assert.ok(lab.hazards.some(h => h.kind === 'pebbles') && lab.hazards.some(h => h.kind === 'branches') && lab.hazards.some(h => h.kind === 'puddles'));

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

test('non-upgradable 30s flashlight works and dry-fire emits a weak spark', () => {
  assert.equal('battery' in UPGRADES, false);
  assert.equal('lens' in UPGRADES, false);

  const run = createRun('flashlight-check', { populate: false, difficulty: 'standard' });
  assert.equal(run.player.flashlight, true);

  const lamp = { origin: { x: run.player.x, y: run.player.y + 1.4, z: run.player.z }, ray: { x: 0, y: 0, z: -1 } };
  advance(run, 15, { lamp });
  assert.ok(run.player.battery > 0.45 && run.player.battery < 0.55);
  const ev = advance(run, 15.1, { lamp });
  assert.ok(ev.some(e => e.type === 'light' && e.empty));
  assert.equal(run.player.flashlight, false);
  advance(run, 5.1, {});
  assert.equal(run.player.battery, 1);

  run.player.ammo = 0;
  run.player.reserve = 0;
  const dryEv = stepRun(run, { fire: true, aim: lamp });
  assert.ok(dryEv.some(e => e.type === 'dry' && e.spark && e.range <= 4));
});

test('green spots are gone: 1 headshot kills regulars, 2-3 body shots kill regulars, brutes need 3 headshots or 6 body shots', () => {
  const run = createRun('damage-model', { populate: false, difficulty: 'hard' });
  const zoneId = run.world.labyrinth.startZone.id;
  const aimAt = point => ({
    origin: { x: run.player.x, y: point.y, z: run.player.z - 0.3 },
    ray: { x: point.x - run.player.x, y: 0, z: point.z - (run.player.z - 0.3) },
  });

  // 1) Regular shambler: 1 headshot = instant kill
  const sham1 = addEnemy(run, 'shambler', run.player.x, run.player.z - 2.1, { zoneId });
  assert.equal(sham1.vitalJoints, undefined);
  shoot(run, aimAt(enemyPose(sham1).head));
  assert.equal(sham1.dead, true, '1 headshot should instantly kill shambler');

  // 2) Regular shambler: 3 body shots
  const sham2 = addEnemy(run, 'shambler', run.player.x + 0.5, run.player.z - 2.1, { zoneId });
  for (let i = 0; i < 2; i++) {
    run.player.cooldown = 0;
    shoot(run, aimAt(enemyPose(sham2).torso));
    assert.equal(sham2.dead, false);
  }
  run.player.cooldown = 0;
  shoot(run, aimAt(enemyPose(sham2).torso));
  assert.equal(sham2.dead, true, '3 body shots should kill shambler');

  // 3) Regular shrieker: 2 body shots
  const shr1 = addEnemy(run, 'shrieker', run.player.x - 0.5, run.player.z - 2.1, { zoneId });
  run.player.cooldown = 0;
  shoot(run, aimAt(enemyPose(shr1).torso));
  assert.equal(shr1.dead, false);
  run.player.cooldown = 0;
  shoot(run, aimAt(enemyPose(shr1).torso));
  assert.equal(shr1.dead, true, '2 body shots should kill shrieker');

  // 4) Brute: 3 headshots
  const brute1 = addEnemy(run, 'brute', run.player.x, run.player.z + 2.0, { zoneId });
  const bruteAimHead = () => ({
    origin: { x: run.player.x, y: enemyPose(brute1).head.y, z: run.player.z + 0.3 },
    ray: { x: 0, y: 0, z: 1 },
  });
  for (let i = 0; i < 2; i++) {
    run.player.cooldown = 0;
    shoot(run, bruteAimHead());
    assert.equal(brute1.dead, false);
  }
  run.player.cooldown = 0;
  shoot(run, bruteAimHead());
  assert.equal(brute1.dead, true, '3 headshots should kill brute');

  // 5) Brute: 6 body shots
  const brute2 = addEnemy(run, 'brute', run.player.x + 1.0, run.player.z + 2.0, { zoneId });
  const bruteAimBody = () => ({
    origin: { x: run.player.x + 1.0, y: enemyPose(brute2).torso.y, z: run.player.z + 0.3 },
    ray: { x: 0, y: 0, z: 1 },
  });
  for (let i = 0; i < 5; i++) {
    run.player.cooldown = 0;
    run.player.ammo = 10;
    shoot(run, bruteAimBody());
    assert.equal(brute2.dead, false, `brute should survive ${i + 1} body shots`);
  }
  run.player.cooldown = 0;
  shoot(run, bruteAimBody());
  assert.equal(brute2.dead, true, '6 body shots should kill brute');
});

test('room-restricted zombies move up to 3 mph max, prowl slowly in dark, and never leave their room', () => {
  const run = createRun('zone-bound', { populate: true, difficulty: 'standard' });
  const lab = run.world.labyrinth;
  const targetRoom = lab.zones.find(z => z.kind === 'room' && z.doors.length > 0 && z.cells.length >= 6);
  assert.ok(targetRoom);

  const z = addEnemy(run, 'shrieker', targetRoom.center.x, targetRoom.center.z, { zoneId: targetRoom.id });
  const door = targetRoom.doors[0];
  run.player.x = door.x + (targetRoom.center.x < door.x ? 2.5 : -2.5);
  run.player.z = door.z + (targetRoom.center.z < door.z ? 2.5 : -2.5);
  z.memory = { x: run.player.x, z: run.player.z, score: 3, reason: 'gunshot', id: 'gun', chase: true, until: 20 };
  z.target = z.memory;

  let peakSpeed = 0;
  for (let i = 0; i < 300; i++) {
    stepRun(run, {});
    peakSpeed = Math.max(peakSpeed, z.moveSpeed);
    const at = lab.zoneAt(z.x, z.z);
    assert.equal(at?.id, targetRoom.id, `zombie crossed doorway out of zone ${targetRoom.id} into ${at?.id}`);
  }
  assert.ok(peakSpeed <= 1.35, `zombie exceeded 3.0 mph (1.34 m/s): ${peakSpeed.toFixed(3)}`);
});

test('ground hazards (pebbles, branches, puddles) alert room zombies and creeping quiets the radius', () => {
  const run = createRun('hazard-sound', { populate: false, difficulty: 'standard' });
  const lab = run.world.labyrinth;
  const haz = lab.hazards.find(h => h.zoneId !== lab.startZone.id) || lab.hazards[0];
  assert.ok(haz);
  const hzZone = lab.zones[haz.zoneId];

  const farSpot = hzZone.cells.map(([c, r]) => lab.cellCenter(c, r))
    .sort((a, b) => Math.hypot(b.x - haz.x, b.z - haz.z) - Math.hypot(a.x - haz.x, a.z - haz.z))[0];
  const z = addEnemy(run, 'shambler', farSpot.x, farSpot.z, { zoneId: haz.zoneId });

  run.player.x = haz.x - 0.1;
  run.player.z = haz.z;
  const evStep = stepRun(run, { moveX: 1, moveZ: 0, walk: false });
  assert.ok(evStep.some(e => e.type === 'hazardStep'));

  advance(run, 0.4, {});
  assert.equal(z.alerted, true);
});

test('entering the perimeter exit chamber escapes the labyrinth', () => {
  const run = createRun('exit-win', { populate: false, difficulty: 'standard' });
  const ex = run.world.exit;
  run.player.x = ex.x;
  run.player.z = ex.z;
  advance(run, 0.6, { moveX: ex.doorX - ex.x, moveZ: ex.doorZ - ex.z });
  assert.equal(run.status, 'escaped');
});
