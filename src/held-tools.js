import * as THREE from 'three';
import { GUNS } from './simulation.js';

const forward = new THREE.Vector3(0, 0, -1);
const names = [...Object.keys(GUNS), 'flashlight', 'glove'];
const degrees = Math.PI / 180;
const foregripGuns = new Set(['shotgun', 'smg', 'carbine']);
const grabDistance = .15;
const trackingGrace = .15;
const steerTime = .030;
const fixedReference = new THREE.Quaternion();

const recoilTuning = {
  pistol: { pitch: 5.1, yaw: .55, travel: .026, recovery: .089 },
  shotgun: { pitch: 11.5, yaw: .85, travel: .062, recovery: .15 },
  smg: { pitch: 3.2, yaw: .36, travel: .014, recovery: .145 },
  carbine: { pitch: 6.3, yaw: .50, travel: .036, recovery: .105 },
  flaregun: { pitch: 3.4, yaw: .38, travel: .015, recovery: .10 },
};

export const gunAngle = value => Math.max(-25, Math.min(25, Math.round(Number.isFinite(value) ? value : 0)));
const rotation = (pitch, yaw) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));

export function legendaryBeamLabel(player, leftHanded) {
  const primary = player.beam.toUpperCase(), offhand = player.offhand.beam.toUpperCase();
  return leftHanded ? 'R ' + offhand + ' · L ' + primary : 'R ' + primary + ' · L ' + offhand;
}

export function toolLayouts(art) {
  const layouts = Object.fromEntries(names.map(name => {
    const scene = art[name].scene;
    scene.updateMatrixWorld(true);
    const socket = label => {
      const node = scene.getObjectByName(label);
      if (!node) throw Error(name + ' is missing ' + label);
      return scene.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
    };
    const scale = name === 'pistol' ? .94 : 1;
    const offset = socket(name === 'glove' ? 'GloveSocket' : 'GripSocket').multiplyScalar(-scale);
    if (name === 'pistol') offset.y -= .015;
    if (name in GUNS && name !== 'pistol') offset.y -= .009;
    const muzzle = name === 'glove' ? null : socket('MuzzleSocket').multiplyScalar(scale).add(offset);
    const support = name in GUNS ? socket('SupportSocket').multiplyScalar(scale).add(offset) : null;
    return [name, { scale, offset, muzzle, support }];
  }));
  const lamp = layouts.flashlight, scale = .45;
  const rail = layouts.pistol.muzzle.clone().add(new THREE.Vector3(0, -.041, .132));
  layouts.pistolLamp = {
    scale: lamp.scale * scale,
    offset: rail.clone().addScaledVector(lamp.offset, scale),
    muzzle: rail.clone().addScaledVector(lamp.muzzle, scale),
  };
  return layouts;
}

export function heldPose(pose, stereo) {
  if (!pose || !stereo) return pose;
  return {
    position: pose.position.clone().add(new THREE.Vector3(0,-.012,-.008).applyQuaternion(pose.quaternion)),
    quaternion: (pose.pointer || pose.quaternion).clone(),
  };
}

export function mountedAim(pose, layout, view) {
  if (!pose) return undefined;
  const origin = layout.muzzle.clone().applyQuaternion(pose.quaternion).add(pose.position);
  const ray = forward.clone().applyQuaternion(pose.quaternion);
  return { origin, ray, viewOrigin: view?.position };
}

export function reloadMount(reload, leftHanded) {
  const progress = reload ? 1 - reload.left / reload.duration : 0;
  const dip = Math.sin(Math.PI * progress);
  return { progress, dip, y: -.050 * dip, pitch: -.47 * dip, roll: (leftHanded ? -.35 : .35) * dip };
}

export function shotgunPumpTravel(sinceShot, reload) {
  const cycle = THREE.MathUtils.clamp((sinceShot - .19) / .34, 0, 1);
  return Math.sin(cycle * Math.PI) * .081 + reloadMount(reload, false).dip * .046;
}

export function pistolLampAim(pose, layout, view, reload, leftHanded) {
  if (!pose) return undefined;
  const mount = reloadMount(reload, leftHanded);
  return mountedAim({
    position: new THREE.Vector3(0, mount.y, 0).applyQuaternion(pose.quaternion).add(pose.position),
    quaternion: pose.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(mount.pitch, 0, mount.roll))),
  }, layout, view);
}

function towardCrosshair(weapon, layout, view) {
  const target = view.position.clone().addScaledVector(forward.clone().applyQuaternion(view.quaternion), 27);
  const quaternion = view.quaternion.clone();
  // Recompute the offset after rotating so the visible bore and the desktop aim agree.
  for (let pass = 0; pass < 2; pass++) {
    const muzzle = layout.muzzle.clone().applyQuaternion(quaternion).add(weapon.position);
    const bore = forward.clone().applyQuaternion(quaternion);
    quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(bore, target.clone().sub(muzzle).normalize()));
  }
  return quaternion;
}

