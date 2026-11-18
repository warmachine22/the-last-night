import * as THREE from 'three';
import { clamp } from './world.js';
import { drawFieldMapAndInventory } from './map-ui.js';

const forward = new THREE.Vector3(0, 0, -1);
const up = new THREE.Vector3(0, 1, 0);

function vec(p) { return new THREE.Vector3(p.x, p.y, p.z); }
function quat(q) { return new THREE.Quaternion(q.x, q.y, q.z, q.w); }
function poseOf(pose) { return { position: vec(pose.transform.position), quaternion: quat(pose.transform.orientation) }; }
const toolPose = source => source && { ...source.grip, pointer: source.aim?.quaternion };
const button = (gamepad, index) => Boolean(gamepad?.buttons?.[index]?.pressed);
const axis = (gamepad, index) => gamepad?.axes?.[gamepad.axes.length >= 4 ? index + 2 : index] || 0;

export function questButtons(right, left, leftHanded) {
  const weapon = leftHanded ? left : right;
  const light = leftHanded ? right : left;
  return {
    fire: button(weapon, 0), interact: button(weapon, 1),
    reload: button(right, 4), cycleWeapon: button(right, 5),
    toggleLight: button(light, 0),
    toggleBeam: button(left, 4),
    pause: button(left, 5),
    menuDifficulty: button(left, 4),
    menuMode: button(right, 5),
    toggleMap: button(right, 5),
  };
}

