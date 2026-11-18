import { ARENA_SIZES, DIFFICULTIES } from './difficulty.js';
import { ENEMIES, FLARE_BURN, FLARE_MAX_ACTIVE, GUNS, LOOT, UPGRADES, waveProfile } from './simulation.js';

function pickupSvg(kind, color) {
  switch (kind) {
    case 'ammo':
      return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#0e1114" stroke="${color}" stroke-width="2.5"/>
        <rect x="15" y="25" width="8" height="19" rx="1" fill="#c8a654"/><path d="M15 25 Q19 13 23 25 Z" fill="#d4824a"/>
        <rect x="28" y="21" width="8" height="23" rx="1" fill="#c8a654"/><path d="M28 21 Q32 8 36 21 Z" fill="#d4824a"/>
        <rect x="41" y="25" width="8" height="19" rx="1" fill="#c8a654"/><path d="M41 25 Q45 13 49 25 Z" fill="#d4824a"/></svg>`;
    case 'flareAmmo':
      return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#0e1114" stroke="${color}" stroke-width="2.5"/>
        <rect x="19" y="23" width="10" height="22" fill="#d94426"/><rect x="19" y="23" width="10" height="5" fill="#ff9d57"/><rect x="18" y="43" width="12" height="5" fill="#d8b25a"/>
        <rect x="35" y="23" width="10" height="22" fill="#d94426"/><rect x="35" y="23" width="10" height="5" fill="#ff9d57"/><rect x="34" y="43" width="12" height="5" fill="#d8b25a"/>
        <circle cx="32" cy="14" r="4" fill="#ffe29c"/></svg>`;
    case 'armor1':
      return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#0e1114" stroke="${color}" stroke-width="2.5"/>
        <path d="M21 16 H26 L32 23 L38 16 H43 L47 26 L44 30 L45 48 H19 L20 30 L17 26 Z" fill="#6f92ad" stroke="#c3ddf2" stroke-width="2"/>
        <rect x="23" y="28" width="18" height="6" fill="#c3ddf2" opacity="0.45"/></svg>`;
    case 'light':
      return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#0e1114" stroke="${color}" stroke-width="2.5"/>
        <rect x="13" y="28" width="16" height="8" fill="#5c7288"/><polygon points="29,26 34,23 34,41 29,38" fill="${color}"/>
        <polygon points="34,25 53,15 53,49 34,39" fill="#d2f0ff" opacity="0.55"/></svg>`;
    case 'damage':
      return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#0e1114" stroke="${color}" stroke-width="2.5"/>
        <polygon points="32,12 47,31 38,31 38,49 26,49 26,31 17,31" fill="${color}"/></svg>`;
    case 'pierce':
      return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#0e1114" stroke="${color}" stroke-width="2.5"/>
        <rect x="32" y="15" width="3" height="34" fill="#758290"/><rect x="40" y="15" width="3" height="34" fill="#758290"/>
        <polygon points="13,29 42,29 42,24 53,32 42,40 42,35 13,35" fill="${color}"/></svg>`;
    case 'reload':
      return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#0e1114" stroke="${color}" stroke-width="2.5"/>
        <path d="M46 28 A14 14 0 1 1 39 19" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round"/>
        <polygon points="49,26 42,33 38,22" fill="${color}"/></svg>`;
    case 'capacity':
      return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#0e1114" stroke="${color}" stroke-width="2.5"/>
        <rect x="21" y="16" width="22" height="33" fill="none" stroke="${color}" stroke-width="2.5"/>
        <rect x="25" y="20" width="14" height="4" fill="${color}"/><rect x="25" y="27" width="14" height="4" fill="${color}"/>
        <rect x="25" y="34" width="14" height="4" fill="${color}"/><rect x="25" y="41" width="14" height="4" fill="${color}"/></svg>`;
    case 'flaregun':
      return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#0e1114" stroke="${color}" stroke-width="2.5"/>
        <rect x="17" y="22" width="27" height="8" fill="${color}"/><polygon points="19,30 26,30 22,46 15,45" fill="${color}"/>
        <circle cx="47" cy="26" r="4.5" fill="#fff0a8"/></svg>`;
    case 'pistol':
      return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#0e1114" stroke="${color}" stroke-width="2.5"/>
        <polygon points="15,23 48,23 48,30 28,30 23,46 16,45 20,30 15,30" fill="${color}"/></svg>`;
    case 'shotgun':
      return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#0e1114" stroke="${color}" stroke-width="2.5"/>
        <rect x="13" y="25" width="37" height="5" fill="${color}"/><rect x="27" y="30" width="12" height="5" fill="#b47c48"/>
        <polygon points="13,28 22,28 19,39 10,38" fill="${color}"/></svg>`;
    case 'smg':
      return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#0e1114" stroke="${color}" stroke-width="2.5"/>
        <rect x="18" y="23" width="26" height="7" fill="${color}"/><rect x="44" y="25" width="7" height="3" fill="${color}"/>
        <rect x="31" y="30" width="5" height="14" fill="${color}"/><rect x="20" y="30" width="5" height="11" fill="${color}"/></svg>`;
    default:
      return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#0e1114" stroke="${color}" stroke-width="2.5"/>
        <rect x="17" y="24" width="34" height="5" fill="${color}"/><rect x="12" y="26" width="10" height="8" fill="${color}"/>
        <polygon points="32,29 37,29 39,43 34,43" fill="${color}"/></svg>`;
  }
}

export function renderHelpGuide(container) {
  if (!container || container.dataset.built) return;
  container.dataset.built = '1';

  const waveRows = Array.from({ length: 20 }, (_, idx) => {
    const p = waveProfile(idx + 1);
    const notes = idx === 0 ? 'Starter Pistol & Flare Gun · Shotgun reward after clear'
      : idx === 1 ? 'Brutes enter (3+ HS) · SMG reward after clear'
      : idx === 2 ? 'Carbine reward after clear'
      : idx === 4 ? 'Shamblers scale to 2 HS / 4 BS'
      : idx === 6 ? 'Shriekers scale to 2 HS / 4 BS'
      : idx === 8 ? 'Shamblers scale to 3 HS / 7 BS'
      : idx === 12 ? 'Shamblers 4 HS · Shriekers 3 HS'
      : idx === 16 ? 'Shamblers 5 HS · Heavy Brute waves'
      : idx === 19 ? 'Level 20 Milestone — Endless scaling continues'
      : `Max ${p.maxBurst}/burst · +${Math.round((p.speedScale - 1) * 100)}% speed`;
    return `<tr>
      <td><strong>Lv ${p.wave}</strong></td>
      <td>${p.total}</td>
      <td>${p.maxActive}</td>
      <td>${p.shotsToKill.shambler.head} HS / ${p.shotsToKill.shambler.body} BS</td>
      <td>${p.shotsToKill.shrieker.head} HS / ${p.shotsToKill.shrieker.body} BS</td>
      <td>${p.shotsToKill.brute.head} HS / ${p.shotsToKill.brute.body} BS</td>
      <td>+${Math.round((p.speedScale - 1) * 100)}%</td>
      <td>${notes}</td>
    </tr>`;
  }).join('');

  const itemsList = [
    { kind: 'ammo', label: LOOT.ammo.name, desc: 'Restores regular firearm reserve rounds (up to 180 in Labyrinth, 300 in Arena). Dropped by killed zombies and stocked in rooms.' },
    { kind: 'flareAmmo', label: LOOT.flareAmmo.name, desc: `Separate shell supply exclusively for the Flare Gun (up to ${FLARE_MAX_ACTIVE} burning at once for ${FLARE_BURN}s; silent — never attracts zombies).` },
    { kind: 'armor1', label: LOOT.armor1.name, desc: 'Absorbs one fatal zombie claw hit and grants brief recovery protection.' },
    { kind: 'light', label: UPGRADES.light.name, desc: `Max Lv ${UPGRADES.light.cap}. Extends flashlight reach by +22% and boosts beam lens intensity by +24% per level.` },
    { kind: 'damage', label: UPGRADES.damage.name, desc: `Max Lv ${UPGRADES.damage.cap}. +1 headshot damage per level (+1 body damage at Lv 2+) plus stronger hit stagger.` },
    { kind: 'pierce', label: UPGRADES.pierce.name, desc: `Max Lv ${UPGRADES.pierce.cap}. Rounds penetrate +1 extra lined-up zombie per level.` },
    { kind: 'reload', label: UPGRADES.reload.name, desc: `Max Lv ${UPGRADES.reload.cap}. Reloads 15% faster per level.` },
    { kind: 'capacity', label: UPGRADES.capacity.name, desc: `Max Lv ${UPGRADES.capacity.cap}. Increases loaded magazine capacity on all firearms.` },
    ...Object.entries(GUNS).map(([k, g]) => ({
      kind: k,
      label: g.name,
      desc: k === 'flaregun'
        ? `Launches silent glowing flares to illuminate dark corners without drawing zombies (max ${FLARE_MAX_ACTIVE} active).`
        : `${g.capacities[0]}→${g.capacities[3]} mag · ${g.rounds > 1 ? g.rounds + ' pellets/shot' : g.range + 'm effective range'}. Displayed as full 3D model on pickups.`,
    })),
  ].map(item => `<li>${pickupSvg(item.kind, LOOT[item.kind]?.color || '#d8d8c8')}<div><strong>${item.label}</strong><p>${item.desc}</p></div></li>`).join('');

  container.innerHTML = `
    <section class="help-section" id="help-layouts">
      <h3>Game Modes &amp; Map Size Diagrams</h3>
      <p><strong>The Last Night</strong> features two survival horror modes. Below are rough scale diagrams comparing the three <strong>Labyrinth Escape</strong> footprints (${Object.values(DIFFICULTIES).map(d => d.name).join(' / ')}) and the three <strong>Fight in Tight Space</strong> hexagonal arenas (${Object.values(ARENA_SIZES).map(a => `${a.name}`).join(' / ')}).</p>
      <div class="help-diagrams">
        <figure class="diagram-card">
          <svg viewBox="0 0 360 220" role="img" aria-label="Labyrinth Escape size comparison: 78m, 114m, and 156m square mazes">
            <rect width="360" height="220" fill="#0d1312"/>
            <!-- 156m outer reference -->
            <rect x="18" y="18" width="168" height="168" fill="#141e1c" stroke="#6f8772" stroke-width="1.5" stroke-dasharray="4 3"/>
            <!-- 114m middle reference -->
            <rect x="18" y="63" width="123" height="123" fill="#182422" stroke="#9db598" stroke-width="1.5"/>
            <!-- 78m standard maze with stylized chambers -->
            <rect x="18" y="102" width="84" height="84" fill="#1f2f2b" stroke="#dbe5c8" stroke-width="2"/>
            <path d="M18 130 H62 M40 102 V156 M62 126 V186 M80 102 V146" stroke="#7d9480" stroke-width="2" fill="none"/>
            <circle cx="30" cy="172" r="4" fill="#8ad88a"/><text x="38" y="175" fill="#bfe8bf" font-size="9" font-family="monospace">START</text>
            <rect x="96" y="108" width="10" height="14" fill="#e04338"/><text x="110" y="119" fill="#ff9e96" font-size="9" font-family="monospace">EXIT</text>
            <text x="114" y="34" fill="#90a592" font-size="10" font-family="monospace">Nightmare · 156×156 m</text>
            <text x="72" y="78" fill="#b4cbb0" font-size="10" font-family="monospace">Hard · 114×114 m</text>
            <text x="23" y="97" fill="#eef4df" font-size="10" font-family="monospace">Standard 78m</text>
            <!-- Details legend -->
            <g transform="translate(202,26)" font-family="monospace" font-size="10" fill="#cbd3c6">
              <text x="0" y="12" fill="#e8e2ce" font-weight="bold">LABYRINTH SPECS</text>
              <text x="0" y="34">• Ceilings: 4.5 m high</text>
              <text x="0" y="52">• Mix of 3.5 m halls</text>
              <text x="0" y="68">  &amp; multi-cell rooms</text>
              <text x="0" y="90">• Zombies wait inside</text>
              <text x="0" y="106">  hidden corners &amp;</text>
              <text x="0" y="122">  ambush doorways</text>
              <text x="0" y="144">• Goal: Reach 1 EXIT</text>
              <text x="0" y="164" fill="#9fb09e">Scale: 1 px ≈ 0.9 m</text>
            </g>
          </svg>
          <figcaption><strong>Labyrinth Escape Sizes</strong><span>Explore branching rooms &amp; halls (3.5 m grid), avoid floor hazards, upgrade gear, and breach the lit red EXIT door.</span></figcaption>
        </figure>
        <figure class="diagram-card">
          <svg viewBox="0 0 360 220" role="img" aria-label="Fight in Tight Space 6-sided shifting arena diagram showing 16m, 22m, and 30m sizes">
            <rect width="360" height="220" fill="#0d1312"/>
            <!-- 30m outer hex -->
            <polygon points="104,20 176,62 176,146 104,188 32,146 32,62" fill="#141e1c" stroke="#6f8772" stroke-width="1.5" stroke-dasharray="4 3"/>
            <!-- 22m mid hex -->
            <polygon points="104,42 157,73 157,135 104,166 51,135 51,73" fill="#192523" stroke="#9db598" stroke-width="1.5"/>
            <!-- 16m inner hex -->
            <polygon points="104,64 139,84 139,124 104,144 69,124 69,84" fill="#21312d" stroke="#dbe5c8" stroke-width="2"/>
            <!-- Shifting floor blocks inside arena -->
            <rect x="86" y="92" width="12" height="12" fill="#c79546" opacity="0.85"/>
            <rect x="110" y="104" width="12" height="12" fill="#c79546" opacity="0.85"/>
            <rect x="98" y="76" width="12" height="12" fill="#c79546" opacity="0.85"/>
            <!-- 6 entry doors -->
            <circle cx="104" cy="20" r="4" fill="#f0a838"/><circle cx="176" cy="104" r="4" fill="#f0a838"/>
            <circle cx="104" cy="188" r="4" fill="#f0a838"/><circle cx="32" cy="104" r="4" fill="#f0a838"/>
            <circle cx="140" cy="41" r="4" fill="#f0a838"/><circle cx="68" cy="167" r="4" fill="#f0a838"/>
            <circle cx="104" cy="104" r="3.5" fill="#8ad88a"/>
            <text x="104" y="206" text-anchor="middle" fill="#a9bba9" font-size="9.5" font-family="monospace">Outer 30m · Mid 22m · Inner 16m</text>
            <g transform="translate(200,26)" font-family="monospace" font-size="10" fill="#cbd3c6">
              <text x="0" y="12" fill="#e8e2ce" font-weight="bold">6-SIDED ARENA SPECS</text>
              <text x="0" y="34">• 6 hazard-marked doors</text>
              <text x="0" y="52">• Every 30 s floor cubes</text>
              <text x="0" y="68">  rumble &amp; rise floor-</text>
              <text x="0" y="84">  to-ceiling (path-safe)</text>
              <text x="0" y="106">• Zombies spawn in</text>
              <text x="0" y="122">  bursts behind you if</text>
              <text x="0" y="138">  you camp one door</text>
              <text x="0" y="160">• Max ${waveProfile(1).maxActive} in room at once</text>
            </g>
          </svg>
          <figcaption><strong>Fight in Tight Space Arena</strong><span>Survive endless rounds inside a shifting 6-door chamber. Collect new guns, ammo, flares &amp; upgrades between waves.</span></figcaption>
        </figure>
      </div>
    </section>

    <section class="help-section" id="help-combat">
      <h3>Zombie Damage, Hit Zones &amp; Smart Flanking</h3>
      <div class="help-diagrams">
        <figure class="diagram-card">
          <svg viewBox="0 0 360 190" role="img" aria-label="Zombie hit zones diagram">
            <rect width="360" height="190" fill="#0d1312"/>
            <!-- Stylized zombie figure -->
            <circle cx="66" cy="42" r="16" fill="#5e4942" stroke="#ffd27a" stroke-width="2.5"/>
            <rect x="46" y="62" width="40" height="58" rx="6" fill="#465249" stroke="#e26f66" stroke-width="2"/>
            <rect x="48" y="122" width="15" height="48" rx="4" fill="#3a453e" stroke="#8fb8cc" stroke-width="2"/>
            <rect x="69" y="122" width="15" height="48" rx="4" fill="#3a453e" stroke="#8fb8cc" stroke-width="2"/>
            <g transform="translate(115,28)" font-family="monospace" font-size="10.5">
              <text x="0" y="12" fill="#ffd27a" font-weight="bold">HEADSHOT (3× Damage on Regulars)</text>
              <text x="0" y="29" fill="#d0d7ca">Deals 3 dmg (2 dmg vs armored Brute).</text>
              <text x="0" y="45" fill="#d0d7ca">Killing headshots EXPLODE the head!</text>
              <text x="0" y="76" fill="#f0877f" font-weight="bold">BODY SHOT (1× Damage + Blood Spray)</text>
              <text x="0" y="93" fill="#d0d7ca">Shambler: ${ENEMIES.shambler.hp} HP · Shrieker: ${ENEMIES.shrieker.hp} HP · Brute: ${ENEMIES.brute.hp} HP.</text>
              <text x="0" y="109" fill="#d0d7ca">Every hit bursts visible crimson splatter.</text>
              <text x="0" y="138" fill="#9bc7dd" font-weight="bold">LEGS: Staggers &amp; slows movement by 42%.</text>
            </g>
          </svg>
          <figcaption><strong>Damage Rules &amp; Hot Loads</strong><span>Laser dot turns gold on vital headshots. Hot Loads adds +1 headshot dmg per level (+1 body dmg at Lv 2+).</span></figcaption>
        </figure>
        <figure class="diagram-card">
          <svg viewBox="0 0 360 190" role="img" aria-label="Smart Flanking AI diagram">
            <rect width="360" height="190" fill="#0d1312"/>
            <circle cx="95" cy="95" r="7" fill="#8ad88a"/>
            <!-- Flashlight cone -->
            <polygon points="95,95 45,30 145,30" fill="#fff0c8" opacity="0.14"/>
            <!-- Direct pursuers -->
            <circle cx="95" cy="42" r="6" fill="#e55e53"/><line x1="95" y1="48" x2="95" y2="85" stroke="#e55e53" stroke-width="1.8" stroke-dasharray="3 2"/>
            <!-- Flankers breaking out instead of queueing -->
            <circle cx="32" cy="58" r="6" fill="#ff9e55"/><path d="M32 64 Q26 112 85 98" fill="none" stroke="#ff9e55" stroke-width="1.8" stroke-dasharray="4 2"/>
            <circle cx="158" cy="58" r="6" fill="#ff9e55"/><path d="M158 64 Q165 118 104 100" fill="none" stroke="#ff9e55" stroke-width="1.8" stroke-dasharray="4 2"/>
            <circle cx="95" cy="156" r="6" fill="#ff9e55"/><line x1="95" y1="148" x2="95" y2="106" stroke="#ff9e55" stroke-width="1.8" stroke-dasharray="4 2"/>
            <g transform="translate(188,28)" font-family="monospace" font-size="10.2" fill="#d0d7ca">
              <text x="0" y="12" fill="#e8e2ce" font-weight="bold">PACK FLANKING &amp; AUDIO</text>
              <text x="0" y="34">• Direct sight: zombies</text>
              <text x="0" y="50">  cut straight diagonally</text>
              <text x="0" y="66">  instead of grid-stepping.</text>
              <text x="0" y="88">• 4+ zombies or conga</text>
              <text x="0" y="104">  lines split left, right</text>
              <text x="0" y="120">  &amp; behind to surround.</text>
              <text x="0" y="142">• 3D Audio highlights the</text>
              <text x="0" y="158">  4 closest active threats.</text>
            </g>
          </svg>
          <figcaption><strong>Thinking Zombie AI</strong><span>Instead of lining up single-file to get mowed down, trailing zombies break wide into flanking arcs around cover.</span></figcaption>
        </figure>
      </div>
    </section>

    <section class="help-section" id="help-inventory">
      <h3>Pickups, Weapons &amp; Upgrades</h3>
      <p>Pickups display visual icons above ground drops — and full <strong>rotating 3D gun models</strong> for weapons — so you can recognize supplies immediately inside your flashlight beam.</p>
      <ul class="help-items help-items-icons">${itemsList}</ul>
    </section>

    <section class="help-section" id="help-levels">
      <h3>Arena Progression: Levels 1–20 &amp; Infinite Scaling</h3>
      <p>To prevent overcrowding a small room, <strong>max simultaneous active zombies caps at ${waveProfile(1).maxActive}</strong> while total spawns climb up to ${waveProfile(20).total}. As you advance, zombie <strong>HP, headshot durability, speed, Shrieker/Brute frequency</strong> keep scaling <strong>infinitely</strong> (un-upgraded base gun values shown below):</p>
      <div class="help-table-wrap">
        <table class="records help-levels-table">
          <thead>
            <tr><th>Level</th><th>Total</th><th>In Room Max</th><th>Shambler (HS / BS)</th><th>Shrieker (HS / BS)</th><th>Brute (HS / BS)</th><th>Speed</th><th>Progression Notes</th></tr>
          </thead>
          <tbody>${waveRows}</tbody>
        </table>
      </div>
      <p class="note"><strong>Level 21+ Infinite Formula:</strong> Every wave past Lv 20 keeps 18 active cap (48 total per wave), adds <code>+0.72 Shambler HP</code>, <code>+0.55 Shrieker HP</code>, and <code>+1.15 Brute HP</code> every wave forever (e.g. Lv 25 Shambler = 19 HP / 7 headshots; Lv 30 = 22 HP / 8 headshots), while Brute chance scales to 32% and speed approaches +32%.</p>
    </section>
  `;
}
