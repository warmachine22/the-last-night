import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { CHUNK, clamp, distance, hash, random } from './world.js';
import { ENEMIES, flarePower, GUNS, isSupply, LOOT, signalFlarePower, STEP } from './simulation.js';
import { legendaryBeamLabel, reloadMount } from './held-tools.js';
import { burstPhase, interpolateEnemyTransform, legacyEnemyMotion, solvedEnemyPose } from './enemy-motion.js';
import { ENEMY_RIGS } from './enemy-rigs.js';
import { ANTENNA } from './map-layout.js';
import { beamTexture, createCanopyLighting, moonDirection } from './night-lighting.js';
import { bake, grassGeometry, kit, shrubGeometry } from './kit.js';
import { DRESSING, fireflyField, isSnag } from './dressing.js';
import { createAmbientLife } from './ambient-life.js';

const textures = new THREE.TextureLoader();
const models = new GLTFLoader();
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const up = v3(0, 1, 0);
const forward = v3(0, 0, -1);
const temp = new THREE.Object3D();
const baseBox = new THREE.BoxGeometry(1, 1, 1);
const gableGeometry = (() => {
  const end = new THREE.Shape();
  end.moveTo(-.5,0);
  end.lineTo(.5,0);
  end.lineTo(0,1);
  end.closePath();
  return new THREE.ExtrudeGeometry(end,{depth:1,bevelEnabled:false}).translate(0,0,-.5);
})();
const branchGeometry = new THREE.CylinderGeometry(.24, .5, 1, 5);
const trunkGeometry = new THREE.CylinderGeometry(.25, .5, 1, 9, 1, false);
const rockGeometry = new THREE.IcosahedronGeometry(1, 1);
const forest = new THREE.Group();
const headlampLens = new THREE.MeshBasicMaterial({ color:0xffe1a6, toneMapped:false });
const shelterLens = new THREE.MeshBasicMaterial({ color:0xf6ad68, toneMapped:false });
const lanternLens = new THREE.MeshBasicMaterial({ color:0xffb35c, toneMapped:false });
const beaconLens = new THREE.MeshBasicMaterial({ color:0xff3c30, toneMapped:false });
const laserColors = { head:0xffcf65, armor:0x9eb2c4, cover:0xf3f7ff };
const rockPos = rockGeometry.attributes.position;
for (let i = 0; i < rockPos.count; i++) {
  const x = rockPos.getX(i), y = rockPos.getY(i), z = rockPos.getZ(i);
  const offset = .92 + random([x.toFixed(4), y.toFixed(4), z.toFixed(4)].join(','))() * .12;
  rockPos.setXYZ(i, x * offset, clamp(y * 1.16, -.84, .87) * offset, z * offset);
}
rockGeometry.computeVertexNormals();

function image(name) {
  const tex = textures.load(new URL('./assets/art/' + name + '.webp', import.meta.url).href);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 3;
  return tex;
}

const surfaces = {
  bark: new THREE.MeshStandardMaterial({ map: image('bark'), color: 0x9c9690, roughness: .98 }),
  earth: new THREE.MeshStandardMaterial({ map: image('ground'), roughness: .96, vertexColors: true }),
  stone: new THREE.MeshStandardMaterial({ map: image('stone'), color: 0x818680, roughness: .92, flatShading: true }),
  leaves: new THREE.MeshStandardMaterial({ color: 0x555e50, roughness: .98, side: THREE.DoubleSide, vertexColors: true }),
  fern: new THREE.MeshStandardMaterial({ color: 0x687153, roughness: .99, side: THREE.DoubleSide, vertexColors: true }),
  boards: new THREE.MeshStandardMaterial({ map: image('bark'), color: 0x687277, roughness: .98 }),
  siding: new THREE.MeshStandardMaterial({ map: image('bark'), color: 0xf5efdd, roughness: .94 }),
  mortar: new THREE.MeshStandardMaterial({ map: image('stone'), color: 0x66645b, roughness: .98 }),
  trim: new THREE.MeshStandardMaterial({ map: image('bark'), color: 0x3c4038, roughness: .97 }),
  canvas: new THREE.MeshStandardMaterial({ color:0x555744, roughness:.98, side:THREE.DoubleSide }),
  reflectors: new THREE.MeshStandardMaterial({ color: 0xbbb69b, emissive: 0x4c4530, emissiveIntensity: .56, roughness: .85 }),
};
surfaces.stone.map.repeat.set(1.55, 1.55);
surfaces.boards.map.repeat.set(2.2, .6);
// 1.1.0 dressing: one vertex-colored material shared by every rock, log, carcass, person and vehicle.
surfaces.remains = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .96, flatShading: true });

const enemyModels = Object.keys(ENEMIES).flatMap(kind => [kind, kind + '-alt']);
const modelNames = [...Object.keys(GUNS), 'flashlight', 'glove', 'wreck', ...enemyModels];
export async function loadArt(legacyMotion = false) {
  const source = await Promise.all(modelNames.map(name =>
    models.loadAsync(new URL('./assets/art/' + name + '.glb', import.meta.url).href)));
  const art = Object.fromEntries(modelNames.map((name, i) => [name, source[i]]));
  if (legacyMotion) art.legacyShambler = await models.loadAsync(new URL('./assets/dev/shambler-before.glb', import.meta.url).href);
  return art;
}

