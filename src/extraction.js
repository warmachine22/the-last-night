import { ANTENNA, RADIO_PARTS } from './map-layout.js';
import { distance } from './world.js';

export const PARTS_REQUIRED = RADIO_PARTS.length;
export const RADIO_REPLY = 'Copy. Signal locked. Extraction team inbound.';

export function collectPart(run, item) {
  if (!item || item.kind !== 'radioPart') return false;
  if (run.search.parts.some(p => p.id === item.id)) return false;
  const meta = RADIO_PARTS.find(p => p.id === item.id) || { id: item.id, name: item.name || 'Radio Part' };
  run.search.parts.push({ id: meta.id, name: meta.name });
  run.search.assembled = run.search.parts.length >= PARTS_REQUIRED;
  return true;
}

export function reachableAntenna(run) {
  const p = run.player;
  const consolePos = { x: ANTENNA.x - 1.0, z: ANTENNA.z + 0.6, y: run.world.height(ANTENNA.x - 1.0, ANTENNA.z + 0.6) + 1.0 };
  if (distance(p, consolePos) > 2.2) return null;
  if (!run.world.clear({ x: p.x, y: p.y + p.eyeHeight * 0.85, z: p.z }, consolePos)) return null;
  return {
    id: 'antenna:console',
    kind: 'antenna',
    x: consolePos.x,
    y: consolePos.y,
    z: consolePos.z,
    ready: run.search.parts.length >= PARTS_REQUIRED,
    collected: run.search.parts.length,
    required: PARTS_REQUIRED,
  };
}