export function createGunHandling() {
  let kind, pitch = 0, yaw = 0, travel = 0, side = 1, braced = false, brace = 0, needsRelease = false;
  let missingFor = 0;
  const assist = new THREE.Quaternion();
  const solved = new THREE.Quaternion();

  function reset(weapon, waitForRelease = false) {
    kind = weapon;
    pitch = yaw = travel = brace = 0;
    side = 1;
    braced = false;
    needsRelease = waitForRelease;
    missingFor = 0;
    assist.identity();
    solved.identity();
  }

  function decay(dt) {
    return kind ? Math.exp(-dt / recoilTuning[kind].recovery) : 1;
  }

  function advance(dt) {
    const recover = decay(dt);
    pitch *= recover;
    yaw *= recover;
    travel *= recover;
  }

  function kick(leftHanded) {
    const tuning = recoilTuning[kind];
    const stability = braced ? .39 : 1;
    side *= -1;
    pitch = Math.min(17 * degrees, pitch + tuning.pitch * degrees * stability);
    yaw += side * (leftHanded ? -1 : 1) * tuning.yaw * degrees * stability;
    travel = Math.min(.08, travel + tuning.travel * stability);
  }

  function supportPosition(layout, leftHanded) {
    const socket = layout.support.clone();
    socket.x *= leftHanded ? 1 : -1;
    return socket;
  }

  function calibrated(weapon, settings) {
    return weapon.quaternion.clone().multiply(rotation(settings.gunPitch * degrees, settings.gunYaw * degrees));
  }

  function updateBrace(kindNow, tracking, layout, settings, enabled, held = false, dt = 0) {
    if (kind !== kindNow) {
      reset(kindNow, kind !== undefined && held !== false);
    }
    if (held === false) needsRelease = false;
    const { weapon, lamp } = tracking;
    if (!enabled || !weapon) {
      if (held !== false) needsRelease = true;
      braced = false;
      brace = 0;
      missingFor = 0;
      assist.identity();
      return;
    }
    const tracked = lamp && held === true;
    if (braced && !tracked && held !== false) {
      missingFor += dt;
      if (missingFor + 1e-8 < trackingGrace) return;
      needsRelease = true;
    }
    missingFor = 0;
    const offset = supportPosition(layout, settings.leftHanded);
    const base = calibrated(weapon, settings);
    const inverse = base.clone().invert();
    const delta = tracked ? lamp.position.clone().sub(weapon.position) : null;
    const wasBraced = braced;
    braced = Boolean(!needsRelease && delta &&
      (wasBraced || delta.distanceTo(offset.clone().applyQuaternion(base)) <= grabDistance));
    const blend = 1 - Math.exp(-dt / steerTime);
    if (!braced) {
      brace = THREE.MathUtils.damp(brace, 0, 21, dt);
      assist.slerp(fixedReference, blend);
      return;
    }

    brace = 1;
    if (foregripGuns.has(kind)) {
      // Store the aim in tracking space so a rig snap turn also rotates the filtered aim.
      if (!wasBraced) solved.copy(base).multiply(assist);
      if (delta.lengthSq() >= .10 ** 2) {
        const restingGrip = offset.normalize().applyQuaternion(base);
        const target = new THREE.Quaternion().setFromUnitVectors(restingGrip, delta.normalize())
          .multiply(base);
        solved.slerp(target, blend);
      }
      assist.copy(solved).premultiply(inverse);
    } else {
      const lever = Math.max(.20, Math.abs(offset.z));
      const deviation = delta.applyQuaternion(inverse).sub(offset);
      const limit = 13 * degrees;
      assist.slerp(rotation(THREE.MathUtils.clamp(deviation.y / lever, -limit, limit) * .7,
        THREE.MathUtils.clamp(-deviation.x / lever, -limit, limit) * .7), blend);
    }
  }

  function resolve(tracking, layout, view, settings, stereo, preview = false, lead = 0,
      reference = fixedReference, pumpTravel = 0) {
    if (!tracking.weapon) return tracking;
    const weapon = { position: tracking.weapon.position.clone(), quaternion: tracking.weapon.quaternion.clone() };
    const recover = decay(lead);
    if (stereo) {
      if (braced && foregripGuns.has(kind) && !preview) weapon.quaternion.copy(reference).multiply(solved);
      else {
        weapon.quaternion.copy(calibrated(tracking.weapon, settings));
        if (!preview) weapon.quaternion.multiply(assist);
      }
    } else {
      weapon.quaternion.copy(towardCrosshair(weapon, layout, view));
    }
    if (!preview) {
      weapon.position.addScaledVector(forward.clone().applyQuaternion(weapon.quaternion), -travel * recover);
      weapon.quaternion.multiply(rotation(pitch * recover, yaw * recover));
    }
    if (!stereo || brace < .002 || preview || (!tracking.lamp && !braced))
      return { ...tracking, weapon, gunKick: preview ? 0 : travel * recover };

    const socket = supportPosition(layout, settings.leftHanded);
    socket.z += pumpTravel;
    const hand = socket.clone().applyQuaternion(weapon.quaternion).add(weapon.position);
    const free = tracking.lamp;
    const support = {
      position: free ? free.position.clone().lerp(hand, brace) : hand,
      quaternion: free ? free.quaternion.clone().slerp(weapon.quaternion, brace) : weapon.quaternion,
    };
    socket.x += settings.leftHanded ? .045 : -.045;
    socket.y -= .045;
    const dock = socket.applyQuaternion(weapon.quaternion).add(weapon.position);
    return {
      weapon, support, brace, gunKick: travel * recover,
      lamp: { position: free ? free.position.clone().lerp(dock, brace) : dock, quaternion: support.quaternion },
    };
  }

  return { reset, advance, kick, updateBrace, resolve, get braced() { return braced; } };
}