function plantGeometry(pine) {
  const pos = [], colors = [];
  const rng = random(pine ? 'needles' : 'fern');
  const blades = pine ? 14 : 10;
  for (let i = 0; i < blades; i++) {
    const a = i * Math.PI * 2 / blades + rng() * .4;
    const dx = Math.cos(a), dz = Math.sin(a);
    const length = (pine ? .64 : .44) + rng() * (pine ? .42 : .62);
    const start = pine ? (rng() - .4) * .31 : 0;
    const tilt = (pine ? -.54 : .30) + rng() * .47;
    const edge = pine ? .13 : .041;
    const steps = pine ? 5 : 6;
    const p = t => [dx * length * t, start + tilt * t + .23 * Math.sin(t * Math.PI), dz * length * t];
    const tri = (a, b, c, tone) => {
      pos.push(...a, ...b, ...c);
      for (const shade of [tone * .70, tone, tone * .9]) colors.push(shade, shade * 1.06, shade * .94);
    };
    for (let j = 0; j < steps; j++) {
      const t = (j + .35) / steps;
      const [x, y, z] = p(t), tip = p(Math.min(1, t + 1.3 / steps));
      const scale = edge * Math.sin(Math.PI * (.10 + t * .85)) * (.75 + rng() * .5);
      const tone = .5 + rng() * .36;
      for (const m of [-1, 1]) {
        tri([x - dz * scale * .32, y, z + dx * scale * .32],
          [x - dz * scale * m, y + scale * .25, z + dx * scale * m], tip, tone);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

const pineGeometry = plantGeometry(true);
const fernGeometry = plantGeometry(false);
const crownGeometry = new THREE.BufferGeometry();
{
  const positions = [], colors = [], indices = [], randomCrown = random('crown outline');
  const levels = [[-.96,.17],[-.56,.82],[-.04,1],[.50,.79],[.91,.22]];
  for (const [level,[y,radius]] of levels.entries()) for (let i=0; i<8; i++) {
    const angle = (i+level*.46)*Math.PI/4;
    const reach = radius*(.86+randomCrown()*.24);
    positions.push(Math.cos(angle)*reach,y+(randomCrown()-.5)*.16,Math.sin(angle)*reach);
    const shade = .65+.25*randomCrown();
    colors.push(shade,shade*1.06,shade*.96);
    if (level < levels.length-1) {
      const a=level*8+i, b=level*8+(i+1)%8;
      indices.push(a,a+8,b,b,a+8,b+8);
    }
  }
  for (let i=1;i<7;i++) indices.push(0,i,i+1,32,33+i,32+i);
  crownGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  crownGeometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  crownGeometry.setIndex(indices);
  crownGeometry.computeVertexNormals();
}
const tentGeometry = new THREE.BufferGeometry();
tentGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
  -.95,0,-1.24, .97,0,-1.21, .08,1.18,-1.05,
  -.80,0,1.06, .84,0,1.05, -.19,.51,.96,
],3));
tentGeometry.setIndex([0,3,5,0,5,2,1,2,5,1,5,4,3,4,5]);
tentGeometry.computeVertexNormals();

function place(mesh, index, x, y, z, sx, sy, sz, angle, color, roll = 0) {
  temp.position.set(x, y, z);
  temp.rotation.set(0, angle || 0, roll);
  temp.scale.set(sx, sy, sz);
  temp.updateMatrix();
  mesh.setMatrixAt(index, temp.matrix);
  if (color) mesh.setColorAt(index, color);
}

function beamBetween(mesh, index, first, second, width, color) {
  const delta = second.clone().sub(first);
  temp.position.copy(first).addScaledVector(delta, .5);
  temp.quaternion.setFromUnitVectors(up, delta.clone().normalize());
  temp.scale.set(width, delta.length(), width);
  temp.updateMatrix();
  mesh.setMatrixAt(index, temp.matrix);
  if (color) mesh.setColorAt(index, color);
}

function instance(group, geo, mat, count, shadow = false) {
  if (!count) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  group.add(mesh);
  return mesh;
}

function terrain(world, area) {
  const positions = [], color = [], indices = [], uv = [];
  const size = CHUNK / 2 + 1, tint = new THREE.Color(), ridge = new THREE.Color(.42,.42,.39);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const px = area.cx * CHUNK + x * 2, pz = area.cz * CHUNK + z * 2;
      const road = world.roadDistance(px, pz);
      const shade = .83 + .13 * Math.sin(px * .33 + pz * .61) + .04 * Math.cos(pz);
      turf(tint, road, shade, px, pz);
      if (road > 3) {
        const biome = world.region(px,pz);
        if (biome === 'pine') tint.multiplyScalar(.83);
        if (biome === 'ridge') tint.lerp(ridge, .3);
        if (biome === 'gully') tint.multiplyScalar(.92);
      }
      positions.push(px, world.sample(px, pz), pz);
      color.push(tint.r, tint.g, tint.b);
      uv.push(px * .33, pz * .33);
      if (x < size - 1 && z < size - 1) {
        const i = z * size + x;
        indices.push(i, i + size, i + 1, i + 1, i + size, i + size + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const floor = new THREE.Mesh(geometry, surfaces.earth);
  floor.receiveShadow = true;
  floor.userData.disposeGeometry = true;
  return floor;
}

function turf(target, road, shade, px = 0, pz = 0) {
  const verge = clamp((road - 1.65) / 1.7, 0, 1);
  // Subtle gravel grit along road shoulders (1.5-3.6 m) when dressing is active.
  const grit = DRESSING.enabled && road >= 1.5 && road <= 3.6
    ? .92 + .14 * Math.sin(px * 1.7 + pz * 2.3) * Math.cos(px * 2.9 - pz * 1.3) : 1;
  target.setRGB(.76 - verge * .27, .74 - verge * .28, .68 - verge * .39).multiplyScalar(shade * grit);
}

// 1.1.0 dressing. Dead standing trees reuse the existing instanced trunk with the crowns collapsed,
// so they cost no extra draw calls. Everything else is one merged mesh plus two instanced cover meshes.
function addDecor(group, area) {
  const d = area.decor, items = [];
  for (const r of d.rocks) items.push({ kind: r.shape === 3 ? 'rockSplit' : 'rock', variant: r.shape, x: r.x, y: r.y, z: r.z,
    yaw: r.turn, sx: r.sx * 1.5, sy: r.sy * 1.5, sz: r.sz * 1.5, shade: r.shade });
  for (const p of d.pebbles) items.push({ kind: 'pebble', x: p.x, y: p.y, z: p.z, yaw: p.turn, sx: p.s * 2, sy: p.s * 2, sz: p.s * 2, shade: p.shade });
  for (const l of d.logs) items.push(l.barrier
    ? { kind: 'logBarrier', x: l.x, y: l.y, z: l.z, yaw: l.yaw, sx: l.len / 5, sy: l.r / .35, sz: l.r / .35, shade: l.shade }
    : { kind: 'logDecor', x: l.x, y: l.y, z: l.z, yaw: l.yaw, sx: l.len, sy: l.r * 2, sz: l.r * 2, shade: l.shade });
  for (const r of d.remains) items.push({ kind: r.kind, variant: r.variant, x: r.x, y: r.y, z: r.z, yaw: r.yaw, shade: r.shade });
  for (const s of d.stains) items.push({ kind: 'stain', x: s.x, y: s.y, z: s.z, yaw: s.yaw, sx: s.s * 2, sz: s.s * 2 });
  for (const v of d.vehicles) items.push({ kind: v.kind, variant: v.hue, x: v.x, y: v.y, z: v.z, yaw: v.yaw, shade: v.shade });
  const geometry = bake(items);
  if (geometry) {
    const mesh = new THREE.Mesh(geometry, surfaces.remains);
    mesh.receiveShadow = true;
    mesh.userData.disposeGeometry = true;
    group.add(mesh);
  }
  const grass = d.cover.filter(c => !c.shrub), shrubs = d.cover.filter(c => c.shrub);
  const grassMesh = instance(group, grassGeometry, surfaces.fern, grass.length);
  const shrubMesh = instance(group, shrubGeometry, surfaces.fern, shrubs.length);
  const tint = new THREE.Color();
  for (const [i, c] of grass.entries()) {
    place(grassMesh, i, c.x, c.y, c.z, c.size * 1.6, c.size * 1.6, c.size * 1.6, c.turn, tint.setRGB(.42 + c.tone * .30, .46 + c.tone * .26, .22 + c.tone * .10));
  }
  for (const [i, c] of shrubs.entries()) {
    place(shrubMesh, i, c.x, c.y, c.z, c.size, c.size, c.size, c.turn,
      c.dead ? tint.setRGB(.30 + c.tone * .18, .24 + c.tone * .13, .15 + c.tone * .06) : tint.setRGB(.15, .25 + c.tone * .10, .14));
  }
  group.userData.cover = [grassMesh, shrubMesh].filter(Boolean);
}

function makeChunk(world, area, art, lanternGlow) {
  const group = new THREE.Group();
  group.add(terrain(world, area));
  const treeCount = area.trees.length;
  const trunks = instance(group, trunkGeometry, surfaces.bark, treeCount, true);
  const branches = instance(group, branchGeometry, surfaces.bark, treeCount * 4);
  const canopy = instance(group, pineGeometry, surfaces.leaves, treeCount * 4);
  const crowns = instance(group, crownGeometry, surfaces.leaves, treeCount * 5);
  const brush = instance(group, fernGeometry, surfaces.fern, area.plants.length);
  const rng = random(area.key + ':art');
  for (const [i, t] of area.trees.entries()) {
    const shade = new THREE.Color().setRGB(.68 + t.tint * .22, .72 + t.tint * .21, .68 + t.tint * .22);
    const spread = t.crown ?? 2.6;
    place(trunks, i, t.x, t.y + t.height * .5, t.z, t.r * 2, t.height, t.r * 2, t.turn, shade);
    for (let j = 0; j < 4; j++) {
      const tier = .43 + j * .14, height = t.y + t.height * tier;
      const a = t.turn + 2.399 * j;
      const reach = spread * (.87 + rng() * .18) * (1 - j * .16);
      const origin = v3(t.x, height, t.z);
      const end = v3(t.x + Math.cos(a) * reach, height + (t.type === 1 ? .14 : .46), t.z + Math.sin(a) * reach);
      beamBetween(branches, i * 4 + j, origin, end, t.r * .59, shade);
      const tint = new THREE.Color().setRGB(.22 + t.tint * .28, .32 + t.tint * .29, .27 + t.tint * .22);
      place(canopy, i * 4 + j, origin.x * .63 + end.x * .37, height + .22, origin.z * .63 + end.z * .37,
        reach * (t.type === 1 ? .72 : 1.15), 1.54, reach, a, tint);
    }
    for (let j=0; j<5; j++) {
      const theta=t.turn+j*2.399;
      const spreadFraction=(t.type===1?.47:.57)*(1-j*.13);
      const width=spread*(.53-j*.035);
      const center=t.height*(.57+j*.083);
      const shade=.23+.25*t.tint+rng()*.09;
      place(crowns,i*5+j,t.x+Math.cos(theta)*spread*spreadFraction,t.y+center,t.z+Math.sin(theta)*spread*spreadFraction,
        width*(t.type===1?1.14:.88),t.height*(t.type===1?.119:.158),width,theta,new THREE.Color(shade*.74,shade,shade*.78));
    }
  }
  if (area.decor) for (const [i, t] of area.trees.entries()) {
    if (!isSnag(area.key, i, hash)) continue;
    for (let j = 0; j < 4; j++) place(canopy, i * 4 + j, t.x, t.y, t.z, 1e-4, 1e-4, 1e-4, 0);
    for (let j = 0; j < 5; j++) place(crowns, i * 5 + j, t.x, t.y, t.z, 1e-4, 1e-4, 1e-4, 0);
    place(trunks, i, t.x, t.y + t.height * .5, t.z, t.r * 2, t.height, t.r * 2, t.turn, new THREE.Color(.40, .38, .36));
  }
  for (const [i, f] of area.plants.entries()) {
    const green = f.brush ? .58 + f.tint * .42 : .35 + f.tint * .42;
    const tint = new THREE.Color(green * (f.brush ? .55 : 1.12), green, green * .60);
    place(brush, i, f.x, f.y + .015, f.z, f.size * .94, f.size * (f.brush ? 1.16 : .95), f.size, f.turn, tint);
  }

  if (area.decor) addDecor(group, area);
  const rocks = area.props.filter(p => p.kind === 'stone');
  const stone = instance(group, rockGeometry, surfaces.stone, rocks.length, true);
  for (const [i, o] of rocks.entries()) {
    const shade = .60 + rng() * .38;
    place(stone, i, o.x, o.y - o.ry * .13, o.z, o.rx * 1.08, o.ry * 1.22, o.rz * 1.12, 0,
      new THREE.Color(shade * .90, shade, shade * .97));
  }
  const boards = [], masonry = [], broken = [];
  const districtParts = area.props.filter(o => (o.kind.startsWith('district') && o.kind !== 'districtGable') || o.kind === 'shedRoof');
  const districtMesh = instance(group, baseBox, surfaces.siding, districtParts.length, true);
  for (const [i,o] of districtParts.entries()) {
    const tint = new THREE.Color(o.tint ?? 0x5b645b).multiplyScalar(.78 + rng()*.22);
    place(districtMesh,i,o.x,o.y,o.z,o.rx*2,o.ry*2,o.rz*2,0,tint,o.slope ?? 0);
  }
  const breakables = area.props.filter(o => o.kind === 'breakableWall');
  const breakableMesh = instance(group, baseBox, surfaces.boards, breakables.length, true);
  if (breakableMesh) {
    const wallLookup = new Map();
    for (const [i, o] of breakables.entries()) {
      const tint = new THREE.Color(o.tint ?? 0x5c422c).multiplyScalar(.84 + rng() * .16);
      if (o.broken) place(breakableMesh, i, o.x, -400, o.z, 1e-4, 1e-4, 1e-4, 0, tint);
      else place(breakableMesh, i, o.x, o.y, o.z, o.rx * 2, o.ry * 2, o.rz * 2, 0, tint);
      wallLookup.set(o.id, { mesh: breakableMesh, index: i, wall: o });
    }
    group.userData.breakables = wallLookup;
  }
  const gables = area.props.filter(o => o.kind === 'districtGable');
  const ends = instance(group,gableGeometry,surfaces.siding,gables.length,true);
  for (const [i,end] of gables.entries())
    place(ends,i,end.x,end.y,end.z,end.width,end.height,.22,0,new THREE.Color(end.tint));
  for (const o of area.props) {
    if (o.kind === 'wreck') {
      const car = art.wreck.scene.clone();
      car.position.set(o.x, o.y - o.ry + .04, o.z);
      car.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      group.add(car);
    } else if (o.kind.startsWith('house')) {
      const vertical = o.rz > o.rx;
      const size = vertical ? o.rz : o.rx;
      const startY = o.y - o.ry;
      masonry.push([o.x, startY + .143, o.z, o.rx * 2 + .06, .29, o.rz * 2 + .06, 0]);
      for (let y = startY + .36; y < o.y + o.ry - .05; y += .17) {
        const width = size * (y > o.y + o.ry - .42 ? .77 + rng() * .23 : 1) * 2;
        boards.push([o.x, y, o.z, vertical ? o.rx * 2 : width, .162, vertical ? width : o.rz * 2, 0]);
      }
      for (const s of [-1, 1])
        broken.push([o.x + (vertical ? 0 : s * (o.rx - .1)), o.y, o.z + (vertical ? s * (o.rz-.1) : 0),
          vertical ? o.rx * 2 + .075 : .13, o.ry * 2.05, vertical ? .13 : o.rz * 2 + .075, 0]);
    } else if (o.kind === 'rafters') {
      for (let index = 0; index < 8; index++) {
        const x = o.x + (index - 3.5) * .8;
        broken.push([x, o.y + 2.68 + rng() * .15, o.z - .72 + rng() * .37, .102, .141, 2.4 + rng() * 2.6, 0]);
      }
    } else if (o.kind === 'campTent') {
      const tent=new THREE.Mesh(tentGeometry,surfaces.canvas);
      tent.position.set(o.x,o.y,o.z);
      tent.rotation.y=o.turn;
      tent.castShadow=tent.receiveShadow=true;
      group.add(tent);
      broken.push([o.x+.05,o.y+.55,o.z-1.28,.053,1.13,.057,0]);
    } else if (o.kind === 'tentBody') {
      const bed=new THREE.Mesh(baseBox,surfaces.canvas);
      bed.position.set(o.x,o.y,o.z);
      bed.scale.set(o.rx*2,o.ry*2,o.rz*2);
      bed.castShadow=bed.receiveShadow=true;
      group.add(bed);
    } else if (o.kind === 'campCrates') {
      const panels=Math.round(o.ry*4);
      for (let i=0; i<panels; i++) {
        const th=o.ry*2/panels;
        boards.push([o.x,o.y-o.ry+(i+.5)*th,o.z,o.rx*2,th*.95,o.rz*2,0]);
      }
      for (const side of [-1,1])
        broken.push([o.x+side*o.rx*.72,o.y,o.z+o.rz+.013,.092,o.ry*2,.044,0]);
    } else if (o.kind === 'firepit') {
      for (let i=0; i<8; i++) {
        const angle=i*Math.PI/4, stone=new THREE.Mesh(rockGeometry,surfaces.stone);
        stone.position.set(o.x+Math.sin(angle)*.46,o.y+.048,o.z+Math.cos(angle)*.46);
        stone.scale.set(.28,.19,.24);
        group.add(stone);
      }
      for (let i=0; i<3; i++)
        broken.push([o.x+(i-1)*.14,o.y+.026,o.z,.07,.07,.64,i*.78]);
    }
  }
  for (const [parts, mat] of [[boards, surfaces.boards], [masonry, surfaces.mortar], [broken, surfaces.trim]]) {
    const mesh = instance(group, baseBox, mat, parts.length, true);
    for (const [i, o] of parts.entries()) {
      const tint = .74 + rng() * .22;
      place(mesh, i, ...o, new THREE.Color(tint, tint * .98, tint * .93));
    }
  }
  const posts = instance(group, baseBox, surfaces.trim, area.markers.length);
  const reflectors = instance(group, baseBox, surfaces.reflectors, area.markers.length);
  for (const [i, { x,z }] of area.markers.entries()) {
    const y = world.height(x,z);
    place(posts,i,x,y+.61,z,.12,1.25,.11,0);
    place(reflectors,i,x,y+1.12,z,.19,.21,.145,0);
  }
  for (const light of area.lights) {
    if (light.type === 'wreck') {
      const lens = new THREE.Mesh(baseBox, headlampLens);
      lens.position.set(light.x, light.y, light.z-.054);
      lens.scale.set(.246,.126,.022);
      group.add(lens);
    } else if (light.type === 'lantern') {
      const base = world.height(light.x,light.z), stem = light.y - .17 - base;
      for (const [dy,width,height] of [[-stem/2-.17,.09,stem],[-.17,.29,.075],[.15,.29,.065]]) {
        const frame = new THREE.Mesh(baseBox, surfaces.trim);
        frame.position.set(light.x,light.y+dy,light.z);
        frame.scale.set(width,height,width);
        group.add(frame);
      }
      const lens = new THREE.Mesh(baseBox, lanternLens);
      lens.position.set(light.x,light.y,light.z);
      lens.scale.set(.26,.32,.26);
      const halo = new THREE.Sprite(lanternGlow);
      halo.position.copy(lens.position);
      halo.scale.setScalar(1.45);
      group.add(lens,halo);
    } else if (light.type === 'beacon') {
      const tip = new THREE.Mesh(baseBox, beaconLens);
      tip.position.set(light.x, light.y, light.z);
      tip.scale.set(.42, .48, .42);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: lanternGlow.map, color: 0xff3b2f, opacity: .9, fog: false,
        depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, toneMapped: false,
      }));
      halo.position.copy(tip.position);
      halo.scale.setScalar(3.2);
      group.add(tip, halo);
    } else {
      const fixture = new THREE.Mesh(baseBox, surfaces.trim);
      fixture.position.set(light.x,light.y+.082,light.z);
      fixture.scale.set(.25,.16,.18);
      const lens = new THREE.Mesh(baseBox, shelterLens);
      lens.position.set(light.x,light.y,light.z);
      lens.scale.set(.19,.036,.13);
      group.add(fixture,lens);
    }
  }
  return group;
}

