import test from 'node:test';
import assert from 'node:assert/strict';
import { addEnemy, BUILD, createRun, enemyVitalPoints, shoot, STEP, stepRun } from '../src/simulation.js';
import { DIFFICULTIES } from '../src/difficulty.js';
import { createLabyrinth } from '../src/labyrinth.js';

function advance(run, seconds, input = {}) {
  const steps = Math.round(seconds / STEP);
  const events = [];
  for (let i = 0; i < steps; i++) events.push(...stepRun(run, input, STEP));
  return events;
}

test('all three difficulty maze sizes (64m, 96m, 144m) generate fully connected rooms, hallways, hazards, and one exit', () => {
  assert.equal(BUILD, '2.0.0');
  for (const [key, spec] of Object.entries(DIFFICULTIES)) {
    const lab = createLabyrinth('seed-' + key, spec.mazeSize, spec.ammoScale);
    assert.equal(lab.sizeMeters, spec.mazeSize);
    assert.ok(lab.zones.length >= 12, `${key} should generate interconnected zones`);
    assert.ok(lab.zones.every(z => z.distFromStart < Infinity), `${key} must be 100% connected from center start`);
    assert.ok(lab.exit && lab.exitZone.kind === 'exit', `${key} must have a perimeter exit chamber`);
    assert.ok(lab.hazards.some(h => h.kind === 'pebbles') && lab.hazards.some(h => h.kind === 'branches') && lab.hazards.some(h => h.kind === 'puddles'),
      `${key} must spawn pebbles, branches, and puddles`);

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

test('no flashlight exists; muzzle fire briefly exposes zombies while 0-ammo dry-fire spark does not', () => {
  const run = createRun('muzzle-light', { populate: false, difficulty: 'standard' });
  assert.equal(run.player.flashlight, false);

  const z = addEnemy(run, 'shambler', run.player.x, run.player.z - 2.2, {
    zoneId: run.world.labyrinth.startZone.id,
    vitalJoints: [2, 5],
  });
  const aim = {
    origin: { x: run.player.x, y: run.player.y + 1.4, z: run.player.z - 0.3 },
    ray: { x: 0, y: 0, z: -1 },
  };

  // First shot in dark illuminates the zombie and exposes its green dots briefly (~0.55s)
  const ev = stepRun(run, { fire: true, aim });
  assert.ok(ev.some(e => e.type === 'shot' && e.range === 20), 'shot must emit wide bright muzzle flash');
  assert.equal(z.revealed, true, 'zombie in flash cone/room must be revealed');

  // Darkness returns after the ~0.55 s illumination fade window
  advance(run, 0.7, {});
  assert.equal(z.revealed, false, 'zombie should return to dark once flash window expires');

  // Empty ammo dry-fire produces weak spark only and NEVER reveals zombie green dots
  run.player.ammo = 0;
  run.player.reserve = 0;
  run.player.cooldown = 0;
  const dryEv = stepRun(run, { fire: true, aim });
  const dry = dryEv.find(e => e.type === 'dry' && e.spark);
  assert.ok(dry && dry.range <= 4, 'empty weapon should emit weak dry-fire spark');
  assert.equal(z.revealed, false, 'dry-fire spark must not reveal zombie green dots');
});

test('1-3 green weak spots must all be destroyed while illuminated to kill a zombie', () => {
  const run = createRun('multi-dot', { populate: false, difficulty: 'hard' });
  const startZone = run.world.labyrinth.startZone;
  const z = addEnemy(run, 'brute', run.player.x, run.player.z - 2.1, {
    zoneId: startZone.id,
    vitalJoints: [2, 6, 12],
  });
  z.yaw = 0;
  stepRun(run, {});
  assert.equal(z.vitalJoints.length, 3);

  // Blind unlit shot directly at joint 2 cannot kill or pop a dot
  const pts0 = enemyVitalPoints(z);
  const aimDark = {
    origin: { x: run.player.x, y: pts0[0].point.y, z: run.player.z - 0.3 },
    ray: {
      x: pts0[0].point.x - run.player.x,
      y: 0,
      z: pts0[0].point.z - (run.player.z - 0.3),
    },
  };
  shoot(run, aimDark);
  assert.equal(z.dead, false);
  assert.equal(z.vitalJoints.filter(d => !d.destroyed).length, 3, 'unlit shot cannot destroy a green dot');
  assert.equal(z.revealed, true, 'that shot illuminated the zombie for follow-up shots');

  // Pop all 3 lit dots one by one
  for (let expectedLeft = 2; expectedLeft >= 0; expectedLeft--) {
    run.player.cooldown = 0;
    const activePts = enemyVitalPoints(z);
    const target = activePts[0].point;
    const origin = { x: run.player.x, y: target.y, z: run.player.z - 0.3 };
    const aim = {
      origin,
      ray: { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z },
    };
    shoot(run, aim);
    assert.equal(z.vitalJoints.filter(d => !d.destroyed).length, expectedLeft);
  }
  assert.equal(z.dead, true, 'zombie dies once all green dots are destroyed');
});

test('room-restricted zombies move up to 3 mph max, prowl slowly in dark, and never leave their room', () => {
  const run = createRun('zone-bound', { populate: true, difficulty: 'standard' });
  const lab = run.world.labyrinth;
  const targetRoom = lab.zones.find(z => z.kind === 'room' && z.doors.length > 0 && z.cells.length >= 6);
  assert.ok(targetRoom);

  const z = addEnemy(run, 'shrieker', targetRoom.center.x, targetRoom.center.z, { zoneId: targetRoom.id });
  const door = targetRoom.doors[0];
  // Put player right outside the room door and emit a gunshot to try to pull the zombie through the door
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

  // Place zombie inside the same zone as the hazard, 8 m away
  const farSpot = hzZone.cells.map(([c, r]) => lab.cellCenter(c, r))
    .sort((a, b) => Math.hypot(b.x - haz.x, b.z - haz.z) - Math.hypot(a.x - haz.x, a.z - haz.z))[0];
  const z = addEnemy(run, 'shambler', farSpot.x, farSpot.z, { zoneId: haz.zoneId });

  run.player.x = haz.x - 0.5;
  run.player.z = haz.z;
  const evWalk = stepRun(run, { moveX: 1, moveZ: 0, walk: true });
  // Step closer into hazard at normal speed
  run.player.x = haz.x - 0.1;
  run.player.z = haz.z;
  const evStep = stepRun(run, { moveX: 1, moveZ: 0, walk: false });
  const stepped = [...evWalk, ...evStep].find(e => e.type === 'hazardStep');
  assert.ok(stepped, 'stepping into floor hazard should emit hazardStep');

  advance(run, 0.4, {});
  assert.equal(z.alerted, true, 'same-zone zombie should react to ground hazard noise');
});

test('entering the perimeter exit chamber escapes the labyrinth', () => {
  const run = createRun('exit-win', { populate: false, difficulty: 'standard' });
  const ex = run.world.exit;
  run.player.x = ex.x;
  run.player.z = ex.z;
  const ev = stepRun(run, {
    moveX: (ex.doorX - ex.x) * 2,
    moveZ: (ex.doorZ - ex.z) * 2,
  });
  advance(run, 0.5, {
    moveX: ex.doorX - ex.x,
    moveZ: ex.doorZ - ex.z,
  });
  assert.equal(run.status, 'escaped');
  assert.ok(run.status === 'escaped' || ev.some(e => e.type === 'extraction'));
});
