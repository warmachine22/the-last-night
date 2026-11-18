import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { CHUNK, clamp, distance, random } from './world.js';
import { ENEMIES, GUNS, isSupply, LOOT, STEP } from './simulation.js';
import { LABYRINTH_DOOR_HEIGHT, LABYRINTH_HEIGHT } from './labyrinth.js';
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
  tex.anisotropy = 3;
  return tex;
}

const surfaces = {
  floor: new THREE.MeshStandardMaterial({ map: image('stone'), color: 0x4b4e50, roughness: 0.94 }),
  wall: new THREE.MeshStandardMaterial({ map: image('stone'), color: 0x626569, roughness: 0.92 }),
  ceiling: new THREE.MeshStandardMaterial({ map: image('stone'), color: 0x2f3236, roughness: 0.96 }),
  pebbles: new THREE.MeshStandardMaterial({ map: image('stone'), color: 0x8d887e, roughness: 0.95, flatShading: true }),
  branches: new THREE.MeshStandardMaterial({ map: image('bark'), color: 0x6f553b, roughness: 0.96 }),
  puddles: new THREE.MeshStandardMaterial({ color: 0x1c2f3f, roughness: 0.14, metalness: 0.42 }),
  exitFrame: new THREE.MeshStandardMaterial({ color: 0x3b2220, roughness: 0.85 }),
};
surfaces.floor.map.repeat.set(16, 16);
surfaces.wall.map.repeat.set(2, 1.4);

const enemyModels = Object.keys(ENEMIES).flatMap(kind => [kind, kind + '-alt']);
const modelNames = [...Object.keys(GUNS).filter(k => k !== 'spraycan'), 'flashlight', 'glove', ...enemyModels];

function makeSprayCan() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.029, 0.14, 12),
    new THREE.MeshStandardMaterial({ color: 0xe65b1e, roughness: 0.45, metalness: 0.25 }),
  );
  body.position.set(0, 0.015, -0.025);
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.013, 0.027, 0.026, 12),
    new THREE.MeshStandardMaterial({ color: 0xbac0c4, roughness: 0.3, metalness: 0.7 }),
  );
  top.position.set(0, 0.095, -0.025);
  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.018, 8),
    new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.6 }),
  );
  nozzle.position.set(0, 0.114, -0.025);
  group.add(body, top, nozzle);
  return group;
}

function makeLamp(map = beamTexture()) {
  const lamp = new THREE.SpotLight(0xffedd2, 0, 18, 0.49, 0.78, 2);
  lamp.map = map;
  lamp.castShadow = true;
  lamp.shadow.autoUpdate = false;
  lamp.shadow.mapSize.set(512, 512);
  lamp.shadow.camera.near = 0.06;
  lamp.shadow.camera.far = 30;
  lamp.shadow.bias = -0.00019;
  lamp.shadow.normalBias = 0.028;
  return lamp;
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

  // 2) Enclosing Ceilings
  const ceilMesh = instance(group, baseBox, surfaces.ceiling, area.ceilings.length, false, true);
  for (const [i, c] of area.ceilings.entries()) {
    place(ceilMesh, i, c.x, LABYRINTH_HEIGHT + 0.05, c.z, c.bw + 0.15, 0.1, c.bd + 0.15, 0);
  }

  // 3) Walls & Doorway Lintels
  const wallMesh = instance(group, baseBox, surfaces.wall, area.colliders.length, true, true);
  for (const [i, w] of area.colliders.entries()) {
    const shade = 0.85 + rng() * 0.22;
    const tint = new THREE.Color(w.tint ?? 0x626569).multiplyScalar(shade);
    place(wallMesh, i, w.x, w.y + w.height / 2, w.z, w.rx * 2, w.height, w.rz * 2, 0, tint);
  }

  // 4) Ground Sound Hazards (pebbles, dry branches, puddles)
  const pebList = area.hazards.filter(h => h.kind === 'pebbles');
  const branchList = area.hazards.filter(h => h.kind === 'branches');
  const puddleList = area.hazards.filter(h => h.kind === 'puddles');

  if (pebList.length) {
    const pebbles = instance(group, pebbleGeo, surfaces.pebbles, pebList.length * 5, false, true);
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
  }

  if (branchList.length) {
    const branches = instance(group, stickGeo, surfaces.branches, branchList.length * 3, false, true);
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
  }

  if (puddleList.length) {
    const puddles = instance(group, puddleGeo, surfaces.puddles, puddleList.length, false, true);
    for (const [i, h] of puddleList.entries()) {
      place(puddles, i, h.x, 0.008, h.z, h.r * 0.95, 1, h.r * 0.78, h.turn);
    }
  }

  // 5) Single Perimeter Exit Door + Dim Red Exit Plaque (only visible inside Exit Chamber)
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

    const exitLight = new THREE.PointLight(0xff2c22, 2.1, 5.2, 2);
    exitLight.position.set(ex.doorX - ex.nx * 0.45, LABYRINTH_DOOR_HEIGHT + 0.15, ex.doorZ - ex.nz * 0.45);
    group.add(exitLight);
  }

  return group;
}

