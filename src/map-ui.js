import { ANTENNA, CABIN_SITES, ROAD_SEGMENTS, WORLD_MAX, WORLD_MIN } from './map-layout.js';
import { inventorySnapshot } from './simulation.js';

export function drawFieldMapAndInventory(ctx, width, height, run, hint = '', second = '') {
  const snap = inventorySnapshot(run);
  const p = run.player;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0e1615f2';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#738268';
  ctx.lineWidth = 3;
  ctx.strokeRect(14, 14, width - 28, height - 28);

  // Header
  ctx.fillStyle = '#b9c6a7';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('THE LAST NIGHT  /  FIELD MAP & INVENTORY', 34, 48);

  // Left: 672m x 672m Forest Map
  const mapSize = Math.min(height - 132, Math.floor(width * 0.48));
  const mx = 34, my = 66;
  ctx.fillStyle = '#0a1110';
  ctx.fillRect(mx, my, mapSize, mapSize);
  ctx.strokeStyle = '#3f5043';
  ctx.lineWidth = 2;
  ctx.strokeRect(mx, my, mapSize, mapSize);

  const span = WORLD_MAX - WORLD_MIN;
  const toX = wx => mx + ((wx - WORLD_MIN) / span) * mapSize;
  const toY = wz => my + ((wz - WORLD_MIN) / span) * mapSize;

  // Grid lines
  ctx.strokeStyle = '#182420';
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const gx = mx + (mapSize * i) / 6;
    const gy = my + (mapSize * i) / 6;
    ctx.beginPath(); ctx.moveTo(gx, my); ctx.lineTo(gx, my + mapSize); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx, gy); ctx.lineTo(mx + mapSize, gy); ctx.stroke();
  }

  // Roads
  ctx.strokeStyle = '#3d453b';
  ctx.lineWidth = 2.5;
  for (const [ax, az, bx, bz] of ROAD_SEGMENTS) {
    ctx.beginPath();
    ctx.moveTo(toX(ax), toY(az));
    ctx.lineTo(toX(bx), toY(bz));
    ctx.stroke();
  }

  // 20 Cabins
  for (const site of CABIN_SITES) {
    const cx = toX(site.x), cy = toY(site.z);
    const rw = Math.max(7, (site.halfW * 2 / span) * mapSize);
    const rd = Math.max(6, (site.halfD * 2 / span) * mapSize);
    const discovered = run.search.discovered.has(site.id);
    ctx.fillStyle = discovered ? '#b98f54' : '#4a554e';
    ctx.fillRect(cx - rw / 2, cy - rd / 2, rw, rd);
    ctx.strokeStyle = discovered ? '#eed49b' : '#738275';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx - rw / 2, cy - rd / 2, rw, rd);
  }

  // Antenna Tower Extraction Site
  const ax = toX(ANTENNA.x), ay = toY(ANTENNA.z);
  ctx.strokeStyle = snap.partsCollected >= snap.partsRequired ? '#6ff2a8' : '#74c6e8';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(ax, ay, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = snap.partsCollected >= snap.partsRequired ? '#6ff2a8' : '#74c6e8';
  ctx.beginPath();
  ctx.arc(ax, ay, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = 'bold 13px monospace';
  ctx.fillText('ANTENNA TOWER', ax + 11, ay + 4);

  // Player position & heading arrow
  const px = toX(p.x), py = toY(p.z);
  const fx = Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  ctx.fillStyle = '#f4ede0';
  ctx.beginPath();
  ctx.moveTo(px + fx * 9, py + fz * 9);
  ctx.lineTo(px - fx * 5 + fz * 5, py - fz * 5 - fx * 5);
  ctx.lineTo(px - fx * 5 - fz * 5, py - fz * 5 + fx * 5);
  ctx.closePath();
  ctx.fill();

  // Map legend
  ctx.font = '13px monospace';
  ctx.fillStyle = '#9aa896';
  ctx.fillText(`Cabins Visited: ${snap.discoveredCabins}/${snap.totalCabins}   ·   Monsters Alive: ${run.roster.filter(e => !e.dead).length}/${run.roster.length}`, mx, my + mapSize + 22);

  // Right: Inventory
  const ix = mx + mapSize + 34;
  let iy = 78;

  ctx.fillStyle = '#7ee6a8';
  ctx.font = 'bold 19px monospace';
  ctx.fillText(`RADIO PARTS  (${snap.partsCollected} / ${snap.partsRequired})`, ix, iy);
  iy += 24;
  ctx.font = '15px sans-serif';
  for (const part of snap.allParts) {
    ctx.fillStyle = part.collected ? '#d9f2df' : '#6f7c73';
    ctx.fillText(`${part.collected ? '[✓]' : '[ ]'}  ${part.name}`, ix, iy);
    iy += 21;
  }

  iy += 12;
  ctx.fillStyle = '#e7d59f';
  ctx.font = 'bold 18px monospace';
  ctx.fillText('WEAPONS & GEAR', ix, iy);
  iy += 22;
  ctx.font = '15px sans-serif';
  for (const w of snap.weapons) {
    ctx.fillStyle = w.equipped ? '#fff5dc' : '#a8b4a6';
    const reserve = w.key === 'flaregun' ? `${snap.flares} flares` : `${snap.reserve} res`;
    ctx.fillText(`${w.equipped ? '▶ ' : '  '}${w.name}: ${w.ammo}/${w.capacity} (${reserve})`, ix, iy);
    iy += 20;
  }
  ctx.fillStyle = '#9cb9ce';
  ctx.fillText(`Armor: ${'◆'.repeat(snap.armor)}${'◇'.repeat(3 - snap.armor)}   ·   Battery: ${Math.ceil(p.battery * 100)}%`, ix, iy + 2);
  iy += 28;

  ctx.fillStyle = '#a6c4d6';
  ctx.font = 'bold 17px monospace';
  ctx.fillText('UPGRADES', ix, iy);
  iy += 21;
  ctx.font = '14px sans-serif';
  for (const u of snap.upgrades) {
    ctx.fillStyle = u.level > 0 ? '#d8e6dc' : '#6c7971';
    ctx.fillText(`${u.name}: ${'●'.repeat(u.level)}${'○'.repeat(u.cap - u.level)}`, ix, iy);
    iy += 18;
  }

  if (hint) {
    ctx.fillStyle = '#bdcca0';
    ctx.font = 'bold 21px monospace';
    ctx.fillText(hint, 34, height - 38);
  }
  if (second) {
    ctx.fillStyle = '#92a38d';
    ctx.font = '16px monospace';
    ctx.fillText(second, width - 380, height - 38);
  }
}
