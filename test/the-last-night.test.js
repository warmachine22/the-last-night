import test from 'node:test';
import assert from 'node:assert/strict';

import { CABIN_BLUEPRINTS, findCabinStep } from '../src/cabins.js';
import {
  addEnemy, createRun, enemyPose, enemyVitalPoint, inspectFlashlights,
  inventorySnapshot, shoot, STEP, stepRun,
} from '../src/simulation.js';
import { VITAL_JOINTS } from '../src/enemy-motion.js';
import { ANTENNA, CABIN_SITES, RADIO_PARTS } from '../src/map-layout.js';
import { INDOOR_TARGET, OUTDOOR_TARGET, ROSTER_TARGET } from '../src/horde.js';

function advance(run, seconds, input = {}) {
  const steps = Math.round(seconds / STEP);
  const events = [];
  for (let i = 0; i < steps; i++) events.push(...stepRun(run, input));
  return events;
}

test('20 unique single-floor cabins are distinct, valid, and player-reachable', () => {
  assert.equal(CABIN_BLUEPRINTS.length, 20);
  assert.equal(CABIN_SITES.length, 20);
  const names = new Set(CABIN_BLUEPRINTS.map(bp => bp.name));
  assert.equal(names.size, 20);

  const run = createRun('test-seed', { populate: false });
  assert.equal(run.world.cabins.length, 20);
  for (const cabin of run.world.cabins) {
    assert.ok(cabin.doors.length >= 1, `${cabin.name} has exterior door`);
    assert.ok(cabin.breakableWalls.length >= 3, `${cabin.name} has breakable ambush walls`);
    const doorCell = cabin.cellCenter(cabin.doors[0].c, cabin.doors[0].r);
    for (const spot of [...cabin.primarySpots, ...cabin.supplySpots]) {
      const step = findCabinStep(cabin, doorCell, spot, false);
      assert.ok(step.reachable, `${cabin.name} loot reachable without breaking walls`);
    }
  }
});

test('fixed 500-monster roster splits 250 indoor / 250 outdoor and persists across distance', () => {
  const run = createRun('roster-seed', { populate: true });
  assert.equal(run.roster.length, ROSTER_TARGET);
  const indoor = run.roster.filter(e => e.indoor).length;
  const outdoor = run.roster.filter(e => !e.indoor).length;
  assert.equal(indoor, INDOOR_TARGET);
  assert.equal(outdoor, OUTDOOR_TARGET);

  // Move far away and confirm roster stays 500 alive (slept as dormant, never deleted)
  const first = run.roster[0];
  run.player.x = -290;
  run.player.z = 290;
  advance(run, 0.5, { lamp: { origin: { x: -290, y: 1.4, z: 290 }, ray: { x: 0, y: 0, z: -1 } } });
  assert.equal(run.roster.filter(e => !e.dead).length, 500);
  assert.equal(first.dormant, true);
});

test('stealth: silent player in total darkness avoids detection and drops aggro over time', () => {
  const run = createRun('stealth-seed', { populate: false });
  run.player.flashlight = false;
  const monster = addEnemy(run, 'shambler', run.player.x, run.player.z - 5.5, { dormant: true });
  monster.nextThink = 0;

  // Standing still in darkness 5.5 m away keeps monster dormant
  advance(run, 1.5, {});
  assert.equal(monster.dormant, true);

  // Turning on flashlight beam directly on monster wakes and aggros it
  inspectFlashlights(run, { toggleLight: true });
  const lamp = { origin: { x: run.player.x, y: run.player.y + 1.4, z: run.player.z }, ray: { x: 0, y: 0, z: -1 } };
  advance(run, 0.4, { lamp });
  assert.equal(monster.dormant, false);
  assert.equal(monster.revealed, true);

  // Cut light, move far away quietly behind distance, and stay still -> aggro decays back to dormant
  inspectFlashlights(run, { toggleLight: true });
  run.player.x += 28;
  advance(run, 12.0, {});
  assert.equal(monster.dormant, true);
});

test('chasing zombies stay between 1.5 and 2.5 mph (0.67-1.12 m/s max)', () => {
  const run = createRun('speed-seed', { populate: false });
  const shrieker = addEnemy(run, 'shrieker', run.player.x, run.player.z - 8, { dormant: false });
  shrieker.nextThink = 0;
  const lamp = { origin: { x: run.player.x, y: run.player.y + 1.4, z: run.player.z }, ray: { x: 0, y: 0, z: -1 } };
  advance(run, 1.5, { lamp });
  assert.ok(shrieker.moveSpeed >= 0.67 && shrieker.moveSpeed <= 1.121,
    `expected speed in 0.67..1.12 m/s, got ${shrieker.moveSpeed.toFixed(2)}`);
});