export function createPresentation(scene, art, layouts) {
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.055);
  const ambient = new THREE.HemisphereLight(0x283036, 0x101316, 0.015);
  scene.add(ambient);

  const exitTex = makeExitSignTexture();
  const flashPattern = beamTexture(true);
  const lamp = makeLamp();

  // Single bright shadow-casting muzzle flash SpotLight + synchronized room bounce PointLight
  const muzzle = new THREE.SpotLight(0xffcb8c, 0, 22, 1.05, 0.72, 1.35);
  muzzle.map = flashPattern;
  muzzle.castShadow = true;
  muzzle.shadow.autoUpdate = false;
  muzzle.shadow.mapSize.set(256, 256);
  muzzle.shadow.camera.near = 0.08;
  muzzle.shadow.bias = -0.002;

  const muzzleBounce = new THREE.PointLight(0xffb470, 0, 12.5, 1.45);
  scene.add(lamp, lamp.target, muzzle, muzzle.target, muzzleBounce);

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
  scene.add(spark);
  const flashState = { muzzle, bounce: muzzleBounce, spark, shot: null };

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
    Object.keys(GUNS).map(w => {
      if (w === 'spraycan') {
        const can = makeSprayCan();
        weaponMount.add(can);
        return [w, can];
      }
      return [w, tool(w, weaponMount)];
    }),
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

  const paintMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.11, 10),
    new THREE.MeshStandardMaterial({
      color: 0xff621a,
      emissive: 0x3b1203,
      roughness: 0.55,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      side: THREE.DoubleSide,
    }),
    450,
  );
  paintMesh.count = 0;
  paintMesh.frustumCulled = false;
  scene.add(paintMesh);
  const paintQuat = new THREE.Quaternion();
  const forwardZ = v3(0, 0, 1);

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
  let syncedPaint = 0;

  function reset(run) {
    currentRun = run;
    for (const group of chunks.values()) discardChunk(group);
    chunks.clear();
    for (const visual of enemyMeshes.values()) releaseEnemy(visual);
    enemyMeshes.clear();
    for (const view of pickups.values()) discardLoot(view);
    pickups.clear();
    for (const effect of effects.splice(0)) { effect.mesh.visible = false; impactPool.push(effect.mesh); }
    flashState.shot = null;
    paintMesh.count = 0;
    syncedPaint = 0;
  }

  function syncPaintMarks(run) {
    const marks = run.paintMarks || [];
    if (marks.length === syncedPaint && marks.length < 450) return;
    const count = Math.min(450, marks.length);
    for (let i = 0; i < count; i++) {
      const m = marks[i];
      temp.position.set(m.x, m.y, m.z);
      paintQuat.setFromUnitVectors(forwardZ, temp.up.set(m.nx, m.ny, m.nz));
      temp.quaternion.copy(paintQuat);
      temp.scale.setScalar(0.85 + (i % 4) * 0.12);
      temp.updateMatrix();
      paintMesh.setMatrixAt(i, temp.matrix);
    }
    paintMesh.count = count;
    paintMesh.instanceMatrix.needsUpdate = true;
    syncedPaint = marks.length;
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
    const wanted = new Map();
    for (let z = cz - 1; z <= cz + 1; z++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        const key = `${x},${z}`;
        wanted.set(key, { x, z, key, d: Math.hypot((x + 0.5) * CHUNK - p.x, (z + 0.5) * CHUNK - p.z) });
      }
    }
    for (const [key, view] of chunks) {
      if (!wanted.has(key)) { discardChunk(view); chunks.delete(key); }
    }
    const missing = [...wanted.values()].filter(w => !chunks.has(w.key)).sort((a, b) => a.d - b.d);
    const limit = chunks.size > 0 ? 1 : missing.length;
    for (const w of missing.slice(0, limit)) {
      const area = world.chunk(w.x, w.z);
      const view = makeChunk(area, exitTex);
      scene.add(view);
      chunks.set(w.key, view);
    }
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
      if (distance(e, run.player) > 42) continue;
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

  function coneReaches(world, from, ray, target, range, angle) {
    const delta = target.clone().sub(from);
    const d = delta.length(), along = delta.dot(ray);
    if (d > range || along <= Math.cos(angle) * d) return false;
    return world.clear(from, target);
  }

  function updateLoot(run, beam, flashLitIntensity) {
    const desired = new Set();
    const p = run.player;
    const flashBoost = flashLitIntensity > 0 ? clamp(flashLitIntensity / 3.5, 0, 1) : 0;
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
      const spot = v3(item.x, item.y + 0.4, item.z);
      const beamLit = beam && coneReaches(run.world, beam.origin, beam.ray, spot, beam.range, beam.angle);
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
    lampAnchor.visible = !run.noLight && showHands && !!tracking.lamp;
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
    updateLamp(lamp, beam, power);
    const litByLamp = lamp.intensity > 0 || calibration;
    if (artworkLit !== litByLamp) {
      artworkLit = litByLamp;
      for (const mat of firstPersonMats.values()) mat.emissiveIntensity = litByLamp ? 0.85 : 0.08;
    }
  }

  function updateLamp(light, beam, power) {
    if (!beam) { light.intensity = 0; return; }
    light.position.set(beam.origin.x, beam.origin.y, beam.origin.z);
    light.target.position.copy(light.position).add(v3(beam.ray.x, beam.ray.y, beam.ray.z));
    light.shadow.needsUpdate = true;
    light.angle = beam.angle;
    light.distance = beam.range;
    light.intensity = (beam.mode === 'focus' ? 460 : 300) * power;
  }

  function updateFlash(flash, world, dt, settings, active) {
    const { muzzle, bounce, spark, shot } = flash;
    muzzle.intensity = 0;
    bounce.intensity = 0;
    spark.visible = false;
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
    updateChunks(run.world, p);
    syncPaintMarks(run);
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

  return {
    update,
    events,
    state: presentationState,
    setQuality(value) { quality = value; },
    streamingStats() { return { chunks: chunks.size }; },
  };
}