function radialTexture(hard = false) {
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d'), ramp = g.createRadialGradient(48, 48, 0, 48, 48, 47);
  ramp.addColorStop(0, '#ffffff');
  ramp.addColorStop(hard ? .32 : .13, hard ? '#ffffffe8' : '#ffffff99');
  ramp.addColorStop(.53, '#ffffff38');
  ramp.addColorStop(1, '#ffffff00');
  g.fillStyle = ramp; g.fillRect(0, 0, 96, 96);
  return new THREE.CanvasTexture(c);
}

function lootIcon(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d'), { icon, color } = LOOT[kind];
  g.translate(48, 48);
  g.fillStyle = '#111a19e0'; g.strokeStyle = color; g.lineWidth = 3;
  g.beginPath();
  g.roundRect(-34, -29, 68, 58, 10);
  g.fill(); g.stroke();
  g.fillStyle = color;
  if (kind in GUNS) {
    g.fillRect(-23, -7, kind === 'shotgun' || kind === 'carbine' ? 50 : 42, 7);
    g.fillRect(-14, 0, kind === 'pistol' ? 10 : 23, 5);
    g.beginPath(); g.moveTo(-12, 1); g.lineTo(-2, 2); g.lineTo(-9, 16); g.lineTo(-19, 16); g.fill();
    if (kind === 'smg') g.fillRect(0, 2, 7, 15);
    if (kind === 'shotgun') g.fillRect(-30, 0, 12, 9);
    if (kind === 'carbine') { g.fillRect(-28, -5, 8, 13); g.fillRect(1, 0, 9, 11); }
  } else if (kind.startsWith('armor')) {
    g.beginPath();
    g.moveTo(-16, -14); g.lineTo(0, -19); g.lineTo(16, -14); g.lineTo(14, 7);
    g.lineTo(0, 20); g.lineTo(-14, 7); g.closePath(); g.fill();
    g.fillStyle = '#1a2424';
    g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.fillText(kind.at(-1), 0, 7);
  } else {
    g.font = 'bold 38px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(icon, 0, 2);
  }
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function labelCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture, ctx: canvas.getContext('2d') };
}

