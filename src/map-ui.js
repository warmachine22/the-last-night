import { inventorySnapshot } from './simulation.js';

export function drawFieldMapAndInventory(ctx, width, height, run, hint = '', second = '') {
  const snap = inventorySnapshot(run);
  const mins = Math.floor(snap.time / 60);
  const secs = Math.floor(snap.time % 60);
  const clock = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0c1110f5';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#687662';
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  ctx.fillStyle = '#c2ccb2';
  ctx.font = 'bold 24px monospace';
  ctx.fillText('THE LAST NIGHT  /  SURVIVAL KIT', 44, 60);

  ctx.fillStyle = '#8b9c89';
  ctx.font = '18px monospace';
  const tag = snap.mode === 'arena' ? `WAVE ${snap.wave} · ${snap.difficulty.toUpperCase()}` : snap.difficulty.toUpperCase();
  ctx.fillText(`${tag}    ·    TIME: ${clock}    ·    KILLS: ${snap.kills}`, 44, 102);

  ctx.fillStyle = '#d8dfd0';
  ctx.font = 'bold 20px monospace';
  ctx.fillText('WEAPONS & GEAR', 44, 158);
  let y = 194;
  for (const w of snap.weapons) {
    ctx.fillStyle = w.equipped ? '#e8c47a' : '#96a595';
    ctx.font = (w.equipped ? 'bold ' : '') + '20px monospace';
    const qty = `${w.ammo}/${w.capacity} loaded`;
    ctx.fillText(`${w.equipped ? '▶ ' : '  '}${w.name.padEnd(18, ' ')}  ${qty}`, 44, y);
    y += 34;
  }

  y += 12;
  ctx.fillStyle = '#d8dfd0';
  ctx.font = 'bold 22px monospace';
  ctx.fillText(`RESERVE AMMO: ${snap.reserve} rounds   ·   FLARES: ${snap.flares}`, 44, y);
  ctx.fillText(`ARMOR PLATES: ${'◆'.repeat(snap.armor)}${'◇'.repeat(Math.max(0, 1 - snap.armor))}`, 44, y + 36);

  ctx.fillStyle = '#9aa89b';
  ctx.font = '17px monospace';
  const ups = snap.upgrades.filter(u => u.level > 0).map(u => `${u.name} Lv${u.level}`).join(' · ') || 'None yet';
  if (snap.mode === 'arena') {
    ctx.fillText(`Gun Upgrades: ${ups}`, 44, height - 108);
    ctx.fillText('Survive 6-door bursts and collect guns, ammo & gun upgrades between waves.', 44, height - 80);
  } else {
    ctx.fillText(`Gun Upgrades: ${ups}`, 44, height - 108);
    ctx.fillText('Find the single perimeter EXIT chamber while gathering ammo & gun upgrades.', 44, height - 80);
  }

  if (hint) {
    ctx.fillStyle = '#bdcca0';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(hint + (second ? '    ·    ' + second : ''), 44, height - 36);
  }
}
