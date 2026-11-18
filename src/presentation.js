import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { CHUNK, clamp, distance, random } from './world.js';
import { ENEMIES, GUNS, isSupply, LOOT, STEP } from './simulation.js';
import { LABYRINTH_DOOR_HEIGHT, LABYRINTH_HEIGHT } from './labyrinth.js';
import { ARENA_DOOR_HEIGHT, ARENA_DOOR_WIDTH, ARENA_HEIGHT } from './arena.js';
import { reloadMount } from './held-tools.js';
import { burstPhase, interpolateEnemyTransform, legacyEnemyMotion, solvedEnemyPose } from './enemy-motion.js';
import { beamTexture } from './night-lighting.js';

const textures = new THREE.TextureLoader();
const models = new GLTFLoader();
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const temp = new THREE.Object3D();
const baseBox = new THREE.BoxGeometry(1, 1, 1);
const pebbleGeo = new THREE.DodecahedronGeometry(0.09, 0);
const stickGeo = new THREE.CylinderGeometry(0.025, 0.032, 0.72, 5);
const puddleGeo = new THREE.CylinderGeometry(1, 1, 0.012, 16);
const laserColors = { head: 0xffcf65, armor: 0x9eb2c4, cover: 0xf3f7ff };

function image(name) {
  const tex = textures.load(new URL('./assets/art/' + name + '.webp', import.meta.url).href);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 2;
  return tex;
}

const stoneTex = image('stone');
const floorStoneTex = stoneTex.clone();
floorStoneTex.repeat.set(8, 8);
floorStoneTex.needsUpdate = true;
const wallStoneTex = stoneTex.clone();
wallStoneTex.repeat.set(2, 1.4);
wallStoneTex.needsUpdate = true;

const surfaces = {
  floor: new THREE.MeshStandardMaterial({ map: floorStoneTex, color: 0x4b4e50, roughness: 0.94 }),
  wall: new THREE.MeshStandardMaterial({ map: wallStoneTex, color: 0x626569, roughness: 0.92 }),
  ceiling: new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x2f3236, roughness: 0.96 }),
  pebbles: new THREE.MeshStandardMaterial({ map: stoneTex, color: 0x8d887e, roughness: 0.95, flatShading: true }),
  branches: new THREE.MeshStandardMaterial({ map: image('bark'), color: 0x6f553b, roughness: 0.96 }),
  puddles: new THREE.MeshStandardMaterial({ color: 0x1c2f3f, roughness: 0.14, metalness: 0.42 }),
  exitFrame: new THREE.MeshStandardMaterial({ color: 0x3b2220, roughness: 0.85 }),
};

const enemyModels = Object.keys(ENEMIES).flatMap(kind => [kind, kind + '-alt']);
const modelNames = [...Object.keys(GUNS), 'flashlight', 'glove', ...enemyModels];

function makeLamp(map = beamTexture()) {
  const lamp = new THREE.SpotLight(0xfff1d8, 0, 36, 0.21, 0.62, 1.3);
  lamp.map = map;
  lamp.castShadow = true;
  lamp.shadow.autoUpdate = false;
  lamp.shadow.mapSize.set(512, 512);
  lamp.shadow.camera.near = 0.06;
  lamp.shadow.camera.far = 48;
  lamp.shadow.bias = -0.00019;
  lamp.shadow.normalBias = 0.028;
  return lamp;
}

function shaftTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,244,218,0.85)');
  grad.addColorStop(0.28, 'rgba(255,232,190,0.42)');
  grad.addColorStop(0.72, 'rgba(255,216,162,0.12)');
  grad.addColorStop(1, 'rgba(255,204,142,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
export async function loadArt(legacyMotion = false) {
  const source = await Promise.all(modelNames.map(name =>
    models.loadAsync(new URL('./assets/art/' + name + '.glb', import.meta.url).href)));
  const art = Object.fromEntries(modelNames.map((name, i) => [name, source[i]]));
  if (legacyMotion) art.legacyShambler = await models.loadAsync(new URL('./assets/dev/shambler-before.glb', import.meta.url).href);
  return art;
}

function place(mesh, index, x, y, z, sx, sy, sz, angle, color, rotX = 0) {
  temp.position.set(x, y, z);
  temp.rotation.set(rotX, angle || 0, 0);
  temp.scale.set(sx, sy, sz);
  temp.updateMatrix();
  mesh.setMatrixAt(index, temp.matrix);
  if (color) mesh.setColorAt(index, color);
}

function instance(group, geo, mat, count, castShadow = false, receiveShadow = true) {
  if (!count) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  group.add(mesh);
  return mesh;
}

function radialTexture(hard = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (hard) {
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(.32, 'rgba(255,204,132,.86)');
    grad.addColorStop(.68, 'rgba(255,134,54,.27)');
    grad.addColorStop(1, 'rgba(255,112,34,0)');
  } else {
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(.27, 'rgba(255,255,255,.53)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function labelCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { ctx, texture };
}

function makeDoorSignTexture(labelText = 'BREACH') {
  const { ctx, texture } = labelCanvas(256, 80);
  ctx.fillStyle = '#181410';
  ctx.fillRect(0, 0, 256, 80);
  // Diagonal hazard stripes along left/right edges
  ctx.fillStyle = '#d49a2a';
  for (let x = -40; x < 280; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x + 12, 0); ctx.lineTo(x + 2, 16); ctx.lineTo(x - 10, 16); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, 64); ctx.lineTo(x + 12, 64); ctx.lineTo(x + 2, 80); ctx.lineTo(x - 10, 80); ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = '#d49a2a';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 18, 250, 44);
  ctx.fillStyle = '#f2c155';
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(labelText, 128, 49);
  texture.needsUpdate = true;
  return texture;
}

function makeThresholdTexture() {
  const { ctx, texture } = labelCanvas(256, 64);
  ctx.fillStyle = '#1e1c18';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#b98324';
  for (let x = -32; x < 280; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x + 15, 0); ctx.lineTo(x - 10, 64); ctx.lineTo(x - 25, 64); ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = '#6e4c19';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 252, 60);
  texture.needsUpdate = true;
  return texture;
}

