import { distance } from './world.js';

export const WAKE_RADIUS = 22;
export const SLEEP_RADIUS = 28;

// Populate every predetermined room (1-5 zombies) and hallway roamer from the labyrinth blueprint.
export function populateWorldRoster(run, createMonster) {
  const { labyrinth } = run.world;
  const roster = [];
  for (const spawn of labyrinth.zombieSpawns) {
    const monster = createMonster(run, spawn.kind, spawn.x, spawn.z, {
      zoneId: spawn.zoneId,
      yaw: spawn.yaw,
      dormant: true,
    });
    roster.push(monster);
  }
  run.roster = roster;
  run.counts = {
    total: roster.length,
    zones: labyrinth.zones.length,
  };
  syncActiveRoster(run);
}

// Stream and simulate only zombies closest to the player; distant zombies sleep cleanly in place.
export function syncActiveRoster(run) {
  const p = run.player;
  const active = [];
  for (const e of run.roster) {
    if (e.dead) continue;
    const d = distance(e, p);
    if (d <= WAKE_RADIUS || (!e.dormant && d <= SLEEP_RADIUS)) {
      active.push(e);
    } else {
      e.dormant = true;
      e.alerted = false;
      e.target = null;
      e.memory = null;
      e.reason = 'dormant';
    }
  }
  run.enemies = active;
}