function makeLamp(map = beamTexture()) {
  const lamp = new THREE.SpotLight(0xffedd2, 0, 17, .49, .78, 2);
  lamp.map = map;
  lamp.castShadow = true;
  lamp.shadow.autoUpdate = false;
  lamp.shadow.mapSize.set(512, 512);
  lamp.shadow.camera.near = .06; lamp.shadow.camera.far = 34;
  lamp.shadow.bias = -.00019; lamp.shadow.normalBias = .028;
  return lamp;
}

function makeRadio() {
  const group = new THREE.Group();
  const casing = new THREE.MeshStandardMaterial({ color:0x505b46, roughness:.72, metalness:.25 });
  const panel = new THREE.MeshStandardMaterial({ color:0x292e29, roughness:.86 });
  const display = new THREE.MeshStandardMaterial({ color:0x99a86c, emissive:0x718248, emissiveIntensity:.44 });
  function part(material, x,y,z, w,h,d) {
    const mesh = new THREE.Mesh(baseBox, material);
    mesh.position.set(x,y,z);
    mesh.scale.set(w,h,d);
    group.add(mesh);
    return mesh;
  }
  part(casing,0,0,0,.49,.23,.25);
  part(panel,0,.005,-.127,.441,.18,.017);
  part(display,-.080,.024,-.139,.19,.042,.014);
  for (let i=0; i<4; i++) part(casing,.048+i*.032,-.029,-.141,.016,.055,.013);
  part(panel,-.153,.228,.073,.016,.285,.016).rotation.z = .17;
  part(casing,.156,.125,-.026,.059,.036,.059);
  group.visible = false;
  return group;
}

function fogSky(scene) {
  const shader = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color(0x070d19) },
      horizon: { value: new THREE.Color(0x202c38) },
      moonDirection: { value: moonDirection },
    },
    vertexShader: 'varying vec3 sky; void main(){ sky=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `
      varying vec3 sky; uniform vec3 zenith; uniform vec3 horizon; uniform vec3 moonDirection;
      float cloudCell(vec2 cell) {
        vec3 h = fract(vec3(cell.xyx) * .1031);
        h += dot(h, h.yzx + 33.33);
        return fract((h.x + h.y) * h.z);
      }
      float cloudNoise(vec2 p) {
        vec2 c = floor(p), f = fract(p);
        f = f*f*(3.-2.*f);
        return mix(mix(cloudCell(c),cloudCell(c+vec2(1.,0.)),f.x),
          mix(cloudCell(c+vec2(0.,1.)),cloudCell(c+1.),f.x),f.y);
      }
      void main(){
        vec3 d=normalize(sky); float h=clamp(d.y,0.,1.);
        float towardMoon=dot(d,moonDirection);
        float moon=pow(max(0.,towardMoon),71.);
        vec2 cloudPlane=d.xz/(.32+h);
        float cloud=.66*cloudNoise(cloudPlane*2.8)+.34*cloudNoise(cloudPlane*6.2+13.);
        float veil=smoothstep(.46,.81,cloud)*smoothstep(.07,.34,h);
        vec3 col=mix(horizon,zenith,pow(h,.37)) + (veil * .09 + moon*.38)*vec3(.08,.11,.15);
        float disk=smoothstep(.99977,.99985,towardMoon);
        gl_FragColor=vec4(col+disk*(1.-.66*veil)*vec3(.31,.38,.44),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(86, 32, 12), shader);
  sky.renderOrder = 10;
  scene.add(sky);
  return sky;
}

