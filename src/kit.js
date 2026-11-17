// Procedural low-poly scenery kit for the 1.1.0 dressing. Every piece is a small vertex-colored,
// non-indexed mesh built once, then baked (transformed and merged) into one mesh per chunk.
import * as THREE from 'three';
import { TRIS } from './dressing.js';

const box = new THREE.BoxGeometry(1, 1, 1);
const ball = new THREE.IcosahedronGeometry(.5, 0);                // 20 tris
const tube = new THREE.CylinderGeometry(.5, .5, 1, 8, 1, false);   // 32 tris
const taper = new THREE.CylinderGeometry(.35, .5, 1, 8, 1, false);
const cone = new THREE.ConeGeometry(.5, 1, 6, 1);                  // 12 tris
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();

function part(out, geo, pos, size, rot, color) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  q.setFromEuler(e.set(rot[0], rot[1], rot[2]));
  m4.compose(v.set(...pos), q, s.set(...size));
  g.applyMatrix4(m4);
  const count = g.attributes.position.count, c = new THREE.Color(color), cols = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const n = .88 + ((i * 7919) % 13) / 13 * .24; // faceted tonal noise so faces read in a flashlight
    cols[i * 3] = c.r * n; cols[i * 3 + 1] = c.g * n; cols[i * 3 + 2] = c.b * n;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.deleteAttribute('uv');
  out.push(g);
}
const finish = parts => {
  const total = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const position = new Float32Array(total * 3), normal = new Float32Array(total * 3), color = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    position.set(g.attributes.position.array, o * 3);
    normal.set(g.attributes.normal.array, o * 3);
    color.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  out.userData.tris = total / 3;
  return out;
};

const fur = { deer: 0x6e5a40, bear: 0x35291f, fox: 0x8a5a33, rabbit: 0x777066 };
const bone = 0xcfc7b0, dark = 0x2c1d1a, cloth = [0x3d4a52, 0x5b4a3b, 0x464a3a], skin = 0x9a8470;

