import * as THREE from 'three';
import { CHUNK, clamp, hash } from './world.js';
import { isSnag } from './dressing.js';

export const moonDirection = new THREE.Vector3(-.49, .24, -.63).normalize();
const span = CHUNK * 3;
const cells = span;

// Store unobstructed sky and moon fractions in separate channels. The window moves
// with the rendered chunk ring, and all footprints are computed in world space.
export function canopyMask(world, cx, cz, pixels) {
  const left = (cx - 1) * CHUNK, top = (cz - 1) * CHUNK;
  pixels.fill(255);
  function imprint(x, z, rx, rz, channel, strength) {
    const localX = x - left - .5, localZ = z - top - .5;
    const minX = Math.max(0, Math.floor(localX - rx));
    const minZ = Math.max(0, Math.floor(localZ - rz));
    const maxX = Math.min(cells - 1, Math.ceil(localX + rx));
    const maxZ = Math.min(cells - 1, Math.ceil(localZ + rz));
    for (let j = minZ; j <= maxZ; j++) for (let i = minX; i <= maxX; i++) {
      const edge = clamp((1 - Math.hypot((i - localX) / rx, (j - localZ) / rz)) / .66, 0, 1);
      const offset = (j * cells + i) * 4 + channel;
      pixels[offset] = Math.min(pixels[offset], Math.round(255 * (1 - edge * (2 - edge) * strength)));
    }
  }
  for (let z = cz - 2; z <= cz + 2; z++) for (let x = cx - 2; x <= cx + 2; x++) {
    const area = world.chunk(x, z);
    for (const [i, tree] of area.trees.entries()) {
      if (area.decor && isSnag(area.key, i, hash)) continue; // dead trees cast no canopy shade
      const radius = tree.crown ?? 2.5 + tree.r * 2;
      imprint(tree.x, tree.z, radius, radius, 0, .87 + (tree.thick ?? .2)*.10);
      const projected = tree.height * .47 / moonDirection.y;
      imprint(tree.x - projected * moonDirection.x, tree.z - projected * moonDirection.z,
        radius * 1.21, radius * 1.31, 1, .94);
    }
  }
}

export function createCanopyLighting() {
  const pixels = new Uint8Array(cells * cells * 4);
  const mask = new THREE.DataTexture(pixels, cells, cells);
  mask.minFilter = mask.magFilter = THREE.LinearFilter;
  const origin = new THREE.Vector2(), prepared = new WeakSet();
  let lastWorld, lastX, lastZ;

  function update(world, x, z) {
    if (world === lastWorld && x === lastX && z === lastZ) return;
    lastWorld = world; lastX = x; lastZ = z;
    canopyMask(world, x, z, pixels);
    origin.set((x - 1) * CHUNK, (z - 1) * CHUNK);
    mask.needsUpdate = true;
  }

  const lighting = THREE.ShaderChunk.lights_fragment_begin
    .replace('getDirectionalLightInfo( directionalLight, directLight );', `
      getDirectionalLightInfo( directionalLight, directLight );
      directLight.color *= mix( .09, 1.0, canopyExposure.g );
    `)
    .replace('getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );', `
      getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * mix( .29, 1.0, canopyExposure.r );
    `);

  function shade(root) {
    root.traverse(node => {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!material?.isMeshStandardMaterial || prepared.has(material)) continue;
        prepared.add(material);
        material.onBeforeCompile = shader => {
          shader.uniforms.canopyMask = { value: mask };
          shader.uniforms.canopyOrigin = { value: origin };
          shader.vertexShader = 'varying vec2 vCanopyWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', `
            #include <project_vertex>
            vec4 canopyPosition = vec4( transformed, 1.0 );
            #ifdef USE_INSTANCING
              canopyPosition = instanceMatrix * canopyPosition;
            #endif
            vCanopyWorld = ( modelMatrix * canopyPosition ).xz;
          `);
          shader.fragmentShader = 'varying vec2 vCanopyWorld;\nuniform sampler2D canopyMask;\nuniform vec2 canopyOrigin;\n'
            + shader.fragmentShader.replace('#include <lights_fragment_begin>', `
              vec2 canopyUV = (vCanopyWorld - canopyOrigin) / ${span.toFixed(1)};
              vec2 canopyExposure = texture2D(canopyMask, canopyUV).rg;
              ${lighting}
            `);
        };
        material.needsUpdate = true;
      }
    });
  }

  return { update, shade };
}

export function beamTexture(headlight = false) {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    const radius = Math.hypot(u, v * (headlight ? 2.45 : 1));
    const falloff = clamp((1 - radius) / .55, 0, 1);
    const power = falloff * falloff * (3 - 2 * falloff) * (.44 + .56 * Math.exp(-radius * radius * 5.5));
    const index = (y * size + x) * 4;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = Math.round(power * 255);
    pixels[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