export function createPresentation(scene, art, layouts) {
  const localForest = forest.clone();
  scene.add(localForest);
  scene.background = new THREE.Color(0);
  scene.fog = new THREE.FogExp2(0x1c2731, .025);
  const ambient = new THREE.HemisphereLight(0x9eb7cc, 0x566270, .63);
  scene.add(ambient);
  const moon = new THREE.DirectionalLight(0xb2c7df, .34);
  moon.position.copy(moonDirection).multiplyScalar(70); scene.add(moon);
  const canopyLighting = createCanopyLighting();
  const life = createAmbientLife(scene);
  // Shader pre-warm: every material & instancing variant the dressing adds is drawn once far below
  // the world during menu, so the first carcass, vehicle, or instanced grass never stalls mid-run.
  const warmGroup = new THREE.Group();
  const warmRock = new THREE.Mesh(kit('rock', 0), surfaces.remains);
  warmRock.position.y = -400; warmRock.frustumCulled = false;
  const warmCover = instance(warmGroup, grassGeometry, surfaces.fern, 1);
  place(warmCover, 0, 0, -400, 0, 1, 1, 1, 0, new THREE.Color(1, 1, 1));
  warmCover.frustumCulled = false;
  warmGroup.add(warmRock);
  canopyLighting.shade(warmGroup);
  scene.add(warmGroup);
  const sky = fogSky(scene);
  const radioModel = makeRadio();
  scene.add(radioModel);
  const lamp = makeLamp();
  const offhandLamp = makeLamp(lamp.map);
  offhandLamp.visible = false;
  offhandLamp.shadow.mapSize.set(256, 256);
  const muzzle = new THREE.SpotLight(0xffb77e, 0, 12, .72, .72, 1.65);
  muzzle.castShadow = true;
  muzzle.shadow.autoUpdate = false;
  muzzle.shadow.mapSize.set(256, 256);
  muzzle.shadow.camera.near = .07;
  muzzle.shadow.bias = -.002;
  const offhandMuzzle = new THREE.SpotLight(0xffb77e, 0, 12, .72, .72, 1.65);
  offhandMuzzle.visible = false;
  const headlightPattern = beamTexture(true);
  const fixtureLights = Array.from({ length: 3 }, (_, idx) => {
    const light = new THREE.SpotLight(0xffd9a0, 0, 18, .62, .66, 2);
    light.map = headlightPattern;
    light.visible = false;
    light.castShadow = idx < 2;
    light.shadow.autoUpdate = false;
    light.shadow.mapSize.set(256, 256);
    light.shadow.camera.near = .07;
    light.shadow.bias = -.0007;
    light.shadow.normalBias = .038;
    return light;
  });
  scene.add(lamp, lamp.target, offhandLamp, offhandLamp.target,
    muzzle, muzzle.target, offhandMuzzle, offhandMuzzle.target, ...fixtureLights.flatMap(l => [l,l.target]));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(.012, 9, 6),
    new THREE.MeshBasicMaterial({ color:0xf54a36, toneMapped:false, fog:false }));
  dot.visible = false;
  const offhandDot = dot.clone();
  offhandDot.material = dot.material.clone();
  scene.add(dot, offhandDot);
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
  const glow = radialTexture(), burst = radialTexture(true);
  const lanternGlow = new THREE.SpriteMaterial({ map:glow, color:0xff9c38, opacity:.78, fog: false,
    depthWrite:false, transparent:true, blending:THREE.AdditiveBlending, toneMapped:false });
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: burst, color: 0xffcf87,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  spark.visible = false; scene.add(spark);
  const offhandSpark = spark.clone();
  offhandSpark.material = spark.material.clone();
  scene.add(offhandSpark);
  const flashes = [{ muzzle, spark, shot: null }, { muzzle: offhandMuzzle, spark: offhandSpark, shot: null }];
  const weaponMount = new THREE.Group(), lampMount = new THREE.Group(), offhandMount = new THREE.Group();
  const weaponAnchor = new THREE.Group(), lampAnchor = new THREE.Group(), supportAnchor = new THREE.Group();
  scene.add(weaponAnchor, lampAnchor, supportAnchor);
  weaponAnchor.add(weaponMount); lampAnchor.add(lampMount); supportAnchor.add(offhandMount);
  function tool(name, mount, source = name) {
    const model = art[source].scene.clone();
    model.position.copy(layouts[name].offset);
    model.scale.setScalar(layouts[name].scale);
    mount.add(model);
    return model;
  }
  const gloveR = tool('glove', weaponMount), gloveL = tool('glove', offhandMount);
  const guns = Object.fromEntries(Object.keys(GUNS).map(w => [w, tool(w, weaponMount)]));
  const flashlight = tool('flashlight', lampMount);
  const pistolLamp = tool('pistolLamp', weaponMount, 'flashlight');
  const offhandPistol = tool('pistol', offhandMount);
  const offhandPistolLamp = tool('pistolLamp', offhandMount, 'flashlight');
  const firstPersonMats = new Map();
  for (const model of [gloveR, gloveL, flashlight, pistolLamp, offhandPistol, offhandPistolLamp, ...Object.values(guns)]) {
    model.traverse(node => {
      if (!node.isMesh) return;
      if (!firstPersonMats.has(node.material)) {
        const lit = node.material.clone();
        lit.emissive.copy(lit.color).multiplyScalar(.09);
        firstPersonMats.set(node.material, lit);
      }
      node.material = firstPersonMats.get(node.material);
    });
  }
  const watch = labelCanvas(256, 156);
  const watchGroup = new THREE.Group(); supportAnchor.add(watchGroup);
  watchGroup.position.set(-.04, .073, .052);
  watchGroup.rotation.set(-Math.PI / 2 - .32, 0, -.12);
  const frame = new THREE.Mesh(baseBox, new THREE.MeshStandardMaterial({ color: 0x151a16, roughness: .75 }));
  frame.scale.set(.154,.101,.026);
  watchGroup.add(frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(.136,.084),
    new THREE.MeshBasicMaterial({ map: watch.texture, toneMapped: false }));
  screen.position.z = .014; watchGroup.add(screen);
  const iconTextures = Object.fromEntries(Object.keys(LOOT).map(kind => [kind, lootIcon(kind)]));
  const flares = Array.from({ length: 3 }, () => new THREE.PointLight(0xffa661, 0, 5.9, 1.65));
  scene.add(...flares);
  const chunks = new Map(), enemyMeshes = new Map(), pickups = new Map(), signals = new Map();
  const pool = Object.fromEntries(enemyModels.map(name => [name, []]));
  const effects = [];
  const effectGeometry = new THREE.TetrahedronGeometry(.038);
  const effectMaterials = {
    body: new THREE.MeshStandardMaterial({ color: 0x693b36 }),
    other: new THREE.MeshStandardMaterial({ color: 0xb09b7e }),
    armor: new THREE.MeshBasicMaterial({ color: 0xb4d8ff, toneMapped: false }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: .95 }),
    casing: new THREE.MeshStandardMaterial({ color: 0x988257, roughness: .4, metalness: .5 }),
  };
  const flashTuning = {
    pistol: { power: 240, size: 1, duration: .090 },
    shotgun: { power: 350, size: 1.35, duration: .100 },
    smg: { power: 112, size: .72, duration: .070 },
    carbine: { power: 286, size: 1.13, duration: .092 },
    flaregun: { power: 96, size: .73, duration: .070 },
  };
  const presentationState = { buzz: null };
  let impactPool = [], quality = 3, tone = '', tick = 0, currentRun = null, lastWatch = '';
  let artworkLit = null;

  function reset(run) {
    currentRun = run;
    for (const group of chunks.values()) discardChunk(group);
    chunks.clear();
    for (const visual of enemyMeshes.values()) releaseEnemy(visual);
    enemyMeshes.clear();
    for (const view of pickups.values()) discardLoot(view);
    pickups.clear();
    for (const view of signals.values()) discardLoot(view);
    signals.clear();
    warm.clear(); heading.x = heading.z = 0; lastPos.x = lastPos.z = NaN; pendingBuilds = false; anchorList = [];
    for (const effect of effects.splice(0)) { effect.mesh.visible = false; impactPool.push(effect.mesh); }
    for (const flash of flashes) flash.shot = null;
    lastWatch = '';
  }

  function discardChunk(group) {
    group.traverse(node => {
      if (node.userData.disposeGeometry) node.geometry.dispose();
      if (node.isInstancedMesh) node.dispose();
    });
    group.removeFromParent();
  }

  // 1.1.0 streaming. Chunks are built one per frame (never in a burst), the chunk ring is also
  // built around where the player is heading so tiles arrive early and hidden in the fog, and the
  // world data of the ring beyond is generated ahead of time one tile per pass.
  const heading = { x: 0, z: 0 }, lastPos = { x: NaN, z: NaN }, warm = new Set();
  const streaming = { builds: 0, lastMs: 0, maxMs: 0, decorTris: 0, decorColliders: 0 };
  let pendingBuilds = false, anchorList = [];

  function trackHeading(p, dt) {
    if (Number.isFinite(lastPos.x) && dt > 0 && dt < .5) {
      const k = Math.min(1, dt * 1.6);
      heading.x += ((p.x - lastPos.x) / dt - heading.x) * k;
      heading.z += ((p.z - lastPos.z) / dt - heading.z) * k;
    }
    lastPos.x = p.x; lastPos.z = p.z;
  }

  function applyCover(p) {
    for (const [key, view] of chunks) {
      const meshes = view.userData.cover;
      if (!meshes) continue;
      const [x, z] = key.split(',').map(Number);
      const near = Math.hypot((x + .5) * CHUNK - p.x, (z + .5) * CHUNK - p.z) < 62;
      for (const mesh of meshes) mesh.visible = quality >= 3 || (quality === 2 && near);
    }
  }

  function updateChunks(world, p) {
    const cx = Math.floor(p.x / CHUNK), cz = Math.floor(p.z / CHUNK);
    canopyLighting.update(world, cx, cz);
    const speed = Math.hypot(heading.x, heading.z);
    const ahead = quality >= 2 && speed > .5
      ? [Math.floor((p.x + heading.x / speed * 22) / CHUNK), Math.floor((p.z + heading.z / speed * 22) / CHUNK)] : null;
    const wanted = new Map();
    for (const [ox, oz, priority] of [[cx, cz, 0], ...(ahead ? [[ahead[0], ahead[1], 1]] : [])]) {
      for (let z = oz - 1; z <= oz + 1; z++) for (let x = ox - 1; x <= ox + 1; x++) {
        const key = x + ',' + z;
        if (!wanted.has(key)) wanted.set(key, { x, z, key, priority, d: Math.hypot((x + .5) * CHUNK - p.x, (z + .5) * CHUNK - p.z) });
      }
    }
    let changed = false;
    for (const [key, view] of chunks) {
      if (!wanted.has(key)) { discardChunk(view); chunks.delete(key); changed = true; }
    }
    const missing = [...wanted.values()].filter(w => !chunks.has(w.key)).sort((a, b) => a.priority - b.priority || a.d - b.d);
    const incremental = chunks.size > 0, limit = incremental ? 1 : missing.length;
    for (const w of missing.slice(0, limit)) {
      const started = performance.now();
      const area = world.chunk(w.x, w.z);
      const view = makeChunk(world, area, art, lanternGlow);
      canopyLighting.shade(view);
      view.userData.lights = area.lights;
      view.userData.anchors = area.decor?.anchors.filter(a => a.kind !== 'vehicle') ?? []; // flies gather on remains only
      chunks.set(area.key, view); localForest.add(view);
      changed = true;
      const ms = performance.now() - started;
      streaming.builds++; streaming.lastMs = ms; if (incremental) streaming.maxMs = Math.max(streaming.maxMs, ms);
      streaming.decorTris = area.decor?.triangles ?? 0; streaming.decorColliders = area.decor?.colliders ?? 0;
    }
    pendingBuilds = missing.length > limit;
    if (!pendingBuilds) {
      // Generate world data for the ring beyond, one tile per pass, nearest to the heading first.
      for (const [ox, oz] of [[cx, cz], ...(ahead ? [ahead] : [])]) {
        let done = false;
        for (let z = oz - 2; z <= oz + 2 && !done; z++) for (let x = ox - 2; x <= ox + 2 && !done; x++) {
          const key = x + ',' + z;
          if (warm.has(key)) continue;
          warm.add(key); world.chunk(x, z); done = true;
        }
        if (done) break;
      }
    }
    if (changed) {
      anchorList = [];
      for (const view of chunks.values()) if (view.userData.anchors?.length) anchorList.push(...view.userData.anchors);
      applyCover(p);
    }
    return changed;
  }

  function borrowEnemy(kind, appearance) {
    const model = kind === 'shambler' && art.legacyShambler ? kind : appearance;
    const reused = pool[model].pop();
    if (reused) {
      reused.root.visible = true; reused.deadAt = -1; reused.age = 0;
      reused.poseSignature = null;
      return reused;
    }
    const source = kind === 'shambler' && art.legacyShambler ? art.legacyShambler : art[model];
    const root = new THREE.Group(), character = clone(source.scene);
    root.add(character);
    character.rotation.y = Math.PI;
    character.traverse(m => {
      if (!m.isMesh) return;
      if (m.isSkinnedMesh) m.boundingSphere = new THREE.Sphere(v3(0, .94, 0), 1.76);
      m.receiveShadow = true;
    });
    canopyLighting.shade(character);
    scene.add(root);
    const currentPose = source === art[model] ? solvedEnemyPose({kind, gait:0}, ENEMIES[kind].windup) : null;
    const bones = currentPose?.rig.bones.map(name => character.getObjectByName(name));
    const targets = bones?.map(() => ({ position: new THREE.Vector3(), rotation: new THREE.Quaternion() }));
    const mixer = bones ? null : new THREE.AnimationMixer(character);
    const actions = {};
    if (mixer) for (const clip of source.animations) {
      actions[clip.name] = mixer.clipAction(clip).play();
      actions[clip.name].setEffectiveWeight(clip.name === 'Walk' ? 1 : 0);
    }
    const vitalMat = new THREE.MeshBasicMaterial({
      color: 0x1b6b26, transparent: true, opacity: 0, depthTest: false, toneMapped: false,
    });
    const vitalCore = new THREE.Mesh(new THREE.SphereGeometry(0.063, 12, 10), vitalMat);
    vitalCore.renderOrder = 20;
    const vitalHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: 0x22782c, opacity: 0, transparent: true,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    vitalHalo.renderOrder = 21;
    vitalHalo.scale.setScalar(0.18);
    const vitalGroup = new THREE.Group();
    vitalGroup.add(vitalCore, vitalHalo);
    vitalGroup.visible = false;
    return { root, character, bones, targets, mixer, model, actions, deadAt: -1, age: 0,
      vitalGroup, vitalCore, vitalHalo, vitalAttached: null };
  }

  function releaseEnemy(v) {
    v.root.visible = false;
    v.vitalGroup.visible = false;
    v.character.rotation.set(0, Math.PI, 0);
    v.character.position.set(0, 0, 0);
    pool[v.model].push(v);
  }

  function updateEnemies(run, dt, aimedIds, aims, alpha, frozen) {
    tick++;
    const desired = new Set();
    const corpses = run.corpses.filter(e => run.time - e.diedAt < 9).slice(-8);
    for (const e of [...run.enemies, ...corpses]) {
      if (distance(e, run.player) > 50) continue;
      desired.add(e.id);
      let v = enemyMeshes.get(e.id);
      if (!v) { v = borrowEnemy(e.kind, e.appearance ?? e.kind); enemyMeshes.set(e.id, v); }
      const d = distance(e, run.player), dead = e.diedAt !== undefined;
      v.root.rotation.y = -interpolateEnemyTransform(e, alpha, v.root.position);
      if (v.vitalAttached !== e.vitalJoint) {
        v.vitalAttached = e.vitalJoint;
        const anchor = ENEMY_RIGS[e.kind]?.anchors[e.vitalJoint ?? 2];
        const targetBone = (anchor && v.bones?.[anchor[0]]) || v.character;
        targetBone.add(v.vitalGroup);
        if (anchor) v.vitalGroup.position.set(anchor[1], anchor[2], anchor[3]);
        else v.vitalGroup.position.set(0, 1.2, 0);
      }
      const glowLevel = dead ? 0 : (e.revealGlow || 0);
      v.vitalGroup.visible = glowLevel > 0.02;
      if (v.vitalGroup.visible) {
        const pulse = 1 + 0.1 * Math.sin(run.time * 10 + e.id);
        const s = (0.85 + 0.15 * glowLevel) * pulse;
        v.vitalCore.scale.set(0.95 * s, 1.18 * s, 0.90 * s);
        v.vitalCore.material.opacity = glowLevel * 0.66;
        v.vitalHalo.material.opacity = glowLevel * 0.22;
        v.vitalHalo.scale.setScalar(0.18 * pulse);
      }
      if (dead && !v.bones) {
        const time = run.time - e.diedAt, rate = e.kind === 'brute' ? 1.2 : e.kind === 'shrieker' ? 2.05 : 1.48;
        const slump = 1 - (1 - Math.min(1, time * rate)) ** 2;
        if (v.deadAt < 0) { v.deadAt = time; v.mixer.update(0); }
        v.character.rotation.set((e.id % 3 ? 1 : -1) * slump * 1.54, Math.PI,
          Math.sin(slump * 2.6) * (e.kind === 'shrieker' ? .51 : .13));
        v.character.position.y = Math.min(.15, slump * .19) - clamp((time - 8) * .30, 0, .34);
        continue;
      }
      if (!v.bones) v.age += dt;
      const skip = d < 13 || (d < 26 && burstPhase(e)) || e.attackAge !== undefined || dead
        ? 1 : d < 24 ? (quality === 1 ? 4 : 2) : (quality === 1 ? 7 : 4);
      const gun = GUNS[run.player.weapon];
      const initial = v.bones ? !v.poseSignature : v.age === dt;
      const sample = frozen || initial || (tick + e.id) % skip === 0 || aimedIds.includes(e.id) ||
        (d <= gun.range && aims.some(({ origin, ray }) =>
          (e.x-origin.x)*ray.x+(e.z-origin.z)*ray.z >= 0 &&
          Math.abs((e.x-origin.x)*ray.z-(e.z-origin.z)*ray.x) <= 1+d*gun.spread));
      if (v.bones) {
        if (dead) {
          e.fallAge = Math.min(1.5, run.time - e.diedAt);
          v.character.position.y = -clamp((run.time - e.diedAt - 8) * .3, 0, .34);
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
        const blend = frozen || initial ? 1 : 1 - Math.exp(-dt / (STEP * (skip > 1 ? 1.45 : .66)));
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
    view.icon.material.dispose(); view.halo.material.dispose();
  }

  function updateFixtures(player, terrainChanged) {
    const candidates = [...chunks.values()].flatMap(group => group.userData.lights)
      .filter(light => distance(light, player) < light.radius + 13)
      .sort((a,b) => distance(a,player) - distance(b,player)).slice(0, fixtureLights.length);
    const unmatched = candidates.filter(source => !fixtureLights.some(light => light.userData.source === source));
    for (const light of fixtureLights) {
      const previous = light.userData.source;
      const source = candidates.includes(previous) ? previous : unmatched.shift();
      if (!source) { light.visible = false; light.intensity = 0; light.userData.source = null; continue; }
      light.visible = true;
      if (source === light.userData.source && !terrainChanged) continue;
      const headlight = source.type === 'wreck';
      light.userData.source = source;
      light.color.setHex(source.type === 'beacon' ? 0xff4636 : 0xffd9a0);
      light.intensity = headlight ? 370 : source.type === 'beacon' ? 240 : source.type === 'lantern' ? 125 : 88;
      light.position.set(source.x,source.y,source.z);
      light.target.position.copy(light.position).add(v3(source.ray.x,source.ray.y,source.ray.z));
      light.angle = source.angle;
      light.distance = source.radius;
      light.map = headlight ? headlightPattern : lamp.map;
      light.color.setHex(headlight ? 0xffe4b1 : 0xffb465);
      if (light.castShadow) light.shadow.needsUpdate = true;
    }
    return candidates;
  }

  function coneReaches(world, from, ray, target, range, angle) {
    const delta = target.clone().sub(from);
    const d = delta.length(), along = delta.dot(ray);
    if (d > range || along <= Math.cos(angle)*d) return false;
    if (from.type === 'wreck') {
      const axis = v3(ray.x, ray.y, ray.z).normalize();
      const right = axis.clone().cross(up).normalize();
      const vertical = right.clone().cross(axis);
      const radius = Math.hypot(delta.dot(right), delta.dot(vertical) * 2.45);
      if (radius >= along * Math.tan(angle)) return false;
    }
    return world.clear(from,target);
  }

  function updateSignals(run, reducedFlashes) {
    const desired = new Set();
    const lights = [];
    for (const flare of run.signalFlares) {
      const d = distance(flare, run.player);
      if (d > 68) continue;
      desired.add(flare.id);
      let view = signals.get(flare.id);
      if (!view) {
        const group = new THREE.Group();
        const icon = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glow, color: 0xffe5b1, transparent: true, depthWrite: false, toneMapped: false,
        }));
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glow, color: 0xff4a16, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        group.add(halo, icon);
        scene.add(group);
        view = { group, halo, icon };
        signals.set(flare.id, view);
      }
      const power = flare.landed ? signalFlarePower(run.time - flare.born) : .62;
      const softened = reducedFlashes ? power * .64 : power;
      const distFade = clamp((68 - d) / 10, 0, 1);
      view.group.position.set(flare.x, flare.y, flare.z);
      view.icon.scale.setScalar(flare.landed ? .18 + power * .17 : .24);
      view.halo.scale.setScalar(flare.landed ? .4 + power * 1.7 : .72);
      view.icon.material.opacity = Math.sqrt(power) * distFade;
      view.halo.material.opacity = softened * .92 * distFade;
      if (d < 52 && power > .005) lights.push({ item: flare, d,
        color: 0xff561e, reach: 2.4 + softened * (flare.landed ? 9.8 : 4.2),
        intensity: softened * (flare.landed ? 69 : 30), height: .06 });
    }
    for (const [id, view] of signals) if (!desired.has(id)) { discardLoot(view); signals.delete(id); }
    return lights;
  }

  function updateLoot(run, fixtures, beams, reducedFlashes) {
    const desired = new Set();
    const p = run.player;
    const lights = updateSignals(run, reducedFlashes);
    for (const item of run.loot) {
      const d = distance(item,p);
      if (item.lost || d >= 34 || isSupply(item.kind)) continue;
      const power = flarePower(run.time - item.born);
      if (power > .005) lights.push({ item, d, color: LOOT[item.kind].color,
        reach: 2.3 + power * 3.1, intensity: 13.5 * power, height: .32 });
    }
    const nearest = lights.sort((a, b) => (a.d + 4) / Math.sqrt(a.intensity) - (b.d + 4) / Math.sqrt(b.intensity)).slice(0, quality);
    for (const item of run.loot) {
      const d = distance(item, p);
      if (item.lost || d > 34) continue;
      desired.add(item.id);
      let view = pickups.get(item.id);
      if (!view) {
        const group = new THREE.Group();
        const icon = new THREE.Sprite(new THREE.SpriteMaterial({
          map: iconTextures[item.kind], color: 0xffffff, depthWrite: false, transparent: true, toneMapped: false,
        }));
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glow, color: LOOT[item.kind].color, depthWrite: false, transparent: true,
          blending: THREE.AdditiveBlending,
        }));
        group.add(halo, icon); scene.add(group);
        group.position.set(item.x, item.y, item.z);
        view = { group, icon, halo }; pickups.set(item.id, view);
      }
      const supply = isSupply(item.kind);
      const power = supply ? 0 : flarePower(run.time - item.born);
      const spot = v3(item.x, item.y + .45, item.z);
      const lit = beams.some(beam => coneReaches(run.world, beam.origin, beam.ray, spot, beam.range, beam.angle)) ||
        fixtures.some(source => coneReaches(run.world, source, source.ray, spot, source.radius, source.angle)) ||
        nearest.some(({ item: other, reach, height }) => other.id !== item.id &&
          distance(item, other) < reach && run.world.clear({ ...other, y: other.y + height }, spot));
      const distFade = clamp((34 - d) / 6, 0, 1);
      const strength = Math.max(lit ? .80 : 0, power * .95, item.kind === 'flareAmmo' && d < 3.3 ? .35 : 0) * distFade;
      view.icon.visible = strength > .02;
      view.icon.material.opacity = strength;
      const scale = (supply ? .24 : .53) * (1 + power * .13);
      view.icon.scale.set(scale, scale, 1);
      view.icon.position.y = item.kind === 'flareAmmo' ? .55 : supply ? .30 : .51;
      view.halo.visible = power * distFade > .005;
      view.halo.position.y = .37;
      view.halo.material.opacity = power * .61 * distFade;
      view.halo.scale.setScalar(.66 + power * .63);
    }
    for (const [id, view] of pickups) if (!desired.has(id)) { discardLoot(view); pickups.delete(id); }
    for (const [i, light] of flares.entries()) {
      const near = nearest[i];
      light.intensity = near?.intensity ?? 0;
      if (light.intensity) {
        const { item } = near;
        light.position.set(item.x, item.y + near.height, item.z);
        light.color.set(near.color);
        light.distance = near.reach;
      }
    }
  }

  function debris(event, weapon = '') {
    const amount = weapon ? 1 : event.surface === 'wood' ? 14 : quality > 1 ? 6 : 3;
    for (let i = 0; i < amount; i++) {
      if (effects.length > 72) return;
      const mesh = impactPool.pop() || new THREE.Mesh(effectGeometry);
      mesh.material = weapon ? effectMaterials.casing : effectMaterials[event.surface] || effectMaterials.other;
      mesh.scale.set(weapon ? .46 : event.surface === 'wood' ? 1.8 : 1,
        weapon ? .74 : event.surface === 'wood' ? .8 : 1, weapon ? .46 : event.surface === 'wood' ? 1.8 : 1);
      mesh.position.set(event.x + (event.surface === 'wood' ? (Math.random() - .5) * .8 : 0),
        event.y + (event.surface === 'wood' ? (Math.random() - .5) * 1.4 : 0),
        event.z + (event.surface === 'wood' ? (Math.random() - .5) * .8 : 0));
      mesh.visible = true;
      if (!mesh.parent) scene.add(mesh);
      const vx = (Math.random() - .5) * (event.surface === 'wood' ? 4.2 : 2.4);
      const vz = (Math.random() - .5) * (event.surface === 'wood' ? 4.2 : 2.4);
      effects.push({ mesh, velocity: v3(weapon ? 1.5 : vx, .6 + Math.random() * 2.1, vz),
        age: weapon ? .85 : event.surface === 'wood' ? .45 + Math.random() * .35 : .14 + Math.random() * .22 });
    }
  }

  function collapseBreakableWall(id) {
    for (const view of chunks.values()) {
      const entry = view.userData.breakables?.get(id);
      if (!entry) continue;
      place(entry.mesh, entry.index, entry.wall.x, -400, entry.wall.z, 1e-4, 1e-4, 1e-4, 0);
      entry.mesh.instanceMatrix.needsUpdate = true;
      return;
    }
  }

  function events(batch) {
    for (const event of batch) {
      if (event.type === 'shot') {
        flashes[Number(Boolean(event.offhand))].shot = { ...event, elapsed: 0, fresh: true };
        if (quality > 1 && event.weapon !== 'flaregun') debris({ x: event.x, y: event.y, z: event.z }, event.weapon);
      }
      if (event.type === 'impact') debris(event);
      if (event.type === 'deflect') debris({ ...event, surface: 'armor' });
      if (event.type === 'wallBreak') {
        collapseBreakableWall(event.id);
        debris({ x: event.x, y: event.y, z: event.z, surface: 'wood' });
      }
    }
  }

  function updateWatch(run, leftHanded) {
    const p = run.player;
    const reloading = p.reload;
    const found = run.search.parts.length, req = run.search.required;
    const parts = [p.weapon, p.ammo, p.equippedReserve, Math.ceil(p.battery * 10), p.armor,
      p.flashlight, p.beam, leftHanded, Boolean(reloading), found];
    const key = parts.join(':');
    if (key === lastWatch) return;
    lastWatch = key;
    const g = watch.ctx;
    g.fillStyle = '#121918'; g.fillRect(0, 0, 256, 156);
    g.strokeStyle = '#566c5c'; g.strokeRect(3, 3, 250, 150);
    g.fillStyle = '#94a898'; g.font = '18px monospace';
    g.fillText(reloading ? 'RELOADING' : p.weapon === 'flaregun' ? 'FLARES' : 'ROUNDS', 16, 26);
    g.fillStyle = found >= req ? '#7ee6a8' : '#d6cf9e'; g.font = 'bold 18px monospace';
    g.fillText(`PARTS ${found}/${req}`, 138, 26);
    g.fillStyle = '#eeead8'; g.font = 'bold 39px monospace';
    g.fillText(p.ammo + '/' + p.equippedReserve, 15, 72);
    g.font = '16px monospace'; g.fillStyle = '#9bb6a6';
    const light = (p.flashlight ? p.beam.toUpperCase() : 'CHARGE') + '  ' + Math.ceil(p.battery * 100) + '%';
    g.fillText(light, 16, 110, 221);
    g.fillStyle = '#35433a'; g.fillRect(16, 124, 221, 11);
    g.fillStyle = p.battery > .21 ? '#b1c79e' : '#dfa36f';
    g.fillRect(16, 124, 221 * p.battery, 11);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = i < p.armor ? '#a2c8d2' : '#334445';
      g.fillRect(185 + i * 18, 57, 13, 17);
    }
    watch.texture.needsUpdate = true;
  }

  function updateTools(run, dt, settings, tracking, active, inspecting, stereo, calibration, beam, offhandBeam) {
    const p = run.player, gun = guns[p.weapon];
    const showHands = active || inspecting;
    watchGroup.visible = stereo;
    for (const [k, m] of Object.entries(guns)) m.visible = k === p.weapon;
    weaponAnchor.visible = (showHands || calibration) && !!tracking.weapon;
    lampAnchor.visible = showHands && !p.offhand && !!tracking.lamp;
    pistolLamp.visible = showHands && Boolean(p.offhand);
    offhandPistol.visible = Boolean(p.offhand);
    offhandPistolLamp.visible = offhandPistol.visible;
    offhandLamp.visible = offhandPistol.visible;
    offhandMuzzle.visible = Boolean(p.offhand);
    const hand = p.offhand ? tracking.offhand : tracking.support || tracking.lamp;
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
    watchGroup.position.x = left ? .04 : -.04;
    const { progress: showReload, dip, y, pitch, roll } = reloadMount(!calibration && p.reload, left);
    const free = 1 - (tracking.brace ?? 0);
    weaponMount.rotation.set(pitch * free, 0, roll * free);
    weaponMount.position.y = y * free;
    const slide = gun.getObjectByName('Slide'), mag = gun.getObjectByName('Magazine'), pump = gun.getObjectByName('Pump');
    if (slide) slide.position.z = (tracking.gunKick || 0) * 1.35 + (showReload > .72 && showReload < .91 ? .019 : 0);
    if (mag) {
      mag.position.y = dip * (p.weapon === 'smg' || p.weapon === 'carbine' ? -.16 : -.10);
      mag.visible = p.weapon !== 'shotgun' || dip > .13;
    }
    if (pump) pump.position.z = tracking.pumpTravel;
    const breech = gun.getObjectByName('Breech');
    if (breech) breech.rotation.x = -1.03 * dip;
    const second = reloadMount(p.offhand?.reload, !left);
    offhandMount.rotation.set(second.pitch, 0, second.roll);
    offhandMount.position.y = second.y;
    if (p.offhand && tracking.offhand) {
      const slide = offhandPistol.getObjectByName('Slide'), mag = offhandPistol.getObjectByName('Magazine');
      if (slide) slide.position.z = (tracking.offhandKick || 0) * 1.35 +
        (second.progress > .72 && second.progress < .91 ? .019 : 0);
      if (mag) mag.position.y = -.10 * second.dip;
    }
    for (const flash of flashes) updateFlash(flash, run.world, dt, settings, active);
    const power = .72 + .28 * clamp(p.battery / .16, 0, 1);
    updateLamp(lamp, beam, power);
    updateLamp(offhandLamp, offhandBeam, power);
    const litByLamp = lamp.intensity > 0 || offhandLamp.intensity > 0 || calibration;
    if (artworkLit !== litByLamp) {
      artworkLit = litByLamp;
      for (const mat of firstPersonMats.values()) mat.emissiveIntensity = litByLamp ? .85 : 0;
    }
    updateWatch(run, left);
  }

  function updateLamp(light, beam, power) {
    if (!beam) { light.intensity = 0; return; }
    light.position.set(beam.origin.x, beam.origin.y, beam.origin.z);
    light.target.position.copy(light.position).add(v3(beam.ray.x, beam.ray.y, beam.ray.z));
    light.shadow.needsUpdate = true;
    light.angle = beam.angle;
    light.distance = beam.range;
    light.intensity = (beam.mode === 'focus' ? 520 : 340) * power;
  }

  function updateFlash(flash, world, dt, settings, active) {
    const { muzzle, spark, shot } = flash;
    muzzle.intensity = 0;
    spark.visible = false;
    if (!active) { flash.shot = null; return; }
    if (!shot) return;
    const { duration, power, size } = flashTuning[shot.weapon];
    if (shot.elapsed >= duration) { flash.shot = null; return; }
    const o = v3(shot.x, shot.y, shot.z), ray = v3(shot.ray.x, shot.ray.y, shot.ray.z);
    if (shot.fresh && !shot.blocked) {
      const cover = world.raycast(o, ray, 12);
      muzzle.distance = cover ? Math.max(.15, cover.t + .12) : 12;
      muzzle.position.copy(o);
      muzzle.target.position.copy(o).add(ray);
      if (muzzle.castShadow) muzzle.shadow.needsUpdate = true;
    }
    const fade = Math.max(0, 1 - shot.elapsed / duration);
    const reduced = settings.reducedFlashes ? .25 : 1;
    muzzle.intensity = shot.blocked ? 0 : power * fade ** 1.65 * reduced;
    spark.position.copy(o).addScaledVector(ray, shot.blocked ? 0 : .095);
    spark.material.opacity = Math.max(0, 1 - shot.elapsed / .043) * .92 * reduced;
    spark.material.rotation = shot.elapsed * 11;
    spark.scale.set(.38 * size, .27 * size, 1);
    spark.visible = spark.material.opacity > 0;
    shot.fresh = false;
    shot.elapsed += dt;
  }

  function updateAimDot(marker, hit, viewpoint) {
    marker.visible = Boolean(hit && viewpoint);
    if (!marker.visible) return;
    marker.position.set(hit.point.x,hit.point.y,hit.point.z);
    const away = v3(viewpoint.x,viewpoint.y,viewpoint.z).sub(marker.position);
    const scale = clamp(away.length() / 9,.65,2.8);
    marker.position.addScaledVector(away.normalize(), .025+.009*scale);
    marker.scale.setScalar(scale);
    marker.material.color.setHex(laserColors[hit.zone] ?? 0xf35347);
  }

  // Fireflies appear only inside seeded pockets. Carcass flies show only where a beam or flare lights the remains.
  function updateLife(run, p, fixtures, beams, reduced, menu) {
    const litTest = a => {
      const spot = v3(a.x, a.y, a.z);
      return beams.some(b => coneReaches(run.world, b.origin, b.ray, spot, b.range, b.angle))
        || fixtures.some(s => coneReaches(run.world, s, s.ray, spot, s.radius, s.angle))
        || run.signalFlares.some(f => f.landed && distance(f, a) < 9);
    };
    const result = life.update(run.time, p, run.world.height(p.x, p.z), anchorList, litTest, { quality, reduced, menu });
    const field = fireflyField(run.world.phase, p.x, p.z), lo = DRESSING.firefly.threshold - .03;
    const t = clamp((field - lo) / .11, 0, 1);
    life.setFirefly(menu || run.status !== 'playing' ? 0 : t * t * (3 - 2 * t) * (reduced ? .6 : 1));
    presentationState.buzz = result.buzz;
  }

  function update(run, dt, settings, tracking,
      { active, inspecting, stereo, calibration, menu, aimHit, aim, offhandAimHit, offhandAim, beam, offhandBeam, viewpoint, enemyAlpha }) {
    if (run !== currentRun) reset(run);
    const p = run.player;
    const frozen = run.status !== 'playing';
    const ax = ANTENNA.x - 1.0, az = ANTENNA.z + 0.6;
    radioModel.visible = Math.hypot(p.x - ax, p.z - az) < 35;
    if (radioModel.visible) {
      radioModel.position.set(ax, run.world.height(ax, az) + 1.28, az);
      radioModel.rotation.y = 0;
    }
    sky.position.set(viewpoint?.x ?? p.x, viewpoint?.y ?? p.y + p.eyeHeight, viewpoint?.z ?? p.z);
    trackHeading(p, dt);
    const terrainChanged = (!chunks.size || pendingBuilds || tick % 12 === 0) && updateChunks(run.world, p);
    const fixtures = updateFixtures(p, terrainChanged);
    updateEnemies(run, dt, [aimHit?.e?.id, offhandAimHit?.e?.id], [aim, offhandAim].filter(Boolean), enemyAlpha, frozen);
    updateLoot(run, fixtures, [beam, offhandBeam].filter(Boolean), settings.reducedFlashes);
    updateLife(run, p, fixtures, [beam, offhandBeam].filter(Boolean), settings.reducedFlashes, menu);
    updateTools(run, dt, settings, tracking, active, inspecting, stereo, calibration, beam, offhandBeam);
    updateAimDot(dot, aimHit, viewpoint);
    updateAimDot(offhandDot, offhandAimHit, viewpoint);
    const attacker = inspecting ? run.death?.attacker : null;
    attackerMarker.visible = Boolean(attacker && viewpoint);
    if (attackerMarker.visible) {
      attackerMarker.position.set(attacker.x, attacker.y + .08, attacker.z);
      const width = clamp(attackerMarker.position.distanceTo(viewpoint) * .31, .12, .48);
      attackerMarker.scale.set(width, width / 4, 1);
    }
    const ambiance = menu ? 'menu' : settings.visibility ? 'bright' : 'forest';
    if (tone !== ambiance) {
      tone = ambiance;
      moon.intensity = !menu && settings.visibility ? .42 : .34;
      ambient.intensity = !menu && settings.visibility ? .83 : .63;
      scene.fog.color.set(!menu && settings.visibility ? 0x23323b : 0x1c2731);
    }
    for (let i = effects.length - 1; !frozen && i >= 0; i--) {
      const effect = effects[i];
      effect.age -= dt; effect.velocity.y -= dt * 5.8;
      effect.mesh.position.addScaledVector(effect.velocity, dt);
      effect.mesh.rotation.z += dt * 8;
      if (effect.age <= 0) {
        effect.mesh.visible = false; impactPool.push(effect.mesh); effects.splice(i, 1);
      }
    }
  }

  return { update, events, reset, stats: streaming, state: presentationState, pickupImage: kind => iconTextures[kind].image.toDataURL(),   setQuality(value) {
    quality = value;
    if (currentRun) applyCover(currentRun.player);
    const resolution = value > 1 ? 512 : 256;
    for (const [light, size] of [[lamp, resolution], [offhandLamp, resolution / 2]]) {
      if (light.shadow.mapSize.x === size) continue;
      light.shadow.map?.dispose();
      light.shadow.map = null;
      light.shadow.mapSize.set(size,size);
    }
  } };
}