const builders = {
  rock: ([variant]) => {
    const p = [];
    const v = variant % 5;
    if (v === 1) { // flat layered slab
      part(p, ball, [0, .28, 0], [1.1, .75, .95], [.08, .4, -.05], 0x7d827b);
    } else if (v === 2) { // craggy tall spire
      part(p, ball, [0, .44, 0], [.85, 1.15, .85], [.1, 1.2, -.08], 0x969a92);
    } else if (v === 4) { // mossy boulder
      part(p, ball, [0, .38, 0], [1, 1, 1], [0, .9, 0], 0x7e847c);
      part(p, ball, [0, .64, 0], [.74, .34, .72], [0, 2.1, 0], 0x566449);
    } else {
      part(p, ball, [0, .38, 0], [1, 1, 1], [0, variant, 0], 0x8a8f89);
    }
    return finish(p);
  },
  rockSplit: () => {
    const p = [];
    part(p, ball, [-.25, .35, 0], [.9, .9, .9], [0, .3, 0], 0x858a82);
    part(p, ball, [.3, .3, .1], [.7, .62, .8], [0, 1.1, 0], 0x7a7f78);
    return finish(p);
  },
  pebble: () => { const p = []; part(p, new THREE.OctahedronGeometry(.5, 0), [0, .25, 0], [1, .6, .9], [0, 0, 0], 0x8b8a82); return finish(p); },
  logDecor: () => {
    const p = [];
    part(p, tube, [0, 0, 0], [1, 1, 1], [0, 0, Math.PI / 2], 0x4b3a2b);
    return finish(p);
  },
  logBarrier: () => {
    // Authored at 5.0 m long (along X) and 0.70 m diameter (0.35 m radius) so branch stubs stay unstretched.
    const p = [];
    part(p, taper, [0, 0, 0], [.7, 5.0, .7], [0, 0, Math.PI / 2], 0x3f3226);
    part(p, cone, [.45, .26, .16], [.22, .58, .22], [.85, .2, .15], 0x2f261d);   // snapped branch stubs
    part(p, cone, [-.95, .22, -.18], [.2, .52, .2], [-.85, 0, .1], 0x2f261d);
    return finish(p);
  },
  stump: () => { const p = []; part(p, taper, [0, .25, 0], [.5, .5, .5], [0, 0, 0], 0x4a3a2c); return finish(p); },
  deer: ([variant]) => {
    const p = [], c = fur.deer;
    part(p, ball, [0, .38, 0], [.62, .5, 1.45], [0, 0, 0], c);                 // barrel
    part(p, ball, [0, .46, .98], [.28, .26, .5], [.25, 0, 0], c);              // neck
    part(p, cone, [0, .5, 1.3], [.2, .45, .2], [Math.PI / 2 + .1, 0, 0], c);   // head
    for (const sx of [-1, 1]) {
      part(p, tube, [sx * .22, .12, .6], [.07, .7, .07], [0, 0, sx * .9], 0x57472f);   // legs sprawled
      part(p, tube, [sx * .24, .1, -.55], [.07, .75, .07], [.4, 0, sx * 1.1], 0x57472f);
    }
    part(p, cone, [.06, .85, 1.18], [.05, .55, .05], [.7, 0, .5], 0xb7aa89);    // antler
    if (variant) part(p, tube, [0, .62, .1], [.4, .05, .9], [0, 0, 0], bone);  // exposed ribs
    part(p, ball, [0, .2, 0], [.8, .1, 1.5], [0, 0, 0], dark);
    return finish(p);
  },
  bear: ([variant]) => {
    const p = [], c = fur.bear;
    part(p, ball, [0, .6, 0], [1.2, .95, 2.0], [0, 0, 0], c);                  // body
    part(p, ball, [0, .98, .35], [.8, .55, .8], [0, 0, 0], 0x3f3226);          // shoulder hump
    part(p, ball, [0, .55, 1.15], [.62, .5, .75], [.2, 0, 0], c);              // head
    part(p, cone, [0, .5, 1.62], [.26, .32, .26], [Math.PI / 2, 0, 0], 0x4a3d30);
    for (const sx of [-1, 1]) {
      part(p, ball, [sx * .3, .75, .98], [.14, .14, .14], [0, 0, 0], c);       // ears
      part(p, tube, [sx * .55, .22, .75], [.22, .9, .22], [0, 0, sx * 1.2], c);
      part(p, tube, [sx * .6, .2, -.65], [.24, .9, .24], [.3, 0, sx * 1.25], c);
      part(p, cone, [sx * 1.0, .1, .9], [.04, .16, .04], [0, 0, sx * 1.5], bone); // claws
    }
    if (variant) part(p, tube, [0, .98, -.1], [.8, .06, 1.2], [0, 0, 0], bone);
    part(p, ball, [0, .22, 0], [1.4, .1, 2.3], [0, 0, 0], dark);
    return finish(p);
  },
  fox: () => {
    const p = [], c = fur.fox;
    part(p, ball, [0, .15, 0], [.28, .22, .75], [0, 0, 0], c);
    part(p, ball, [0, .17, .46], [.2, .18, .3], [0, 0, 0], c);
    part(p, cone, [0, .16, .66], [.1, .2, .1], [Math.PI / 2, 0, 0], 0xcfc4b0);
    part(p, cone, [.0, .12, -.6], [.2, .75, .2], [-Math.PI / 2, 0, 0], 0xb5703c);   // brush tail
    for (const sx of [-1, 1]) {
      part(p, cone, [sx * .07, .3, .5], [.07, .13, .05], [0, 0, 0], 0x2f2620);
      part(p, tube, [sx * .15, .06, .22], [.04, .3, .04], [0, 0, sx * 1.3], 0x3a2c22);
    }
    return finish(p);
  },
  rabbit: () => {
    const p = [], c = fur.rabbit;
    part(p, ball, [0, .1, 0], [.17, .15, .3], [0, 0, 0], c);
    part(p, ball, [0, .12, .2], [.1, .1, .12], [0, 0, 0], c);
    for (const sx of [-1, 1]) part(p, cone, [sx * .035, .2, .22], [.04, .18, .03], [.5, 0, sx * .2], c);
    part(p, ball, [0, .09, -.18], [.07, .07, .07], [0, 0, 0], 0xcfc8b8);
    return finish(p);
  },
  bones: () => {
    const p = [];
    part(p, tube, [0, .03, 0], [.04, .55, .04], [0, 0, Math.PI / 2], bone);
    part(p, tube, [.12, .03, .15], [.035, .4, .035], [0, .6, Math.PI / 2], bone);
    part(p, tube, [-.08, .03, -.14], [.03, .35, .03], [0, -.9, Math.PI / 2], bone);
    return finish(p);
  },
  skull: () => {
    const p = [];
    part(p, ball, [0, .08, 0], [.2, .15, .26], [0, 0, 0], bone);
    part(p, cone, [0, .06, .17], [.08, .18, .08], [Math.PI / 2, 0, 0], bone);
    return finish(p);
  },
  pack: () => {
    const p = [];
    part(p, box, [0, .18, 0], [.38, .36, .26], [0, 0, 0], 0x4b5a3b);
    part(p, box, [0, .2, .15], [.3, .2, .08], [0, 0, 0], 0x3b4430);
    return finish(p);
  },
  personSlumped: ([variant]) => {
    const p = [], coat = cloth[variant % 3];
    part(p, box, [0, .6, 0], [.46, .62, .26], [-.25, 0, 0], coat);                 // torso against the trunk
    part(p, ball, [0, 1.02, .08], [.2, .22, .22], [0, 0, 0], skin);                 // head sagging forward
    part(p, ball, [0, 1.08, .06], [.23, .14, .24], [0, 0, 0], 0x2a2420);            // hair / hood
    part(p, box, [-.26, .5, .14], [.12, .5, .13], [-.5, 0, .1], coat);              // arms
    part(p, box, [.26, .4, .24], [.12, .5, .13], [-.7, 0, -.1], coat);
    part(p, tube, [-.14, .13, .52], [.16, .78, .16], [Math.PI / 2 - .25, 0, 0], 0x3b3a34);  // legs out
    part(p, tube, [.14, .13, .58], [.16, .78, .16], [Math.PI / 2 - .35, 0, 0], 0x3b3a34);
    part(p, box, [-.14, .06, .98], [.12, .09, .26], [0, .1, 0], 0x24211d);          // boots
    part(p, box, [.16, .06, 1.0], [.12, .09, .26], [0, -.1, 0], 0x24211d);
    return finish(p);
  },
  personLying: ([variant]) => {
    const p = [], coat = cloth[variant % 3];
    part(p, box, [0, .14, 0], [.5, .22, .72], [0, 0, 0], coat);
    part(p, ball, [0, .13, .54], [.2, .2, .22], [0, 0, 0], skin);
    part(p, ball, [0, .17, .52], [.22, .12, .22], [0, 0, 0], 0x2a2420);
    part(p, tube, [-.13, .09, -.62], [.15, .76, .15], [Math.PI / 2, .08, 0], 0x3b3a34);
    part(p, tube, [.14, .09, -.58], [.15, .72, .15], [Math.PI / 2, -.12, 0], 0x3b3a34);
    part(p, tube, [-.36, .08, .12], [.11, .6, .11], [Math.PI / 2, -.5, 0], coat);
    part(p, tube, [.38, .08, .26], [.11, .5, .11], [Math.PI / 2, .6, 0], coat);
    return finish(p);
  },
  stain: () => { const p = []; part(p, new THREE.CylinderGeometry(.5, .5, .01, 7), [0, 0, 0], [1, 1, .8], [0, 0, 0], 0x1d1210); return finish(p); },
  sedan: ([hue]) => vehicle(hue, 1.85, 4.3, .58, .54, 0),
  pickup: ([hue]) => vehicle(hue, 2.0, 5.0, .62, .56, 1),
  van: ([hue]) => vehicle(hue, 2.1, 5.2, .74, .82, 2),
  moto: ([hue]) => motorcycle(hue, false),
  motoFallen: ([hue]) => motorcycle(hue, true),
};
const paints = [0x2b333a, 0x3f2621, 0x293326, 0x454139];