export function createXR(renderer, scene, rig) {
  let active = null, offsetYaw = 0, rawView = null, priorView = null, seatedHeight = null;
  let domMode = '', turnHeld = false, recoveredAt = 0, angleHeld = false;
  let edges = {}, sources = {}, baseHeight = 1.63, current = null;
  let changeListener;
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 597;
  const ctx = canvas.getContext('2d');
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.77, 1.032),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, toneMapped: false, depthWrite: false }));
  panel.renderOrder = 1000;
  panel.visible = false;
  const aimMarker = new THREE.Mesh(new THREE.RingGeometry(.009, .014, 20),
    new THREE.MeshBasicMaterial({ color: 0xe7e8a0, toneMapped: false, depthTest: false, depthWrite: false }));
  aimMarker.visible = false;
  aimMarker.renderOrder = panel.renderOrder + 1;
  panel.add(aimMarker);
  scene.add(panel);
  const promptCanvas = document.createElement('canvas'); promptCanvas.width = 640; promptCanvas.height = 96;
  const promptContext = promptCanvas.getContext('2d');
  const promptTexture = new THREE.CanvasTexture(promptCanvas); promptTexture.colorSpace = THREE.SRGBColorSpace;
  const prompt = new THREE.Mesh(new THREE.PlaneGeometry(.82, .123),
    new THREE.MeshBasicMaterial({ map: promptTexture, transparent: true, toneMapped: false, depthWrite: false }));
  scene.add(prompt);
  prompt.visible = false;
  let promptText = '';

  async function supported() {
    return !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  }

  async function enter(onVisibility) {
    const session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor'],
    });
    active = session;
    changeListener = () => onVisibility(session.visibilityState);
    session.addEventListener('visibilitychange', changeListener);
    try {
      await renderer.xr.setSession(session);
    } catch (error) {
      if (active === session) {
        session.removeEventListener('visibilitychange', changeListener);
        active = null;
      }
      await session.end().catch(() => {});
      throw error;
    }
    if (session.supportedFrameRates && Array.from(session.supportedFrameRates).includes(72))
      session.updateTargetFrameRate?.(72).catch(() => {});
  }

  function reset() {
    offsetYaw = 0;
    current = rawView = priorView = null;
    seatedHeight = null;
    domMode = '';
    edges = {}; sources = {};
    angleHeld = false;
    panel.visible = prompt.visible = false;
    recoveredAt = performance.now();
  }

  function finish() {
    active?.removeEventListener('visibilitychange', changeListener);
    active = null;
    reset();
  }

  function controller(frame, reference, source) {
    if (!source) return null;
    const grip = source.gripSpace && frame.getPose(source.gripSpace, reference);
    if (!grip) return null;
    const aim = source.targetRaySpace && frame.getPose(source.targetRaySpace, reference);
    return { grip: poseOf(grip), aim: aim && poseOf(aim), gamepad: source.gamepad };
  }

  function sample(frame, p, settings, phase) {
    if (!frame || !active) return null;
    const reference = renderer.xr.getReferenceSpace();
    const view = reference && frame.getViewerPose(reference);
    if (!view) { current = null; sources = {}; return null; }
    rawView = poseOf(view);
    if (seatedHeight === null) seatedHeight = rawView.position.y;
    baseHeight = clamp(rawView.position.y + (settings.seated ? 1.57 - seatedHeight : 0), .62, 2.25);
    sources = {};
    const supportHand = settings.leftHanded ? 'right' : 'left';
    let supportGrip = null;
    for (const s of active.inputSources) {
      if (s.handedness === 'right' || s.handedness === 'left')
        sources[s.handedness] = controller(frame, reference, s);
      if (s.handedness === supportHand) supportGrip = s.gamepad?.buttons?.[1]?.pressed ?? null;
    }
    const right = sources.right?.gamepad, left = sources.left?.gamepad;
    const gunSource = sources[settings.leftHanded ? 'left' : 'right'];
    const handed = gunSource?.gamepad;
    const gp = questButtons(right, left, settings.leftHanded, Boolean(p.offhand));
    const pressed = {};
    for (const key of Object.keys(gp)) pressed[key] = gp[key] && !edges[key];
    edges = gp;
    const rx = axis(right, 0);
    if ((phase === 'playing' || phase === 'inspect') && Math.abs(rx) > .68 && !turnHeld)
      offsetYaw += Math.sign(rx) * Math.PI / 6;
    turnHeld = Math.abs(rx) > .42;
    const turn = new THREE.Quaternion().setFromAxisAngle(up, -offsetYaw);
    const delta = phase === 'playing' && priorView ? rawView.position.clone().sub(priorView).applyQuaternion(turn) : new THREE.Vector3();
    priorView = rawView.position.clone();
    const yaw = Math.atan2(heading().x, -heading().z);
    const lx = axis(left, 0), ly = axis(left, 1);
    const validMovement = Math.hypot(lx, ly) > .16;
    const moveX = validMovement ? Math.cos(yaw) * lx - Math.sin(yaw) * ly : 0;
    const moveZ = validMovement ? Math.sin(yaw) * lx + Math.cos(yaw) * ly : 0;
    const walk = Math.hypot(lx, ly) < .55;
    const tracked = !!sources.left && !!sources.right;
    const weaponTracked = Boolean(gunSource);
    if (weaponTracked) recoveredAt = performance.now();
    const ax = axis(handed, 0), ay = axis(handed, 1);
    const angleReady = Math.max(Math.abs(ax), Math.abs(ay)) > .68 && !angleHeld;
    angleHeld = Math.max(Math.abs(ax), Math.abs(ay)) > .42;
    current = { ...pressed, fireHeld: gp.fire, yaw, eyeHeight: baseHeight, roomX: delta.x, roomZ: delta.z,
      moveX, moveZ, walk, tracked, weaponTracked, supportGrip,
      tools: { weapon: toolPose(gunSource), lamp: toolPose(sources[supportHand]) },
      angleYaw: angleReady && Math.abs(ax) >= Math.abs(ay) ? -Math.sign(ax) : 0,
      anglePitch: angleReady && Math.abs(ay) > Math.abs(ax) ? -Math.sign(ay) : 0,
      missingFor: (performance.now() - recoveredAt) / 1000 };
    return current;
  }

  function heading() {
    const turn = new THREE.Quaternion().setFromAxisAngle(up, -offsetYaw);
    return rawView ? forward.clone().applyQuaternion(rawView.quaternion).applyQuaternion(turn) : forward.clone();
  }

  function sync(p) {
    if (!rawView) return { tracking: {}, view: null };
    rig.rotation.set(0, -offsetYaw, 0);
    const rotated = rawView.position.clone().applyQuaternion(rig.quaternion);
    rig.position.set(p.x - rotated.x, p.y + baseHeight - rotated.y, p.z - rotated.z);
    rig.updateMatrixWorld(true);
    const asWorld = local => local && ({
      position: rig.localToWorld(local.position.clone()),
      quaternion: rig.quaternion.clone().multiply(local.quaternion),
    });
    const worldTool = local => {
      const pose = asWorld(local);
      if (pose && local.pointer) pose.pointer = rig.quaternion.clone().multiply(local.pointer);
      return pose;
    };
    const weapon = worldTool(current?.tools.weapon);
    const lamp = worldTool(current?.tools.lamp);
    return { tracking: { weapon, lamp }, view: asWorld(rawView) };
  }

  function drawPanel(page, view, { title, lines = [], hint, second }) {
    if (!view) return;
    if (!panel.visible || page !== domMode) {
      const facing = heading(); facing.y = 0; facing.normalize();
      panel.position.copy(view.position).addScaledVector(facing, 1.89);
      panel.position.y -= .01;
      panel.rotation.y = Math.atan2(-facing.x, -facing.z);
      domMode = page;
    }
    panel.visible = true;
    ctx.clearRect(0, 0, 1024, 597);
    ctx.fillStyle = '#141f1eef'; ctx.fillRect(0, 0, 1024, 597);
    ctx.strokeStyle = '#a0aa8d'; ctx.lineWidth = 4; ctx.strokeRect(22, 22, 980, 553);
    ctx.fillStyle = '#bdc8a8'; ctx.font = '27px monospace'; ctx.fillText('THE LAST NIGHT', 70, 89);
    ctx.fillStyle = '#ede8d6'; ctx.font = 'bold 78px sans-serif'; ctx.fillText(title, 64, 198, 885);
    ctx.font = '34px sans-serif';
    lines.slice(0,4).forEach((line, i) => ctx.fillText(line, 70, 278+i*46, 878));
    ctx.fillStyle = '#bdcca0'; ctx.font = 'bold 30px monospace'; ctx.fillText(hint, 70, 494, 878);
    if (second) { ctx.font = '23px monospace'; ctx.fillText(second, 70, 530, 878); }
    map.needsUpdate = true;
  }

  function drawMapPanel(run, view, hint = 'TRIGGER  ·  RESUME', second = 'B  ·  PAUSE MENU') {
    if (!view) return;
    if (!panel.visible || domMode !== 'map') {
      const facing = heading(); facing.y = 0; facing.normalize();
      panel.position.copy(view.position).addScaledVector(facing, 1.89);
      panel.position.y -= .01;
      panel.rotation.y = Math.atan2(-facing.x, -facing.z);
      domMode = 'map';
    }
    panel.visible = true;
    drawFieldMapAndInventory(ctx, 1024, 597, run, hint, second);
    map.needsUpdate = true;
  }

  function drawPrompt(text, view) {
    if (!text || !view) { prompt.visible = false; return; }
    if (text !== promptText) {
      promptText = text;
      promptContext.clearRect(0, 0, 640, 96);
      promptContext.fillStyle = '#18231be7'; promptContext.fillRect(0,0,640,96);
      promptContext.font = 'bold 25px monospace'; promptContext.fillStyle = '#e7e8cf';
      promptContext.textAlign = 'center'; promptContext.fillText(text, 320, 59, 602);
      promptTexture.needsUpdate = true;
    }
    const face = heading().setY(0).normalize();
    prompt.position.copy(view.position).addScaledVector(face, 1.2);
    prompt.position.y -= .48;
    prompt.rotation.y = Math.atan2(-face.x, -face.z);
    prompt.visible = true;
  }

  function drawAimPreview(aim) {
    aimMarker.visible = false;
    if (!aim || !panel.visible) return;
    const local = panel.worldToLocal(aim.origin.clone());
    const ray = aim.ray.clone().applyQuaternion(panel.quaternion.clone().invert());
    if (ray.z >= -.01 || local.z <= 0) return;
    local.addScaledVector(ray, -local.z / ray.z);
    if (Math.abs(local.x) > .865 || Math.abs(local.y) > .495) return;
    aimMarker.position.set(local.x, local.y, .002);
    aimMarker.visible = true;
  }

  function haptic(kind, settings, braced = false, offhand = false) {
    const leftHand = settings.leftHanded !== offhand;
    const s = sources[leftHand ? 'left' : 'right'];
    const strengths = {
      shotgun: [.79, 52], smg: [.37, 22], armor: [.89, 125],
      carbine: [.64, 40], pistol: [.51, 32], spray: [.14, 14], dry: [.18, 16],
      wallBump: [.22, 18], hazardStep: [.30, 24], dotHit: [.42, 26],
    };
    const spec = strengths[kind];
    if (!spec) return;
    const [strength, duration] = spec;
    const pulse = (source, force) => source?.gamepad?.hapticActuators?.[0]?.pulse?.(force, duration)?.catch?.(() => {});
    pulse(s, strength);
    if (braced) pulse(sources[leftHand ? 'right' : 'left'], strength * .43);
  }

  return { supported, enter, reset, finish, sample, sync, drawPanel, drawMapPanel, drawPrompt, drawAimPreview, haptic,
    hidePanel() { panel.visible = false; },
    get active() { return active; },
  };
}