test('two-step flashlight + randomized skeletal joint instant-kill rule', () => {
  const run = createRun('vital-seed', { populate: true });
  const jointsSeen = new Set(run.roster.map(e => e.vitalJoint));
  assert.ok(jointsSeen.size >= 12, `expected wide skeletal joint diversity, saw ${jointsSeen.size}`);
  for (const j of jointsSeen) assert.ok(VITAL_JOINTS.includes(j));

  // Test glitch-free hit on a knee joint (index 8) even while angled
  const monster = addEnemy(run, 'shambler', run.player.x, run.player.z - 5, {
    dormant: false,
    vitalJoint: 8,
  });
  monster.yaw = 0.6;

  // 1) Shoot vital joint in total darkness -> invulnerable, deflects
  run.player.flashlight = false;
  advance(run, 0.1, {});
  const pt = enemyVitalPoint(monster);
  const eye = { x: run.player.x, y: run.player.y + 1.4, z: run.player.z };
  shoot(run, { origin: eye, ray: { x: pt.x - eye.x, y: pt.y - eye.y, z: pt.z - eye.z } });
  assert.equal(monster.dead, false);
  assert.equal(run.metrics.deflects, 1);

  // 2) Turn flashlight on, illuminate monster, shoot NON-vital head -> still invulnerable
  run.player.flashlight = true;
  run.player.cooldown = 0;
  const lamp = { origin: eye, ray: { x: pt.x - eye.x, y: pt.y - eye.y, z: pt.z - eye.z } };
  advance(run, 0.1, { lamp });
  assert.equal(monster.revealed, true);
  const head = enemyPose(monster).head;
  shoot(run, { origin: eye, ray: { x: head.x - eye.x, y: head.y - eye.y, z: head.z - eye.z } });
  assert.equal(monster.dead, false);
  assert.equal(run.metrics.deflects, 2);

  // 3) Shoot the illuminated randomized skeletal joint (8) -> instant kill!
  run.player.cooldown = 0;
  const litVital = enemyVitalPoint(monster);
  shoot(run, { origin: eye, ray: { x: litVital.x - eye.x, y: litVital.y - eye.y, z: litVital.z - eye.z } });
  assert.equal(monster.dead, true);
});

test('zombies smash through breakable cabin walls to reach the player', () => {
  const run = createRun('breach-seed', { populate: false });
  const cabin = run.world.cabins[0];
  const bw = cabin.breakableWalls[0];
  const [c1, r1] = bw.cellA;
  const [c2, r2] = bw.cellB;
  const zSpot = cabin.cellCenter(c1, r1);
  const pSpot = cabin.cellCenter(c2, r2);

  run.player.x = pSpot.x;
  run.player.z = pSpot.z;
  run.player.y = run.world.height(pSpot.x, pSpot.z);

  const zombie = addEnemy(run, 'shambler', zSpot.x, zSpot.z, {
    dormant: false,
    indoor: true,
    cabinId: cabin.id,
  });
  zombie.memory = { x: pSpot.x, z: pSpot.z, score: 2, reason: 'saw player', id: 'player', chase: true, until: 20 };

  assert.equal(bw.broken, false);
  const events = advance(run, 1.5, {});
  assert.equal(bw.broken, true);
  assert.ok(events.some(e => e.type === 'wallBreak' && e.id === bw.id));
  assert.equal(run.world.blocks(bw.x, bw.z, 0.2), false);
});

test('inventory tracks all 6 radio parts and Antenna Tower requires all 6 to win', () => {
  const run = createRun('extract-seed', { populate: false });
  run.player.x = ANTENNA.x - 1.0;
  run.player.z = ANTENNA.z + 1.4;
  run.player.y = run.world.height(run.player.x, run.player.z);

  // Attempt extraction with 0 parts -> blocked
  stepRun(run, { interact: true });
  assert.equal(run.status, 'playing');

  // Collect all 6 radio parts across the map
  for (const part of RADIO_PARTS) {
    const item = run.loot.find(l => l.id === part.id) || { ...part, x: run.player.x, z: run.player.z, y: run.player.y, lost: false };
    item.x = run.player.x;
    item.z = run.player.z;
    item.y = run.player.y;
    if (!run.loot.includes(item)) run.loot.push(item);
    stepRun(run, {});
  }

  const snap = inventorySnapshot(run);
  assert.equal(snap.partsCollected, 6);
  assert.equal(snap.partsRequired, 6);

  // Now interact at Antenna Tower -> Escaped!
  stepRun(run, { interact: true });
  assert.equal(run.status, 'escaped');
});

test('flashlight battery remains limited and upgradable', () => {
  const run = createRun('battery-seed', { populate: false });
  const lamp = { origin: { x: run.player.x, y: run.player.y + 1.4, z: run.player.z }, ray: { x: 0, y: 0, z: -1 } };
  advance(run, 15, { lamp });
  assert.ok(run.player.battery < 0.55 && run.player.battery > 0.45);
  const events = advance(run, 15.1, { lamp });
  assert.ok(events.some(e => e.type === 'light' && e.empty));
  assert.equal(run.player.flashlight, false);
  advance(run, 5.1, {});
  assert.equal(run.player.battery, 1);

  // Upgrading Battery cells (+8 s) slows drain rate
  run.player.upgrades.battery = 1;
  run.player.flashlight = true;
  advance(run, 19, { lamp });
  assert.ok(run.player.battery > 0.45 && run.player.battery < 0.55);
});