function vehicle(hue, w, l, bodyH, cabH, kind) {
  const p = [], paint = paints[hue % 4], glass = 0x101417, trim = 0x1b1d1e;
  const deckY = .28 + bodyH;
  part(p, box, [0, .28 + bodyH / 2, 0], [w, bodyH, l], [0, 0, .03], paint);                 // lower body
  part(p, box, [0, .36, l * .51], [w * .98, .18, .12], [0, 0, 0], trim);                     // front bumper
  part(p, box, [0, .36, -l * .51], [w * .98, .18, .12], [0, 0, 0], trim);                    // rear bumper
  if (kind === 2) {
    // Van: full-length upper shell with dark window strip & painted roof
    part(p, box, [0, deckY + cabH * .44, -.28], [w * .94, cabH * .76, l * .80], [0, 0, .03], glass);
    part(p, box, [0, deckY + cabH * .88, -.28], [w * .95, .16, l * .82], [0, 0, .03], paint);
  } else if (kind === 1) {
    // Pickup: cab + open cargo bed sides
    part(p, box, [0, deckY + cabH * .42, .45], [w * .90, cabH * .74, l * .34], [0, 0, .03], glass);
    part(p, box, [0, deckY + cabH * .84, .45], [w * .92, .14, l * .36], [0, 0, .03], paint);
    part(p, box, [0, deckY + .06, -l * .28], [w * .88, .14, l * .38], [0, 0, .03], trim);
  } else {
    // Sedan: cabin glass + painted roof
    part(p, box, [0, deckY + cabH * .42, -.12], [w * .88, cabH * .74, l * .48], [0, 0, .03], glass);
    part(p, box, [0, deckY + cabH * .84, -.12], [w * .90, .14, l * .50], [0, 0, .03], paint);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    part(p, tube, [sx * (w / 2 - .02), .32, sz * l * .3], [.62, .22, .62], [0, 0, Math.PI / 2], 0x15181a);
  part(p, box, [0, .18, 0], [w * .88, .12, l * .92], [0, 0, 0], 0x1d1a18);
  return finish(p);
}
function motorcycle(hue, fallen) {
  const p = [], paint = paints[hue % 4];
  const t = fallen ? [0, .28, 0] : [0, 0, 0], rot = fallen ? Math.PI / 2 - .12 : 0;
  const place = (geo, pos, size, r, c) => part(p, geo, [pos[0] + t[0] + (fallen ? .2 : 0), fallen ? pos[1] * .35 + .12 : pos[1], pos[2]], size, [r[0], r[1], r[2] + (fallen ? rot : 0)], c);
  place(tube, [0, .38, .72], [.62, .09, .62], [0, 0, Math.PI / 2], 0x15181a);
  place(tube, [0, .38, -.72], [.62, .12, .62], [0, 0, Math.PI / 2], 0x15181a);
  place(box, [0, .62, 0], [.26, .36, 1.1], [0, 0, 0], paint);
  place(ball, [0, .88, .08], [.34, .26, .55], [0, 0, 0], paint);
  place(box, [0, .95, -.45], [.22, .08, .5], [0, 0, 0], 0x1d1b19);
  place(tube, [0, .98, .72], [.7, .04, .04], [0, 0, Math.PI / 2], 0x2b2b2b);
  return finish(p);
}

const cache = new Map();
export function kit(kind, variant = 0) {
  const key = kind + ':' + variant;
  let g = cache.get(key);
  if (!g) { g = builders[kind]([variant]); cache.set(key, g); }
  return g;
}
export const kitKinds = Object.keys(builders);
export { TRIS };

// Bake a list of {kind, variant, x,y,z, yaw, sx,sy,sz, shade} into one merged BufferGeometry.
const bm = new THREE.Matrix4(), bq = new THREE.Quaternion(), by = new THREE.Vector3(0, 1, 0), bp = new THREE.Vector3(), bs = new THREE.Vector3(), vec = new THREE.Vector3();
const nm = new THREE.Matrix3();
export function bake(items) {
  let total = 0;
  for (const it of items) total += kit(it.kind, it.variant ?? 0).attributes.position.count;
  if (!total) return null;
  const position = new Float32Array(total * 3), normal = new Float32Array(total * 3), color = new Float32Array(total * 3);
  let o = 0;
  for (const it of items) {
    const g = kit(it.kind, it.variant ?? 0), pa = g.attributes.position.array, na = g.attributes.normal.array, ca = g.attributes.color.array;
    bq.setFromAxisAngle(by, it.yaw ?? 0);
    bm.compose(bp.set(it.x, it.y, it.z), bq, bs.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1));
    nm.getNormalMatrix(bm);
    const shade = it.shade ?? 1, tr = it.tint?.[0] ?? 1, tg = it.tint?.[1] ?? 1, tb = it.tint?.[2] ?? 1;
    const count = g.attributes.position.count;
    for (let i = 0; i < count; i++) {
      vec.set(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]).applyMatrix4(bm);
      position[(o + i) * 3] = vec.x; position[(o + i) * 3 + 1] = vec.y; position[(o + i) * 3 + 2] = vec.z;
      vec.set(na[i * 3], na[i * 3 + 1], na[i * 3 + 2]).applyMatrix3(nm).normalize();
      normal[(o + i) * 3] = vec.x; normal[(o + i) * 3 + 1] = vec.y; normal[(o + i) * 3 + 2] = vec.z;
      color[(o + i) * 3] = ca[i * 3] * shade * tr; color[(o + i) * 3 + 1] = ca[i * 3 + 1] * shade * tg; color[(o + i) * 3 + 2] = ca[i * 3 + 2] * shade * tb;
    }
    o += count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  out.computeBoundingSphere();
  return out;
}

