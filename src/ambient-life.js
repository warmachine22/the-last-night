// Fireflies and carcass flies: ONE instanced draw call, no lights, no per-frame CPU animation.
// All motion is computed in the vertex shader from time. Billboards are built in view space, so
// size is resolution independent (this matters in WebXR stereo, where gl_PointSize would not be).
import * as THREE from 'three';
import { DRESSING } from './dressing.js';

export const FIREFLIES = 26, FLIES = 22, FLY_ANCHORS = 2, CELL = 26;

const vertex = `
  attribute vec4 seed;      // xyz random, w phase
  attribute float kind;     // 0 firefly, 1 fly
  attribute float slot;     // fly anchor slot
  uniform float uTime;
  uniform vec2 uCenter;
  uniform float uGround;
  uniform float uFirefly;
  uniform vec4 uAnchor[${FLY_ANCHORS}];
  varying float vAlpha;
  varying float vKind;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec3 world;
    float alpha;
    float size;
    if (kind < .5) {
      vec2 drift = vec2(sin(uTime * .21 + seed.w * 6.28), cos(uTime * .17 + seed.w * 9.1)) * 2.4 + uTime * vec2(.05, -.04);
      vec2 local = fract((seed.xz * ${CELL}.0 + drift - uCenter) / ${CELL}.0 + .5) - .5;
      float edge = smoothstep(.5, .33, max(abs(local.x), abs(local.y)));
      world = vec3(uCenter + local * ${CELL}.0, 0.0).xzy;
      world.y = uGround + .5 + seed.y * 2.6 + sin(uTime * .7 + seed.w * 12.0) * .28;
      float pulse = pow(.5 + .5 * sin(uTime * (.55 + seed.z * .9) + seed.w * 40.0), 4.0);
      alpha = uFirefly * edge * (.05 + pulse * .95);
      size = .045 + pulse * .02;
    } else {
      vec4 a = uAnchor[int(slot + .5)];
      float t = uTime * (5.0 + seed.z * 5.0) + seed.w * 60.0;
      float r = .16 + seed.x * .5;
      world = a.xyz + vec3(sin(t) * r + sin(t * 2.7) * .1, abs(sin(t * 1.3 + seed.y * 6.0)) * .45 + .05, cos(t * .9) * r + cos(t * 2.1) * .1);
      alpha = a.w * (.45 + .4 * sin(t * 3.0));
      size = .012;
    }
    vAlpha = alpha;
    vKind = kind;
    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;
  }`;
const fragmentShader = `
  varying float vAlpha;
  varying float vKind;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - .5) * 2.0;
    float falloff = clamp(1.0 - r, 0.0, 1.0);
    falloff *= falloff;
    vec3 color = vKind < .5 ? vec3(.74, 1.0, .38) : vec3(.72, .74, .68);
    gl_FragColor = vec4(color * vAlpha * falloff * (vKind < .5 ? 2.2 : 1.4), 1.0);
  }`;

export function createAmbientLife(scene) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute('position', base.attributes.position);
  geometry.setAttribute('uv', base.attributes.uv);
  const count = FIREFLIES + FLIES;
  const seed = new Float32Array(count * 4), kind = new Float32Array(count), slot = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = (n) => { const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
    seed.set([r(1), r(2), r(3), r(4)], i * 4);
    kind[i] = i < FIREFLIES ? 0 : 1;
    slot[i] = i < FIREFLIES ? 0 : (i - FIREFLIES) % FLY_ANCHORS;
  }
  geometry.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 4));
  geometry.setAttribute('kind', new THREE.InstancedBufferAttribute(kind, 1));
  geometry.setAttribute('slot', new THREE.InstancedBufferAttribute(slot, 1));
  geometry.instanceCount = count;
  const uniforms = {
    uTime: { value: 0 }, uCenter: { value: new THREE.Vector2() }, uGround: { value: 0 }, uFirefly: { value: 0 },
    uAnchor: { value: Array.from({ length: FLY_ANCHORS }, () => new THREE.Vector4(0, -500, 0, 0)) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    vertexShader: vertex.replace('void main() {', 'varying vec2 vUv;\n  void main() {\n    vUv = uv;'),
    fragmentShader,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.visible = false;
  scene.add(mesh);
  const best = [];
  return {
    mesh,
    // anchors: [{x,y,z}] near the player. lit(anchor) tells whether a beam or light reaches it.
    update(time, player, ground, anchors, lit, { quality, reduced, menu }) {
      const on = DRESSING.enabled && quality >= 2 && !menu;
      mesh.visible = on;
      if (!on) return { buzz: null };
      uniforms.uTime.value = time;
      uniforms.uCenter.value.set(player.x, player.z);
      uniforms.uGround.value = ground;
      best.length = 0;
      for (const a of anchors) {
        const d = Math.hypot(a.x - player.x, a.z - player.z);
        if (d < 16) best.push({ a, d });
      }
      best.sort((p, q) => p.d - q.d);
      let buzz = null;
      for (let i = 0; i < FLY_ANCHORS; i++) {
        const entry = best[i], u = uniforms.uAnchor.value[i];
        if (!entry || quality < 3) { u.w += (0 - u.w) * .2; continue; }
        const visible = entry.d < 2.6 || lit(entry.a);
        const target = visible ? (reduced ? .5 : 1) * Math.min(1, (16 - entry.d) / 6) : 0;
        u.x = entry.a.x; u.y = entry.a.y; u.z = entry.a.z;
        u.w += (target - u.w) * .12;
        if (!buzz || entry.d < buzz.d) buzz = { x: entry.a.x, y: entry.a.y, z: entry.a.z, d: entry.d };
      }
      return { buzz };
    },
    setFirefly(strength) { uniforms.uFirefly.value = strength; },
  };
}