function makeExitSignTexture() {
  const { ctx, texture } = labelCanvas(256, 96);
  ctx.fillStyle = '#1b0707';
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = '#aa2620';
  ctx.lineWidth = 6;
  ctx.strokeRect(5, 5, 246, 86);
  ctx.fillStyle = '#ff3b30';
  ctx.font = 'bold 58px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('EXIT', 128, 68);
  texture.needsUpdate = true;
  return texture;
}

function lootIcon(kind) {
  const { ctx, texture } = labelCanvas(128, 128);
  const color = LOOT[kind]?.color || '#d8d8c8';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 8;
  ctx.strokeRect(18, 18, 92, 92);
  ctx.font = 'bold 42px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(kind === 'ammo' ? 'AMMO' : kind.slice(0, 3).toUpperCase(), 64, 78);
  texture.needsUpdate = true;
  return texture;
}

function makeChunk(area, exitTex) {
  const group = new THREE.Group();
  const rng = random(area.key + ':lab');

  // 1) Interior Floor slab
  if (area.floor.w > 0 && area.floor.d > 0) {
    const floor = new THREE.Mesh(baseBox, surfaces.floor);
    floor.position.set(area.floor.x + area.floor.w / 2, -0.05, area.floor.z + area.floor.d / 2);
    floor.scale.set(area.floor.w, 0.1, area.floor.d);
    floor.receiveShadow = true;
    group.add(floor);
  }

  // 2) Enclosing Ceilings (no shadow receiving on ceiling saves mobile fragment work)
  const ceilMesh = instance(group, baseBox, surfaces.ceiling, area.ceilings.length, false, false);
  for (const [i, c] of area.ceilings.entries()) {
    place(ceilMesh, i, c.x, LABYRINTH_HEIGHT + 0.05, c.z, c.bw + 0.15, 0.1, c.bd + 0.15, 0);
  }
  ceilMesh?.computeBoundingSphere();

  // 3) Walls & Doorway Lintels
  const wallMesh = instance(group, baseBox, surfaces.wall, area.colliders.length, true, true);
  for (const [i, w] of area.colliders.entries()) {
    const shade = 0.85 + rng() * 0.22;
    const tint = new THREE.Color(w.tint ?? 0x626569).multiplyScalar(shade);
    place(wallMesh, i, w.x, w.y + w.height / 2, w.z, w.rx * 2, w.height, w.rz * 2, 0, tint);
  }
  wallMesh?.computeBoundingSphere();

  // 4) Ground Sound Hazards (pebbles, dry branches, puddles)
  const pebList = area.hazards.filter(h => h.kind === 'pebbles');
  const branchList = area.hazards.filter(h => h.kind === 'branches');
  const puddleList = area.hazards.filter(h => h.kind === 'puddles');

  if (pebList.length) {
    const pebbles = instance(group, pebbleGeo, surfaces.pebbles, pebList.length * 5, false, false);
    let idx = 0;
    for (const h of pebList) {
      for (let j = 0; j < 5; j++) {
        const a = h.turn + j * 1.26;
        const dist = (j === 0 ? 0.06 : 0.28 + (j % 2) * 0.18) * h.r;
        const sc = 0.65 + rng() * 0.55;
        const tone = 0.72 + rng() * 0.28;
        place(pebbles, idx++, h.x + Math.cos(a) * dist, 0.032, h.z + Math.sin(a) * dist,
          sc, sc * 0.58, sc * 1.15, a, new THREE.Color(tone, tone * 0.96, tone * 0.92));
      }
    }
    pebbles?.computeBoundingSphere();
  }

  if (branchList.length) {
    const branches = instance(group, stickGeo, surfaces.branches, branchList.length * 3, false, false);
    let idx = 0;
    for (const h of branchList) {
      for (let j = 0; j < 3; j++) {
        const a = h.turn + j * 1.04;
        const ox = Math.cos(a + 1.5) * 0.14 * (j - 1);
        const oz = Math.sin(a + 1.5) * 0.14 * (j - 1);
        place(branches, idx++, h.x + ox, 0.025, h.z + oz, 1, h.r * 1.35, 1, a,
          new THREE.Color(0.85, 0.78, 0.68), Math.PI / 2);
      }
    }
    branches?.computeBoundingSphere();
  }

  if (puddleList.length) {
    const puddles = instance(group, puddleGeo, surfaces.puddles, puddleList.length, false, true);
    for (const [i, h] of puddleList.entries()) {
      place(puddles, i, h.x, 0.008, h.z, h.r * 0.95, 1, h.r * 0.78, h.turn);
    }
    puddles?.computeBoundingSphere();
  }

  // 5) Single Perimeter Exit Door + Dim Red Exit Plaque (lit by persistent shared exitLight)
  if (area.exit) {
    const ex = area.exit;
    const panel = new THREE.Mesh(baseBox, surfaces.exitFrame);
    panel.position.set(ex.doorX - ex.nx * 0.06, LABYRINTH_DOOR_HEIGHT / 2, ex.doorZ - ex.nz * 0.06);
    panel.scale.set(ex.nx ? 0.14 : 1.35, LABYRINTH_DOOR_HEIGHT, ex.nz ? 0.14 : 1.35);
    group.add(panel);

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.76, 0.28),
      new THREE.MeshBasicMaterial({ map: exitTex, toneMapped: false, side: THREE.DoubleSide }),
    );
    sign.position.set(ex.doorX - ex.nx * 0.18, LABYRINTH_DOOR_HEIGHT + 0.28, ex.doorZ - ex.nz * 0.18);
    sign.rotation.y = Math.atan2(-ex.nx, -ex.nz);
    group.add(sign);
  }

  return group;
}