// Cheap cover geometry: grass tuft (6 tris) and shrub/dead brush (14 tris), vertex colored, double sided via material.
function blades(count, length, width, lean, quads) {
  const pos = [], col = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2.399, dx = Math.cos(a), dz = Math.sin(a), l = length * (.7 + ((i * 37) % 10) / 10 * .5), w = width;
    const tx = dx * l * lean, tz = dz * l * lean;
    const bx = -dz * w, bz = dx * w;
    const tip = [tx, l, tz], l0 = [dx * .02 - bx, 0, dz * .02 - bz], r0 = [dx * .02 + bx, 0, dz * .02 + bz];
    if (quads) {
      const l1 = [tx * .5 - bx * .8, l * .55, tz * .5 - bz * .8], r1 = [tx * .5 + bx * .8, l * .55, tz * .5 + bz * .8];
      pos.push(...l0, ...r0, ...l1, ...r0, ...r1, ...l1);
      pos.push(...l1, ...r1, ...tip);
    } else pos.push(...l0, ...r0, ...tip);
    const n = quads ? 9 : 3;
    for (let k = 0; k < n; k++) { const t = .7 + (k % 3) * .15; col.push(t * .8, t, t * .7); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
export const grassGeometry = blades(6, .5, .035, .35, false);   // 6 tris
export const shrubGeometry = blades(4, .9, .22, .25, true);     // 12 tris