export function createPresentation(scene, art, layouts) {
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.055);
  const ambient = new THREE.HemisphereLight(0x283036, 0x101316, 0.015);
  scene.add(ambient);

  const exitTex = makeExitSignTexture();
  const doorSignMat = new THREE.MeshStandardMaterial({
    map: makeDoorSignTexture('ENTRY // DANGER'), roughness: 0.45, metalness: 0.25,
  });
  const thresholdMat = new THREE.MeshStandardMaterial({
    map: makeThresholdTexture(), roughness: 0.72, metalness: 0.12,
  });
  const doorFrameMat = new THREE.MeshStandardMaterial({
    color: 0x8d4c2d, roughness: 0.55, metalness: 0.35,
  });
  const flashPattern = beamTexture(true);
  const lamp = makeLamp();

  // Single unshadowed muzzle flash SpotLight + synchronized room bounce & persistent exit PointLight
  // Keeping only `lamp` shadow-casting eliminates dual shadow passes and light-count shader recompiles.
  const muzzle = new THREE.SpotLight(0xffcb8c, 0, 22, 1.05, 0.72, 1.35);
  muzzle.map = flashPattern;
  muzzle.castShadow = false;

  const muzzleBounce = new THREE.PointLight(0xffb470, 0, 12.5, 1.45);
  const exitLight = new THREE.PointLight(0xff2c22, 0, 5.2, 2);
  scene.add(lamp, lamp.target, muzzle, muzzle.target, muzzleBounce, exitLight);

  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 9, 6),
    new THREE.MeshBasicMaterial({ color: 0xf54a36, toneMapped: false, fog: false }));
  dot.visible = false;
  scene.add(dot);

  const attackerLabel = labelCanvas(256, 64);
  const label = attackerLabel.ctx;
  label.fillStyle = '#20251bed'; label.fillRect(0, 0, 256, 64);
  label.strokeStyle = '#d0ab73'; label.lineWidth = 4; label.strokeRect(2, 2, 252, 60);
  label.fillStyle = '#f5e0af'; label.font = 'bold 25px monospace'; label.textAlign = 'center';
  label.fillText('FATAL ATTACKER', 128, 41);
  attackerLabel.texture.needsUpdate = true;
  const attackerMarker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: attackerLabel.texture, toneMapped: false, transparent: true, depthWrite: false,
  }));
  attackerMarker.visible = false;
  scene.add(attackerMarker);

  const glow = radialTexture();
  const burst = radialTexture(true);
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({
    map: burst, color: 0xffcf87, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  spark.visible = false;
  const muzzleBloom = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: 0xffc682, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.48, toneMapped: false,
  }));
  muzzleBloom.visible = false;
  scene.add(spark, muzzleBloom);
  const flashState = { muzzle, bounce: muzzleBounce, spark, bloom: muzzleBloom, shot: null };

  // Lightweight volumetric light shaft & bloom sprites (lens glow + beam impact bloom)
  const shaftGeo = new THREE.CylinderGeometry(0.032, 1, 1, 18, 1, true);
  shaftGeo.translate(0, -0.5, 0);
  shaftGeo.rotateX(Math.PI / 2);
  const lampShaft = new THREE.Mesh(
    shaftGeo,
    new THREE.MeshBasicMaterial({
      map: shaftTexture(),
      color: 0xffe6bd,
      transparent: true,
      opacity: 0.09,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  lampShaft.visible = false;
  lampShaft.frustumCulled = false;
  const lampLensBloom = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: 0xfff0d2, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.42, toneMapped: false,
  }));
  lampLensBloom.visible = false;
  const lampSpotBloom = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: 0xffdfad, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.24, toneMapped: false,
  }));
  lampSpotBloom.visible = false;
  scene.add(lampShaft, lampLensBloom, lampSpotBloom);

  const weaponMount = new THREE.Group();
  const lampMount = new THREE.Group();
  const offhandMount = new THREE.Group();
  const weaponAnchor = new THREE.Group();
  const lampAnchor = new THREE.Group();
  const supportAnchor = new THREE.Group();
  scene.add(weaponAnchor, lampAnchor, supportAnchor);
  weaponAnchor.add(weaponMount);
  lampAnchor.add(lampMount);
  supportAnchor.add(offhandMount);

  function tool(name, mount) {
    const model = art[name].scene.clone();
    model.position.copy(layouts[name].offset);
    model.scale.setScalar(layouts[name].scale);
    mount.add(model);
    return model;
  }
  const gloveR = tool('glove', weaponMount);
  const gloveL = tool('glove', offhandMount);
  const flashlight = tool('flashlight', lampMount);
  const guns = Object.fromEntries(
    Object.keys(GUNS).map(w => [w, tool(w, weaponMount)]),
  );
  const firstPersonMats = new Map();
  for (const model of [gloveR, gloveL, flashlight, ...Object.values(guns)]) {
    model.traverse(node => {
      if (!node.isMesh) return;
      if (!firstPersonMats.has(node.material)) {
        const lit = node.material.clone();
        lit.emissive.copy(lit.color).multiplyScalar(0.06);
        firstPersonMats.set(node.material, lit);
      }
      node.material = firstPersonMats.get(node.material);
    });
  }

  const iconTextures = Object.fromEntries(Object.keys(LOOT).map(kind => [kind, lootIcon(kind)]));
  const chunks = new Map();
  const enemyMeshes = new Map();
  const pickups = new Map();
  const pool = Object.fromEntries(enemyModels.map(name => [name, []]));
  const effects = [];
  const effectGeometry = new THREE.TetrahedronGeometry(0.038);
  const effectMaterials = {
    body: new THREE.MeshStandardMaterial({ color: 0x267432 }),
    other: new THREE.MeshStandardMaterial({ color: 0xb09b7e }),
    armor: new THREE.MeshBasicMaterial({ color: 0xb4d8ff, toneMapped: false }),
    casing: new THREE.MeshStandardMaterial({ color: 0x988257, roughness: 0.4, metalness: 0.5 }),
  };

  const flashTuning = {
    pistol: { power: 520, bouncePower: 14, bounceRange: 11, size: 1.15, duration: 0.22 },
    shotgun: { power: 680, bouncePower: 18, bounceRange: 13.5, size: 1.45, duration: 0.24 },
    smg: { power: 360, bouncePower: 10, bounceRange: 9.5, size: 0.90, duration: 0.16 },
    carbine: { power: 580, bouncePower: 16, bounceRange: 12.5, size: 1.25, duration: 0.22 },
    dry: { power: 0, bouncePower: 4.2, bounceRange: 3.6, size: 0.36, duration: 0.12 },
  };

  const presentationState = { buzz: null };
  let impactPool = [];
  let quality = 3;
  let tone = '';
  let tick = 0;
  let currentRun = null;
  let artworkLit = null;
  let lastChunkKey = '';
  let pendingChunks = false;
  let shadowDirty = true;
  let arenaGroup = null;
  let pillarMesh = null;
  let lastArenaShiftVersion = -1;
  const lastLamp = { ox: 0, oy: 0, oz: 0, rx: 0, ry: 0, rz: 0, active: false, mode: '' };

  function makeArenaView(arena) {
    const group = new THREE.Group();
    const shape = new THREE.Shape();
    const hexR = arena.circumradius + 3.2;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const x = Math.cos(a) * hexR;
      const y = Math.sin(a) * hexR;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();

    const floorGeo = new THREE.ShapeGeometry(shape);
    const floor = new THREE.Mesh(floorGeo, surfaces.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    floor.userData.disposeGeometry = true;
    group.add(floor);

    const ceilGeo = new THREE.ShapeGeometry(shape);
    const ceil = new THREE.Mesh(ceilGeo, surfaces.ceiling);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = ARENA_HEIGHT;
    ceil.receiveShadow = false;
    ceil.userData.disposeGeometry = true;
    group.add(ceil);

    const wallMesh = instance(group, baseBox, surfaces.wall, arena.wallSegments.length, true, true);
    for (const [i, w] of arena.wallSegments.entries()) {
      place(wallMesh, i, w.x, w.y, w.z, w.w, w.h, w.d, w.angleY, new THREE.Color(w.tint));
    }
    wallMesh?.computeBoundingSphere();

    // Clearly mark all 6 zombie entrances with steel jamb trim, hazard threshold & overhead sign
    const trimMesh = instance(group, baseBox, doorFrameMat, arena.faces.length * 3, false, true);
    let trimIdx = 0;
    const doorSignGeo = new THREE.PlaneGeometry(1.75, 0.52);
    const threshGeo = new THREE.PlaneGeometry(ARENA_DOOR_WIDTH - 0.1, 0.72);
    for (const f of arena.faces) {
      const angleY = Math.atan2(-f.nx, -f.nz);
      const jambX = ARENA_DOOR_WIDTH / 2 + 0.08;
      place(trimMesh, trimIdx++, f.cx - f.tx * jambX - f.nx * 0.08, ARENA_DOOR_HEIGHT / 2, f.cz - f.tz * jambX - f.nz * 0.08,
        0.16, ARENA_DOOR_HEIGHT, 0.36, angleY);
      place(trimMesh, trimIdx++, f.cx + f.tx * jambX - f.nx * 0.08, ARENA_DOOR_HEIGHT / 2, f.cz + f.tz * jambX - f.nz * 0.08,
        0.16, ARENA_DOOR_HEIGHT, 0.36, angleY);
      place(trimMesh, trimIdx++, f.cx - f.nx * 0.08, ARENA_DOOR_HEIGHT + 0.07, f.cz - f.nz * 0.08,
        ARENA_DOOR_WIDTH + 0.32, 0.16, 0.36, angleY);

      const sign = new THREE.Mesh(doorSignGeo, doorSignMat);
      sign.position.set(f.cx - f.nx * 0.19, ARENA_DOOR_HEIGHT + 0.42, f.cz - f.nz * 0.19);
      sign.rotation.y = angleY;
      sign.receiveShadow = true;
      group.add(sign);

      const thresh = new THREE.Mesh(threshGeo, thresholdMat);
      thresh.position.set(f.cx - f.nx * 0.32, 0.012, f.cz - f.nz * 0.32);
      thresh.rotation.set(-Math.PI / 2, angleY, 0, 'YXZ');
      thresh.receiveShadow = true;
      group.add(thresh);
    }
    trimMesh?.computeBoundingSphere();

    pillarMesh = instance(group, baseBox, surfaces.wall, arena.raiseTiles.length, true, true);
    if (pillarMesh) {
      pillarMesh.frustumCulled = false;
      for (let i = 0; i < arena.raiseTiles.length; i++) {
        pillarMesh.setColorAt(i, new THREE.Color(0x45494e));
      }
    }
    scene.add(group);
    return group;
  }

  function syncArenaPillars(arena, run, force = false) {
    if (!pillarMesh) return;
    const ver = run.arenaShift?.version ?? 0;
    const moving = Boolean(run.arenaShift?.moving);
    if (!force && !moving && ver === lastArenaShiftVersion) return;
    lastArenaShiftVersion = ver;
    const pad = arena.cellSize * 0.94;
    for (let i = 0; i < arena.raiseTiles.length; i++) {
      const t = arena.raiseTiles[i];
      const h = t.height > 0.04 ? t.height : 0.04;
      const y = t.height > 0.04 ? h / 2 : -0.005;
      place(pillarMesh, i, t.x, y, t.z, pad, h, pad, 0);
    }
    pillarMesh.instanceMatrix.needsUpdate = true;
    shadowDirty = true;
  }

  function reset(run) {
    currentRun = run;
    lastChunkKey = '';
    pendingChunks = true;
    shadowDirty = true;
    lastArenaShiftVersion = -1;
    for (const group of chunks.values()) discardChunk(group);
    chunks.clear();
    if (arenaGroup) {
      discardChunk(arenaGroup);
      arenaGroup = null;
      pillarMesh = null;
    }
    for (const visual of enemyMeshes.values()) releaseEnemy(visual);
    enemyMeshes.clear();
    for (const view of pickups.values()) discardLoot(view);
    pickups.clear();
    for (const effect of effects.splice(0)) { effect.mesh.visible = false; impactPool.push(effect.mesh); }
    flashState.shot = null;
    const ex = run.world.exit;
    if (ex) {
      exitLight.position.set(ex.doorX - ex.nx * 0.45, LABYRINTH_DOOR_HEIGHT + 0.15, ex.doorZ - ex.nz * 0.45);
    }
    exitLight.intensity = 0;
    if (run.world.arena) {
      arenaGroup = makeArenaView(run.world.arena);
      syncArenaPillars(run.world.arena, run, true);
    }
  }

  function discardChunk(group) {
    group.traverse(node => {
      if (node.userData.disposeGeometry) node.geometry.dispose();
      if (node.isInstancedMesh) node.dispose();
    });
    group.removeFromParent();
  }

  function updateChunks(world, p) {
    const cx = Math.floor(p.x / CHUNK), cz = Math.floor(p.z / CHUNK);
    const keyNow = `${cx},${cz}`;
    if (keyNow === lastChunkKey && !pendingChunks) return;
    lastChunkKey = keyNow;

    const wanted = new Map();
    for (let z = cz - 1; z <= cz + 1; z++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        const key = `${x},${z}`;
        wanted.set(key, { x, z, key, d: Math.hypot((x + 0.5) * CHUNK - p.x, (z + 0.5) * CHUNK - p.z) });
      }
    }
    let changed = false;
    for (const [key, view] of chunks) {
      if (!wanted.has(key)) { discardChunk(view); chunks.delete(key); changed = true; }
    }
    const missing = [...wanted.values()].filter(w => !chunks.has(w.key)).sort((a, b) => a.d - b.d);
    const limit = chunks.size === 0 ? Math.min(4, missing.length) : 1;
    for (const w of missing.slice(0, limit)) {
      const area = world.chunk(w.x, w.z);
      const view = makeChunk(area, exitTex);
      scene.add(view);
      chunks.set(w.key, view);
      changed = true;
    }
    pendingChunks = missing.length > limit;
    if (changed) shadowDirty = true;
  }

  function borrowEnemy(kind, appearance) {
    const model = kind === 'shambler' && art.legacyShambler ? kind : appearance;
    const reused = pool[model].pop();
    if (reused) {
      reused.root.visible = true;
      reused.deadAt = -1;
      reused.age = 0;
      reused.poseSignature = null;
      return reused;
    }
    const source = kind === 'shambler' && art.legacyShambler ? art.legacyShambler : art[model];
    const root = new THREE.Group(), character = clone(source.scene);
    root.add(character);
    character.rotation.y = Math.PI;
    character.traverse(m => {
      if (!m.isMesh) return;
      if (m.isSkinnedMesh) m.boundingSphere = new THREE.Sphere(v3(0, 0.94, 0), 1.76);
      m.receiveShadow = true;
    });
    scene.add(root);
    const currentPose = source === art[model] ? solvedEnemyPose({ kind, gait: 0 }, ENEMIES[kind].windup) : null;
    const bones = currentPose?.rig.bones.map(name => character.getObjectByName(name));
    const targets = bones?.map(() => ({ position: new THREE.Vector3(), rotation: new THREE.Quaternion() }));
    const mixer = bones ? null : new THREE.AnimationMixer(character);
    const actions = {};
    if (mixer) {
      for (const clip of source.animations) {
        actions[clip.name] = mixer.clipAction(clip).play();
        actions[clip.name].setEffectiveWeight(clip.name === 'Walk' ? 1 : 0);
      }
    }
    return { root, character, bones, targets, mixer, model, actions, deadAt: -1, age: 0 };
  }

  function releaseEnemy(v) {
    v.root.visible = false;
    v.character.rotation.set(0, Math.PI, 0);
    v.character.position.set(0, 0, 0);
    pool[v.model].push(v);
  }

  function updateEnemies(run, dt, aimedIds, aims, alpha, frozen) {
    tick++;
    const desired = new Set();
    const corpses = run.corpses.filter(e => run.time - e.diedAt < 8).slice(-8);
    for (const e of [...run.enemies, ...corpses]) {
      if (distance(e, run.player) > 28) continue;
      desired.add(e.id);
      let v = enemyMeshes.get(e.id);
      if (!v) { v = borrowEnemy(e.kind, e.appearance ?? e.kind); enemyMeshes.set(e.id, v); }
      const d = distance(e, run.player), dead = e.diedAt !== undefined;
      v.root.rotation.y = -interpolateEnemyTransform(e, alpha, v.root.position);

      if (dead && !v.bones) {
        const time = run.time - e.diedAt, rate = e.kind === 'brute' ? 1.2 : e.kind === 'shrieker' ? 2.05 : 1.48;
        const slump = 1 - (1 - Math.min(1, time * rate)) ** 2;
        if (v.deadAt < 0) { v.deadAt = time; v.mixer.update(0); }
        v.character.rotation.set((e.id % 3 ? 1 : -1) * slump * 1.54, Math.PI,
          Math.sin(slump * 2.6) * (e.kind === 'shrieker' ? 0.51 : 0.13));
        v.character.position.y = Math.min(0.15, slump * 0.19) - clamp((time - 7) * 0.30, 0, 0.34);
        continue;
      }
      if (!v.bones) v.age += dt;
      const skip = d < 12 || (d < 22 && burstPhase(e)) || e.attackAge !== undefined || dead ? 1 : 2;
      const gun = GUNS[run.player.weapon];
      const initial = v.bones ? !v.poseSignature : v.age === dt;
      const sample = frozen || initial || (tick + e.id) % skip === 0 || aimedIds.includes(e.id) ||
        (d <= gun.range && aims.some(({ origin, ray }) =>
          (e.x - origin.x) * ray.x + (e.z - origin.z) * ray.z >= 0 &&
          Math.abs((e.x - origin.x) * ray.z - (e.z - origin.z) * ray.x) <= 1 + d * gun.spread));
      if (v.bones) {
        if (dead) {
          e.fallAge = Math.min(1.5, run.time - e.diedAt);
          v.character.position.y = -clamp((run.time - e.diedAt - 7) * 0.3, 0, 0.34);
        }
        if (sample) {
          const { joints, signature } = solvedEnemyPose(e, ENEMIES[e.kind].windup);
          if (v.poseSignature !== signature) {
            v.poseSignature = signature;
            for (const [i, target] of v.targets.entries()) {
              target.position.copy(joints[i].position);
              target.rotation.copy(joints[i].rotation);
            }
          }
        }
        const blend = frozen || initial ? 1 : 1 - Math.exp(-dt / (STEP * (skip > 1 ? 1.45 : 0.66)));
        for (const [i, bone] of v.bones.entries()) {
          bone.position.lerp(v.targets[i].position, blend);
          bone.quaternion.slerp(v.targets[i].rotation, blend);
        }
        continue;
      }
      if (!sample) continue;
      for (const [name, phase, weight] of legacyEnemyMotion(e, ENEMIES[e.kind].windup)) {
        const action = v.actions[name];
        if (!action) continue;
        action.setEffectiveWeight(weight);
        action.paused = true;
        action.time = phase * action.getClip().duration;
      }
      v.mixer?.update(v.age);
      v.age = 0;
    }
    for (const [id, v] of enemyMeshes) if (!desired.has(id)) { releaseEnemy(v); enemyMeshes.delete(id); }
  }

  function discardLoot(view) {
    view.group.removeFromParent();
    view.icon.material.dispose();
  }

  const lootSpot = v3(0, 0, 0);
  function coneReaches(world, from, ray, tx, ty, tz, range, cosAngle) {
    const dx = tx - from.x, dy = ty - from.y, dz = tz - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > range) return false;
    const along = dx * ray.x + dy * ray.y + dz * ray.z;
    if (along <= cosAngle * d) return false;
    lootSpot.set(tx, ty, tz);
    return world.clear(from, lootSpot);
  }

  function updateLoot(run, beam, flashLitIntensity) {
    const desired = new Set();
    const p = run.player;
    const flashBoost = flashLitIntensity > 0 ? clamp(flashLitIntensity / 3.5, 0, 1) : 0;
    const cosAngle = beam ? Math.cos(beam.angle) : 1;
    for (const item of run.loot) {
      const d = distance(item, p);
      if (item.lost || d > 22) continue;
      desired.add(item.id);
      let view = pickups.get(item.id);
      if (!view) {
        const group = new THREE.Group();
        const icon = new THREE.Sprite(new THREE.SpriteMaterial({
          map: iconTextures[item.kind], color: 0xffffff, depthWrite: false, transparent: true, toneMapped: false,
        }));
        group.add(icon);
        scene.add(group);
        group.position.set(item.x, item.y, item.z);
        view = { group, icon };
        pickups.set(item.id, view);
      }
      const distFade = clamp((18 - d) / 6, 0, 1);
      const beamLit = beam && coneReaches(run.world, beam.origin, beam.ray, item.x, item.y + 0.4, item.z, beam.range, cosAngle);
      const strength = Math.max(d < 1.8 ? 0.42 : 0, beamLit ? 0.85 : 0, flashBoost * (d < 12 ? 0.92 : 0)) * distFade;
      view.icon.visible = strength > 0.02;
      view.icon.material.opacity = strength;
      const scale = isSupply(item.kind) ? 0.28 : 0.48;
      view.icon.scale.set(scale, scale, 1);
      view.icon.position.y = 0.36;
    }
    for (const [id, view] of pickups) if (!desired.has(id)) { discardLoot(view); pickups.delete(id); }
  }

  function debris(event, weapon = '') {
    const amount = weapon ? 1 : quality > 1 ? 5 : 2;
    for (let i = 0; i < amount; i++) {
      if (effects.length > 60) return;
      const mesh = impactPool.pop() || new THREE.Mesh(effectGeometry);
      mesh.material = weapon ? effectMaterials.casing : effectMaterials[event.surface] || effectMaterials.other;
      mesh.scale.setScalar(weapon ? 0.52 : 0.95);
      mesh.position.set(event.x, event.y, event.z);
      mesh.visible = true;
      if (!mesh.parent) scene.add(mesh);
      const vx = (Math.random() - 0.5) * 2.4;
      const vz = (Math.random() - 0.5) * 2.4;
      effects.push({
        mesh,
        velocity: v3(weapon ? 1.5 : vx, 0.6 + Math.random() * 2.0, vz),
        age: weapon ? 0.75 : 0.16 + Math.random() * 0.20,
      });
    }
  }

  function events(batch) {
    for (const event of batch) {
      if (event.type === 'shot') {
        flashState.shot = { ...event, elapsed: 0, fresh: true };
        if (quality > 1) debris({ x: event.x, y: event.y, z: event.z }, event.weapon);
      } else if (event.type === 'dry' && event.spark) {
        flashState.shot = { ...event, weapon: 'dry', blocked: false, elapsed: 0, fresh: true };
      } else if (event.type === 'impact' || event.type === 'dotHit') {
        debris(event);
      } else if (event.type === 'deflect') {
        debris({ ...event, surface: 'armor' });
      }
    }
  }

  function updateTools(run, dt, settings, tracking, active, inspecting, stereo, calibration, beam) {
    const p = run.player, gun = guns[p.weapon];
    const showHands = active || inspecting;
    for (const [k, m] of Object.entries(guns)) m.visible = k === p.weapon;
    weaponAnchor.visible = (showHands || calibration) && !!tracking.weapon;
    lampAnchor.visible = showHands && !!tracking.lamp;
    const hand = tracking.support || tracking.lamp;
    supportAnchor.visible = showHands && !!hand;
    if (tracking.weapon) {
      weaponAnchor.position.copy(tracking.weapon.position);
      weaponAnchor.quaternion.copy(tracking.weapon.quaternion);
    }
    if (tracking.lamp) {
      lampAnchor.position.copy(tracking.lamp.position);
      lampAnchor.quaternion.copy(tracking.lamp.quaternion);
    }
    if (hand) {
      supportAnchor.position.copy(hand.position);
      supportAnchor.quaternion.copy(hand.quaternion);
    }
    const left = settings.leftHanded;
    gloveR.scale.x = left ? -1 : 1;
    gloveL.scale.x = left ? 1 : -1;
    const { progress: showReload, dip, y, pitch, roll } = reloadMount(!calibration && p.reload, left);
    const free = 1 - (tracking.brace ?? 0);
    weaponMount.rotation.set(pitch * free, 0, roll * free);
    weaponMount.position.y = y * free;
    const slide = gun.getObjectByName('Slide'), mag = gun.getObjectByName('Magazine'), pump = gun.getObjectByName('Pump');
    if (slide) slide.position.z = (tracking.gunKick || 0) * 1.35 + (showReload > 0.72 && showReload < 0.91 ? 0.019 : 0);
    if (mag) {
      mag.position.y = dip * (p.weapon === 'smg' || p.weapon === 'carbine' ? -0.16 : -0.10);
      mag.visible = p.weapon !== 'shotgun' || dip > 0.13;
    }
    if (pump) pump.position.z = tracking.pumpTravel;
    const breech = gun.getObjectByName('Breech');
    if (breech) breech.rotation.x = -1.03 * dip;
    updateFlash(flashState, currentRun.world, dt, settings, active);
    const power = 0.72 + 0.28 * clamp(p.battery / 0.16, 0, 1);
    updateLamp(lamp, beam, power, currentRun.world);
    const litByLamp = lamp.intensity > 0 || calibration;
    if (artworkLit !== litByLamp) {
      artworkLit = litByLamp;
      for (const mat of firstPersonMats.values()) mat.emissiveIntensity = litByLamp ? 0.85 : 0.08;
    }
  }

  function updateLamp(light, beam, power, world) {
    if (!beam) {
      light.intensity = 0;
      lastLamp.active = false;
      lampShaft.visible = false;
      lampLensBloom.visible = false;
      lampSpotBloom.visible = false;
      return;
    }
    const ox = beam.origin.x, oy = beam.origin.y, oz = beam.origin.z;
    const rx = beam.ray.x, ry = beam.ray.y, rz = beam.ray.z;
    const focus = beam.mode === 'focus';
    const scale = beam.powerScale ?? 1;
    light.position.set(ox, oy, oz);
    light.target.position.set(ox + rx, oy + ry, oz + rz);
    light.angle = beam.angle;
    light.distance = beam.range;
    light.intensity = (focus ? 760 : 440) * power * scale;
    const moved = !lastLamp.active || lastLamp.mode !== beam.mode || shadowDirty
      || Math.abs(ox - lastLamp.ox) + Math.abs(oy - lastLamp.oy) + Math.abs(oz - lastLamp.oz) > 0.015
      || Math.abs(rx - lastLamp.rx) + Math.abs(ry - lastLamp.ry) + Math.abs(rz - lastLamp.rz) > 0.008;
    if (moved && (quality > 1 || tick % 2 === 0)) {
      light.shadow.needsUpdate = true;
      shadowDirty = false;
      lastLamp.ox = ox; lastLamp.oy = oy; lastLamp.oz = oz;
      lastLamp.rx = rx; lastLamp.ry = ry; lastLamp.rz = rz;
      lastLamp.active = true;
      lastLamp.mode = beam.mode;
    }

    // Volumetric shaft + lens & hotspot bloom scaled cleanly to hit surface distance
    const hit = world.raycast(beam.origin, beam.ray, beam.range, true);
    const hitDist = hit ? Math.max(0.35, hit.t) : beam.range * 0.85;
    const coneDist = Math.min(hitDist, focus ? 18 : 11);
    const coneRadius = Math.tan(beam.angle) * coneDist * 0.72;
    lampShaft.position.set(ox + rx * 0.05, oy + ry * 0.05, oz + rz * 0.05);
    lampShaft.lookAt(ox + rx * 10, oy + ry * 10, oz + rz * 10);
    lampShaft.scale.set(coneRadius, coneRadius, coneDist);
    lampShaft.material.opacity = clamp((focus ? 0.11 : 0.06) * scale * power, 0.03, 0.16);
    lampShaft.visible = true;

    lampLensBloom.position.set(ox + rx * 0.04, oy + ry * 0.04, oz + rz * 0.04);
    const lensSize = (focus ? 0.42 : 0.34) * clamp(scale, 0.7, 1.35);
    lampLensBloom.scale.set(lensSize, lensSize, 1);
    lampLensBloom.material.opacity = clamp((focus ? 0.48 : 0.34) * power, 0.15, 0.6);
    lampLensBloom.visible = true;

    if (hit && hit.t <= beam.range) {
      const pull = Math.max(0.2, hit.t - 0.25);
      lampSpotBloom.position.set(ox + rx * pull, oy + ry * pull, oz + rz * pull);
      const spotSize = clamp(0.85 + hit.t * Math.tan(beam.angle) * 0.75, 0.9, 5.2);
      lampSpotBloom.scale.set(spotSize, spotSize, 1);
      const fade = clamp(1 - hit.t / (beam.range * 1.1), 0.12, 1);
      lampSpotBloom.material.opacity = clamp((focus ? 0.30 : 0.18) * fade * scale * power, 0.04, 0.42);
      lampSpotBloom.visible = true;
    } else {
      lampSpotBloom.visible = false;
    }
  }

  function updateFlash(flash, world, dt, settings, active) {
    const { muzzle, bounce, spark, bloom, shot } = flash;
    muzzle.intensity = 0;
    bounce.intensity = 0;
    spark.visible = false;
    bloom.visible = false;
    if (!active || !shot) { flash.shot = null; return; }
    const tuning = flashTuning[shot.weapon] || flashTuning.pistol;
    if (shot.elapsed >= tuning.duration) { flash.shot = null; return; }
    const o = v3(shot.x, shot.y, shot.z), ray = v3(shot.ray.x, shot.ray.y, shot.ray.z);
    if (shot.fresh && !shot.blocked) {
      const range = shot.range || 20;
      const cover = world.raycast(o, ray, range);
      muzzle.distance = cover ? Math.max(0.25, cover.t + 0.25) : range;
      muzzle.position.copy(o);
      muzzle.target.position.copy(o).add(ray);
      if (muzzle.castShadow && tuning.power > 0) muzzle.shadow.needsUpdate = true;
      const bounceOffset = cover ? Math.min(0.6, cover.t * 0.45) : 0.45;
      bounce.position.copy(o).addScaledVector(ray, bounceOffset);
      bounce.distance = tuning.bounceRange;
    }
    const fade = Math.max(0, 1 - shot.elapsed / tuning.duration);
    const reduced = settings.reducedFlashes ? 0.32 : 1;
    muzzle.intensity = shot.blocked ? 0 : tuning.power * fade ** 1.35 * reduced;
    bounce.intensity = shot.blocked ? 0 : tuning.bouncePower * fade ** 1.45 * reduced;
    bounce.color.setHex(shot.weapon === 'dry' ? 0xff7b28 : 0xffb874);
    spark.position.copy(o).addScaledVector(ray, shot.blocked ? 0 : 0.095);
    spark.material.opacity = Math.max(0, 1 - shot.elapsed / Math.min(0.08, tuning.duration)) * 0.92 * reduced;
    spark.material.rotation = shot.elapsed * 11;
    spark.scale.set(0.38 * tuning.size, 0.27 * tuning.size, 1);
    spark.visible = spark.material.opacity > 0;
    bloom.position.copy(o).addScaledVector(ray, shot.blocked ? 0 : 0.14);
    bloom.scale.set(1.25 * tuning.size, 1.25 * tuning.size, 1);
    bloom.material.opacity = fade * 0.45 * reduced;
    bloom.visible = !shot.blocked && bloom.material.opacity > 0.01;
    shot.fresh = false;
    shot.elapsed += dt;
  }

  function updateAimDot(marker, hit, viewpoint) {
    marker.visible = Boolean(hit && viewpoint);
    if (!marker.visible) return;
    marker.position.set(hit.point.x, hit.point.y, hit.point.z);
    const away = v3(viewpoint.x, viewpoint.y, viewpoint.z).sub(marker.position);
    const scale = clamp(away.length() / 9, 0.65, 2.8);
    marker.position.addScaledVector(away.normalize(), 0.025 + 0.009 * scale);
    marker.scale.setScalar(scale);
    marker.material.color.setHex(laserColors[hit.zone] ?? 0xf35347);
  }

  function update(run, dt, settings, tracking,
      { active, inspecting, stereo, calibration, menu, beam, aimHit, aim, viewpoint, enemyAlpha }) {
    if (run !== currentRun) reset(run);
    const p = run.player;
    const frozen = run.status !== 'playing';
    if (run.world.arena) syncArenaPillars(run.world.arena, run);
    else updateChunks(run.world, p);
    updateEnemies(run, dt, [aimHit?.e?.id], [aim].filter(Boolean), enemyAlpha, frozen);
    updateTools(run, dt, settings, tracking, active, inspecting, stereo, calibration, beam);
    updateLoot(run, beam, Math.max(flashState.bounce.intensity, flashState.muzzle.intensity * 0.05));
    updateAimDot(dot, aimHit, viewpoint);

    const attacker = inspecting ? run.death?.attacker : null;
    attackerMarker.visible = Boolean(attacker && viewpoint);
    if (attackerMarker.visible) {
      attackerMarker.position.set(attacker.x, attacker.y + 0.08, attacker.z);
      const width = clamp(attackerMarker.position.distanceTo(viewpoint) * 0.31, 0.12, 0.48);
      attackerMarker.scale.set(width, width / 4, 1);
    }

    const ex = run.world.exit;
    exitLight.intensity = !menu && ex && Math.hypot(p.x - ex.doorX, p.z - ex.doorZ) < 28 ? 2.1 : 0;

    const ambiance = menu ? 'menu' : settings.visibility ? 'bright' : 'dark';
    if (tone !== ambiance) {
      tone = ambiance;
      ambient.intensity = menu ? 0.38 : settings.visibility ? 0.065 : 0.015;
    }

    for (let i = effects.length - 1; i >= 0; i--) {
      const effect = effects[i];
      effect.velocity.y -= 9.5 * dt;
      effect.mesh.position.addScaledVector(effect.velocity, dt);
      if ((effect.age -= dt) <= 0 || effect.mesh.position.y < 0) {
        effect.mesh.visible = false;
        impactPool.push(effect.mesh);
        effects.splice(i, 1);
      }
    }
  }

  for (const name of enemyModels) {
    releaseEnemy(borrowEnemy(name.replace('-alt', ''), name));
  }

  return {
    update,
    events,
    state: presentationState,
    setQuality(value) {
      quality = value;
      const size = value >= 3 ? 512 : value === 2 ? 384 : 256;
      if (lamp.shadow.mapSize.x !== size) {
        lamp.shadow.map?.dispose();
        lamp.shadow.map = null;
        lamp.shadow.mapSize.set(size, size);
        shadowDirty = true;
      }
    },
    streamingStats() { return { chunks: chunks.size }; },
  };
}
