import * as THREE from 'three';
import {
  BUILD, createRun, GUNS, inspectFlashlights, LOOT, resolvePlayerBeam, STEP, stepRun, traceAim,
} from './simulation.js';
import { createPresentation, loadArt } from './presentation.js';
import { clamp } from './world.js';
import { createAudio } from './audio.js';
import { createXR } from './xr.js';
import { formatTime, initials, listScores, loadSettings, rapidSeed, recordRun, saveSettings } from './records.js';
import { createGunHandling, gunAngle, heldPose, mountedAim, shotgunPumpTravel, toolLayouts } from './held-tools.js';
import { DIFFICULTIES, MODES } from './difficulty.js';
import { drawFieldMapAndInventory } from './map-ui.js';

const $ = id => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const showPerformance = qs.has('perf');
const ESCAPE_REPLY = 'Perimeter exit breached. You made it out of the labyrinth alive.';
const touch = matchMedia('(pointer: coarse)').matches;
const settings = loadSettings();
const held = new Set(), queued = {};
const audio = createAudio();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(69, innerWidth / innerHeight, 0.044, 125);
camera.rotation.order = 'YXZ';
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.4));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.07;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(0.91);
renderer.xr.setFoveation(1);
$('world').appendChild(renderer.domElement);
const canvas = renderer.domElement;
canvas.tabIndex = -1;
const xr = createXR(renderer, scene, rig);

const art = await loadArt(false);
const layouts = toolLayouts(art);
const presentation = createPresentation(scene, art, layouts);
const handling = createGunHandling();
$('start').disabled = false;
$('start').textContent = touch ? 'Start on this screen' : 'Enter the Labyrinth';
$('build').textContent = 'BUILD ' + BUILD;
$('status').textContent = '';
void xr.supported().then(ok => {
  $('vr').disabled = !ok;
  if (!ok) $('vr').title = 'Immersive VR is available in compatible headset browsers';
});

let phase = 'menu', run = createRun('last-night', { populate: false }), runId = '';
let resultNote = '', deathMessage = '', pauseReason = '';
let yaw = 0.20, pitch = -0.026, roomX = 0, roomZ = 0;
let joystick = { x: 0, y: 0 }, desktopFire = false, touchFire = false, inspectDrag = false, dragDistance = 0;
let lastTime, accumulator = 0, hudAt = -1;
let notice = '', noticeUntil = 0, deflectHintAt = -5, headTrackedAt = 0, deathAt = 0, replyUntil = 0, panelKey = '', useMouseDrag = false;
let quality = 3, perfElapsed = 0, perfFrames = 0, stableWindows = 0, missed = 0, maxFrame = 0, perfSample = null;
const perfTimes = [];
let aimHit = null, shotgunFiredAt = -Infinity, calibrating = false, mapMode = false;
const direction0 = new THREE.Vector3(0, 0, -1);
const vertical = new THREE.Vector3(0, 1, 0);
const text = (id, value) => { $(id).textContent = value; };
const objective = 'Use your flashlight & gunfire carefully. Headshot zombies or escape the perimeter EXIT.';

function clearInput() {
  held.clear();
  for (const action of Object.keys(queued)) delete queued[action];
  desktopFire = touchFire = inspectDrag = false;
  joystick = { x: 0, y: 0 };
  roomX = roomZ = accumulator = 0;
  $('stick').firstElementChild.style.transform = '';
}

function renderMapOverlay() {
  const mapCanvas = $('field-map-canvas');
  const ctx = mapCanvas.getContext('2d');
  drawFieldMapAndInventory(ctx, mapCanvas.width, mapCanvas.height, run);
}

function setPhase(next) {
  phase = next;
  calibrating = false;
  if (next !== 'paused') mapMode = false;
  handling.reset(run.player.weapon, !!xr.active);
  panelKey = '';
  const running = phase === 'playing', inspecting = phase === 'inspect', isXR = !!xr.active;
  document.body.classList.toggle('running', running);
  document.body.classList.toggle('inspecting', inspecting);
  document.body.classList.toggle('extracting', phase === 'extracting');
  $('shell').hidden = phase !== 'menu';
  $('hud').hidden = !running || isXR;
  $('touch').hidden = !(running || inspecting) || !touch || isXR;
  $('death-view').hidden = !inspecting || isXR;
  $('radio-reply').hidden = phase !== 'extracting' || isXR;
  $('pause').hidden = phase !== 'paused' || mapMode;
  $('inventory-modal').hidden = !(phase === 'paused' && mapMode);
  $('results').hidden = phase !== 'results';
  if (phase === 'paused' && mapMode && !isXR) renderMapOverlay();
  clearInput();
  audio.setPaused(!running);
}

function setNotice(message, duration = 2.6) {
  notice = message;
  noticeUntil = run.time + duration;
}

function pointerLock() {
  if (touch || xr.active || document.pointerLockElement === canvas) return;
  try {
    const request = canvas.requestPointerLock?.();
    request?.catch?.(() => {
      useMouseDrag = true;
      setNotice(run.time < 5 ? objective + ' · Drag to look' : 'Click and drag to look', 5);
    });
    if (!canvas.requestPointerLock) useMouseDrag = true;
  } catch { useMouseDrag = true; }
}

function start(seed = rapidSeed()) {
  useMouseDrag = false;
  run = createRun(seed, { difficulty: settings.difficulty, mode: settings.mode, populate: true });
  yaw = pitch = roomX = roomZ = 0;
  runId = rapidSeed();
  shotgunFiredAt = -Infinity;
  notice = '';
  deflectHintAt = -5;
  hudAt = -1;
  quality = 3;
  perfElapsed = perfFrames = stableWindows = missed = maxFrame = 0;
  perfTimes.length = 0;
  perfSample = null;
  presentation.setQuality(quality);
  audio.reset();
  void audio.unlock();
  setPhase('playing');
  if (!xr.active) pointerLock();
  setNotice(objective, 5.5);
  updateHUD(true);
}

function rematch() {
  start(run.seed);
}

function pause(reason = 'The run is paused.', showMap = false) {
  if (phase !== 'playing' && phase !== 'paused') return;
  pauseReason = reason;
  mapMode = showMap;
  text('pause-note', reason);
  setPhase('paused');
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function openMapView() {
  if (phase === 'playing') {
    pause('Checking field map & inventory.', true);
  } else if (phase === 'paused') {
    mapMode = !mapMode;
    panelKey = '';
    $('pause').hidden = mapMode;
    $('inventory-modal').hidden = !mapMode;
    if (mapMode && !xr.active) renderMapOverlay();
  }
}

function resume() {
  if (phase !== 'paused') return;
  mapMode = false;
  setPhase('playing');
  void audio.unlock();
  pointerLock();
}

function showHome() {
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  yaw = 0.20; pitch = -0.026;
  run = createRun('last-night', { populate: false });
  setPhase('menu');
  showPanel('home');
}

function resultScore() {
  const outcome = recordRun(run, runId, settings.initials);
  const rank = outcome.saved && outcome.place ? 'Local rank ' + outcome.place + ' · ' : '';
  resultNote = DIFFICULTIES[run.difficulty].name + ' · ' + rank + 'Seed ' + run.seed;
  text('result-storage', resultNote);
}

function inspectDeath() {
  if (phase !== 'playing') return;
  deathAt = performance.now();
  const { kind, yaw: angle } = run.death;
  const bearing = Math.abs(angle) < 0.60 ? 'ahead' : Math.abs(angle) > 2.35 ? 'behind you' : angle < 0 ? 'on your left' : 'on your right';
  deathMessage = 'A ' + kind + ' caught you ' + (bearing === 'ahead' ? 'from ahead' : bearing) + '.';
  fillResults('The light went out.', deathMessage, false);
  $('result-initials').value = settings.initials;
  resultScore();
  const p = run.player;
  p.battery = 1;
  p.flashlight = true;
  text('death-view-reason', deathMessage);
  text('death-view-controls', touch ? 'Drag to look · Aim with light controls' : 'Drag to look · F / Q for light · Esc for results');
  lookAround();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function fillResults(title, description, escaped) {
  text('results-title', title);
  text('result-eyebrow', escaped ? 'ESCAPED THE LABYRINTH' : 'LOST IN THE DARK');
  text('death-reason', description);
  text('result-time-label', escaped ? 'ESCAPE TIME' : 'SURVIVED');
  text('result-time', formatTime(run.time));
  text('result-kills', run.player.kills);
  text('result-parts', run.metrics.shots);
  $('look-around').hidden = escaped;
  $('result-initials').parentElement.hidden = false;
}

function inspectEscape() {
  replyUntil = performance.now() + 2600;
  deathAt = 0;
  resultScore();
  text('radio-reply', ESCAPE_REPLY);
  fillResults('Escaped', ESCAPE_REPLY, true);
  setPhase('extracting');
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function lookAround() {
  setPhase('inspect');
  if (!xr.active) $('show-results').focus();
}

function openResults() {
  setPhase('results');
  if (!xr.active) $('restart').focus();
}

function showPanel(id) {
  for (const panel of ['home', 'help', 'controls', 'scores', 'settings']) $(panel).hidden = panel !== id;
  $('shell').scrollTop = 0;
  if (id === 'help') $('help-title').focus({ preventScroll: true });
  if (id === 'scores') {
    $('score-difficulty').value = settings.difficulty;
    showScores();
  }
}

function showScores() {
  const target = $('score-table'), items = listScores($('score-difficulty').value);
  target.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'note';
    empty.textContent = 'Finish a run to post the first score on this device.';
    target.append(empty);
    return;
  }
  const table = document.createElement('table');
  table.className = 'records';
  const headings = table.createTHead().insertRow();
  for (const name of ['#', 'Player', 'Outcome', 'Time', 'Kills']) {
    const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = name; headings.append(cell);
  }
  const body = table.createTBody();
  for (const [i, row] of items.entries()) {
    const tr = body.insertRow();
    for (const part of [i + 1, row.initials, row.escaped ? 'Escaped' : 'Fallen', formatTime(row.time), row.kills]) {
      tr.insertCell().textContent = part;
    }
  }
  target.append(table);
}

const difficultyOptions = Object.entries(DIFFICULTIES).map(([value, level]) => [value, level.name]);
const diffSelect = $('difficulty');
diffSelect.replaceChildren(...difficultyOptions.map(([value, label]) => new Option(label, value)));
diffSelect.value = settings.difficulty;
diffSelect.addEventListener('change', () => {
  settings.difficulty = difficultyOptions[diffSelect.selectedIndex][0];
  panelKey = '';
  saveSettings(settings);
});
const modeOptions = Object.entries(MODES).map(([value, spec]) => [value, spec.name]);
const modeSelect = $('mode');
modeSelect.replaceChildren(...modeOptions.map(([value, label]) => new Option(label, value)));
modeSelect.value = settings.mode;
modeSelect.addEventListener('change', () => {
  settings.mode = modeOptions[modeSelect.selectedIndex][0];
  panelKey = '';
  saveSettings(settings);
});
$('score-difficulty').replaceChildren(...difficultyOptions.map(([value, label]) => new Option(label, value)));
$('score-difficulty').addEventListener('change', showScores);

function cycleDifficulty() {
  const index = difficultyOptions.findIndex(([value]) => value === settings.difficulty);
  settings.difficulty = difficultyOptions[(index + 1) % difficultyOptions.length][0];
  diffSelect.value = settings.difficulty;
  panelKey = '';
  saveSettings(settings);
}

function cycleMode() {
  const index = modeOptions.findIndex(([value]) => value === settings.mode);
  settings.mode = modeOptions[(index + 1) % modeOptions.length][0];
  modeSelect.value = settings.mode;
  panelKey = '';
  saveSettings(settings);
}

for (const btn of document.querySelectorAll('[data-panel]')) btn.addEventListener('click', () => showPanel(btn.dataset.panel));
for (const btn of document.querySelectorAll('[data-back]')) btn.addEventListener('click', () => showPanel('home'));
for (const field of document.querySelectorAll('[data-setting]')) {
  const key = field.dataset.setting;
  if (field.type === 'checkbox') field.checked = settings[key]; else field.value = settings[key];
  field.addEventListener('input', () => {
    settings[key] = field.type === 'checkbox' ? field.checked : Number(field.value);
    saveSettings(settings);
    if (key === 'volume') audio.setVolume(settings.volume);
  });
}

function updateGunSettings(pitchDeg, yawDeg) {
  settings.gunPitch = gunAngle(pitchDeg);
  settings.gunYaw = gunAngle(yawDeg);
  for (const field of document.querySelectorAll('[data-angle]')) {
    const value = settings[field.dataset.angle];
    field.value = value;
    text(field.dataset.angle + '-value', value + '°');
  }
  $('sight-preview').style.transform = 'translate(' + -settings.gunYaw * 1.7 + 'px,' + -settings.gunPitch * 1.25 + 'px)';
  saveSettings(settings);
}
updateGunSettings(settings.gunPitch, settings.gunYaw);
for (const field of document.querySelectorAll('[data-angle]')) {
  field.addEventListener('input', () => {
    const values = { ...settings, [field.dataset.angle]: Number(field.value) };
    updateGunSettings(values.gunPitch, values.gunYaw);
  });
}
$('gun-angle-reset').addEventListener('click', () => updateGunSettings(0, 0));
audio.setVolume(settings.volume);
$('initials').value = settings.initials;
$('initials').addEventListener('change', event => {
  settings.initials = event.target.value = initials(event.target.value);
  saveSettings(settings);
});
$('result-initials').addEventListener('change', event => {
  settings.initials = event.target.value = initials(event.target.value);
  $('initials').value = settings.initials;
  saveSettings(settings);
  resultScore();
});

$('start').addEventListener('click', () => start());
$('resume').addEventListener('click', resume);
$('open-map').addEventListener('click', openMapView);
$('close-map').addEventListener('click', resume);
$('map-to-pause').addEventListener('click', () => pause('The run is paused.', false));
$('quit').addEventListener('click', showHome);
$('result-home').addEventListener('click', showHome);
$('show-results').addEventListener('click', openResults);
$('look-around').addEventListener('click', lookAround);
$('restart').addEventListener('click', () => start());
$('rematch').addEventListener('click', rematch);
$('vr').addEventListener('click', async () => {
  try {
    const session = xr.enter(state => { if (state !== 'visible') pause('Headset focus was interrupted.'); });
    void audio.unlock();
    await session;
  } catch (error) {
    text('status', 'VR could not start. Reopen this page in Quest Browser and try again.');
    console.warn('WebXR session:', error);
  }
});

renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('xr');
  xr.reset();
  headTrackedAt = performance.now();
  showHome();
});
renderer.xr.addEventListener('sessionend', () => {
  xr.finish();
  document.body.classList.remove('xr');
  showHome();
});

const keyboard = { KeyR: 'reload', Tab: 'cycleWeapon', KeyF: 'toggleLight', KeyQ: 'toggleBeam', KeyE: 'interact', Space: 'fire' };
document.addEventListener('keydown', event => {
  if (event.target.matches?.('input, textarea')) return;
  if (phase === 'playing') {
    held.add(event.code);
    if (keyboard[event.code] && !event.repeat) queued[keyboard[event.code]] = true;
    if (event.code === 'Escape') pause();
    if ((event.code === 'KeyM' || event.code === 'KeyI') && !event.repeat) openMapView();
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
  } else if (phase === 'inspect' && !event.repeat) {
    if (event.code === 'Escape' || event.code === 'Enter') {
      event.preventDefault();
      openResults();
    } else if (event.code === 'KeyF' || event.code === 'KeyQ') {
      inspectFlashlights(run, { [keyboard[event.code]]: true });
    }
  } else if (phase === 'paused' && !event.repeat) {
    if (event.code === 'Escape') resume();
    else if (event.code === 'KeyM' || event.code === 'KeyI') {
      if (mapMode) resume(); else openMapView();
    }
  } else if (phase === 'results' && event.code === 'Enter' && event.target.tagName !== 'BUTTON') start();
});
document.addEventListener('keyup', e => held.delete(e.code));
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) useMouseDrag = false;
  else if (phase === 'playing' && !touch && !xr.active && !useMouseDrag) pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && !xr.active && phase === 'playing') pause('The game window lost focus.');
});
window.addEventListener('blur', () => {
  clearInput();
  if (!xr.active && phase === 'playing') pause('The game window lost focus.');
});

function look(dx, dy, sensitivity = 0.00215) {
  yaw += dx * sensitivity;
  pitch = clamp(pitch - dy * sensitivity, -1.35, 1.35);
}

canvas.addEventListener('pointerdown', e => {
  if (xr.active || touch || e.button !== 0) return;
  if (phase === 'inspect') { inspectDrag = true; return; }
  if (phase !== 'playing') return;
  if (!useMouseDrag && document.pointerLockElement !== canvas) {
    pointerLock();
    return;
  }
  desktopFire = true;
  dragDistance = 0;
  if (!useMouseDrag) queued.fire = true;
});
document.addEventListener('pointerup', e => {
  if (e.button !== 0) return;
  if (phase === 'playing' && useMouseDrag && desktopFire && dragDistance < 7) queued.fire = true;
  desktopFire = false;
  inspectDrag = false;
});
document.addEventListener('mousemove', e => {
  if (phase === 'playing' && (document.pointerLockElement === canvas || (useMouseDrag && desktopFire))) {
    dragDistance += Math.hypot(e.movementX, e.movementY);
    look(e.movementX, e.movementY);
  } else if (phase === 'inspect' && inspectDrag) look(e.movementX, e.movementY);
});

let stickPointer = null, lookPointer = null, lastTouch = null;
const stick = $('stick'), pad = $('look-pad');
function moveStick(e) {
  const rect = stick.getBoundingClientRect();
  const x = (e.clientX - rect.x - rect.width / 2) / (rect.width * 0.40);
  const y = (e.clientY - rect.y - rect.height / 2) / (rect.height * 0.40);
  const mag = Math.max(1, Math.hypot(x, y));
  joystick = { x: x / mag, y: y / mag };
  stick.firstElementChild.style.transform = 'translate(' + joystick.x * 27 + 'px,' + joystick.y * 27 + 'px)';
}
stick.addEventListener('pointerdown', e => { stickPointer = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); });
stick.addEventListener('pointermove', e => { if (e.pointerId === stickPointer) moveStick(e); });
stick.addEventListener('lostpointercapture', () => {
  stickPointer = null;
  joystick = { x: 0, y: 0 };
  stick.firstElementChild.style.transform = '';
});
pad.addEventListener('pointerdown', e => {
  if (lookPointer !== null) return;
  lookPointer = e.pointerId; pad.setPointerCapture(e.pointerId); lastTouch = { x: e.clientX, y: e.clientY };
});
pad.addEventListener('pointermove', e => {
  if (e.pointerId !== lookPointer || !lastTouch) return;
  look(e.clientX - lastTouch.x, e.clientY - lastTouch.y, 0.0044);
  lastTouch = { x: e.clientX, y: e.clientY };
});
pad.addEventListener('lostpointercapture', () => { lookPointer = null; });
for (const btn of document.querySelectorAll('[data-touch]')) {
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    const action = btn.dataset.touch;
    if (phase === 'inspect') inspectFlashlights(run, { [action]: true });
    else if (action === 'pause') pause();
    else if (action === 'openMap') openMapView();
    else queued[action] = true;
  });
}
$('touch-fire').addEventListener('pointerdown', e => {
  e.preventDefault();
  e.currentTarget.setPointerCapture(e.pointerId);
  touchFire = true; queued.fire = true;
});
$('touch-fire').addEventListener('lostpointercapture', () => { touchFire = false; });

function desktopView() {
  const p = run.player;
  rig.rotation.set(0, 0, 0);
  rig.position.set(p.x, p.y, p.z);
  camera.position.set(0, 1.63, 0);
  camera.rotation.set(pitch, -yaw, 0);
  camera.updateWorldMatrix(true, false);
  const view = { position: camera.getWorldPosition(new THREE.Vector3()), quaternion: camera.getWorldQuaternion(new THREE.Quaternion()) };
  const sign = settings.leftHanded ? -1 : 1;
  const hold = (x, y, z, a, b) => ({
    position: camera.localToWorld(new THREE.Vector3(x, y, z)),
    quaternion: view.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(a, b, 0))),
  });
  const span = touch ? 0.19 : 0.236;
  const long = p.weapon === 'shotgun' || p.weapon === 'carbine' ? -0.63 : -0.48;
  return { view, tracking: {
    weapon: hold(sign * span, -0.323, long, 0.037, sign * 0.085),
    lamp: hold(-sign * (span + 0.009), -0.264, -0.435, -0.037, -sign * 0.072),
  } };
}

function trackedView(stereo, lead = 0) {
  const p = run.player, view = stereo ? xr.sync(p) : desktopView();
  const kind = p.weapon, layout = layouts[kind];
  view.tracking.weapon = heldPose(view.tracking.weapon, stereo);
  view.tracking.lamp = heldPose(view.tracking.lamp, stereo);
  const pumpTravel = kind === 'shotgun' && !calibrating
    ? shotgunPumpTravel(run.time + lead - shotgunFiredAt, p.reload) : 0;
  view.tracking = handling.resolve(view.tracking, layout, view.view, settings, stereo, calibrating,
    lead, rig.quaternion, pumpTravel);
  view.tracking.pumpTravel = pumpTravel;
  view.aim = mountedAim(view.tracking.weapon, layout, view.view);
  view.beam = mountedAim(view.tracking.lamp, layouts.flashlight, view.view);
  return view;
}

function desktopInput() {
  const x = Number(held.has('KeyD') || held.has('ArrowRight')) - Number(held.has('KeyA') || held.has('ArrowLeft')) + joystick.x;
  const y = Number(held.has('KeyS') || held.has('ArrowDown')) - Number(held.has('KeyW') || held.has('ArrowUp')) + joystick.y;
  return {
    yaw, pitch, moveX: Math.cos(yaw) * x - Math.sin(yaw) * y,
    moveZ: Math.sin(yaw) * x + Math.cos(yaw) * y,
    walk: held.has('ShiftLeft') || held.has('ShiftRight') || (touch && Math.hypot(joystick.x, joystick.y) < 0.48),
    fireHeld: (!useMouseDrag && desktopFire) || touchFire || held.has('Space'),
  };
}

function handleEvent(batch) {
  audio.events(batch, run);
  presentation.events(batch);
  for (const event of batch) {
    if (event.type === 'dry') {
      setNotice(event.reason, 1.4);
      xr.haptic('dry', settings);
    } else if (event.type === 'pickup') setNotice(event.message, 3.0);
    else if (event.type === 'extraction') inspectEscape();
    else if (event.type === 'weaponSwitch') setNotice(GUNS[event.weapon].name, 1.25);
    else if (event.type === 'light' && event.empty) setNotice('Battery depleted. Recharging.', 2.2);
    else if (event.type === 'hazardStep') {
      xr.haptic('hazardStep', settings);
      setNotice(event.quiet ? `Brushed ${event.kind}` : `Stepped in ${event.kind}!`, 1.1);
    } else if (event.type === 'wallBump') {
      xr.haptic('wallBump', settings);
    } else if (event.type === 'spray') {
      xr.haptic('spray', settings);
    } else if (event.type === 'shot') {
      if (event.weapon === 'shotgun') shotgunFiredAt = run.time;
      handling.kick(settings.leftHanded);
      xr.haptic(event.weapon, settings, handling.braced, false);
    } else if (event.type === 'armorHit') {
      xr.haptic('armor', settings);
      setNotice(event.armor ? 'Armor took the hit' : 'Armor broke');
    } else if (event.type === 'death') inspectDeath();
  }
}

function perfReport() {
  if (!showPerformance || !perfSample) return '';
  return perfSample.fps + ' FPS · P95 ' + perfSample.p95Ms + ' ms · ' + Math.round(perfSample.missed * 100)
    + '% missed · active ' + perfSample.active;
}

function updateHUD(force = false) {
  if (!force && run.time < hudAt) return;
  hudAt = run.time + 0.07;
  const p = run.player, display = Math.ceil(p.battery * 100);
  text('clock', formatTime(run.time));
  text('hud-parts', `${DIFFICULTIES[run.difficulty].name.toUpperCase()} · ${MODES[run.mode].name.toUpperCase()}`);
  text('weapon-name', GUNS[p.weapon].name.toUpperCase());
  const rounds = count => String(count).padStart(2, '0');
  if (GUNS[p.weapon].spray) {
    $('rounds').firstChild.textContent = 'PAINT ';
    $('rounds').lastChild.textContent = '∞';
  } else {
    $('rounds').firstChild.textContent = rounds(p.ammo) + ' ';
    $('rounds').lastChild.textContent = '/ ' + (run.noLight ? '∞' : p.reserve);
  }
  const light = run.noLight ? 'NO LIGHT MODE · ∞ AMMO' : (p.flashlight ? p.beam.toUpperCase() : 'RECHARGING') + ' · ' + display + '%';
  text('light-text', light);
  $('charge').style.transform = 'scaleX(' + (run.noLight ? 0 : p.battery) + ')';
  text('armor', '◆'.repeat(p.armor) + '◇'.repeat(Math.max(0, 1 - p.armor)));
  $('armor').setAttribute('aria-label', p.armor + ' armor charges');
  text('notice', run.time < noticeUntil ? notice : perfReport());
  $('offer').hidden = !run.offer;
  if (run.offer) {
    text('offer', (touch ? 'EQUIP' : 'E TO EQUIP') + ' · ' + LOOT[run.offer.kind].name);
  }
  const reload = p.reload;
  $('reload-meter').hidden = !reload;
  $('touch-cycle').disabled = Object.keys(p.magazines).length < 2;
  if (touch) text('touch-interact', 'Equip');
  if (reload) $('reload-progress').style.transform = 'scaleX(' + (1 - reload.left / reload.duration) + ')';
}

function xrUI(sample, trackedView) {
  if (!xr.active || !sample || !trackedView.view) {
    xr.drawAimPreview(null);
    return;
  }
  if (phase === 'inspect' || phase === 'extracting') {
    xr.hidePanel();
    xr.drawAimPreview(null);
    xr.drawPrompt(phase === 'inspect' ? 'A · RESULTS' : ESCAPE_REPLY, trackedView.view);
    return;
  }
  if (phase === 'playing') {
    xr.hidePanel();
    const target = run.offer && 'GRIP  ·  ' + LOOT[run.offer.kind].name;
    xr.drawPrompt(target || (run.time < noticeUntil ? notice : perfReport()), trackedView.view);
    return;
  }
  xr.drawPrompt('', trackedView.view);
  if (phase === 'paused' && mapMode && !calibrating) {
    const key = `status:${run.player.weapon}:${run.player.ammo}:${run.player.reserve}:${run.player.kills}`;
    if (panelKey !== key) {
      panelKey = key;
      xr.drawMapPanel(run, trackedView.view, 'TRIGGER  ·  RESUME', 'B  ·  PAUSE MENU');
    }
    xr.drawAimPreview(null);
    return;
  }
  const key = calibrating ? 'angle:' + settings.gunPitch + ':' + settings.gunYaw : phase + ':' + sample.tracked + ':' + settings.difficulty + ':' + settings.mode;
  if (panelKey !== key) {
    panelKey = key;
    const cards = {
      menu: {
        title: 'The Last Night',
        lines: [
          'Difficulty: ' + DIFFICULTIES[settings.difficulty].name + ' (X)   |   Mode: ' + MODES[settings.mode].name + ' (B)',
          settings.mode === 'noLight'
            ? 'No Light Mode: No flashlight, infinite bullets—gunfire flash is your only light.'
            : 'Flashlight Mode: Fixed 30s flashlight + scarce ammo. Toggle Spray Can (B) to mark walls.',
          'Headshots kill regulars (2-3 body). Brutes take 3 head / 6 body. Zombies ambush from behind!',
          'Reach the single perimeter EXIT while avoiding noise traps.',
        ],
        hint: sample.tracked ? 'WEAPON TRIGGER  ·  START' : 'CONNECT BOTH CONTROLLERS',
        second: 'A  ·  GUN ANGLE',
      },
      paused: {
        title: 'Paused',
        lines: [
          pauseReason,
          `Kills: ${run.player.kills}   ·   Ammo: ${run.player.ammo}/${run.noLight ? '∞' : run.player.reserve}   ·   ${MODES[run.mode].name}`,
        ],
        hint: sample.weaponTracked ? 'TRIGGER  ·  RESUME' : 'CONNECT WEAPON CONTROLLER',
        second: 'B  ·  SURVIVAL KIT      A  ·  GUN ANGLE',
      },
      angle: {
        title: 'Gun Angle',
        lines: [
          'Aim at this panel to see where the barrel points.',
          'Weapon stick adjusts pitch and yaw by 1°.',
          'Pitch ' + settings.gunPitch + '°    /    Yaw ' + settings.gunYaw + '°',
        ],
        hint: 'TRIGGER  ·  DONE',
        second: 'WEAPON GRIP  ·  RESET TO DEFAULT',
      },
      results: {
        title: run.status === 'escaped' ? 'Escaped' : 'Lost in the dark.',
        lines: [
          run.status === 'escaped' ? ESCAPE_REPLY : deathMessage,
          formatTime(run.time) + (run.status === 'escaped' ? ' escape time' : ' survived') + '   /   ' + run.player.kills + ' kills',
          `${resultNote}`,
        ],
        hint: 'TRIGGER  ·  NEW RUN',
        second: run.status === 'escaped' ? 'GRIP  ·  SAME SEED' : 'GRIP  ·  SAME SEED      A  ·  LOOK AROUND',
      },
    };
    const page = calibrating ? 'angle' : phase;
    xr.drawPanel(page, trackedView.view, cards[page]);
  }
  xr.drawAimPreview(calibrating ? trackedView.aim : null);
}

function measure(wall, stereo) {
  if (phase !== 'playing' || !stereo) return;
  perfElapsed += wall;
  perfFrames++;
  const hz = xr.active?.frameRate || 72, target = 1 / hz;
  if (wall > target * 1.5) missed += Math.max(1, Math.round(wall / target) - 1);
  maxFrame = Math.max(wall, maxFrame);
  perfTimes.push(wall);
  if (perfElapsed < 5) return;
  const fps = perfFrames / perfElapsed, loss = missed / (missed + perfFrames);
  perfTimes.sort((a, b) => a - b);
  const p95Ms = Number((perfTimes[Math.ceil(perfTimes.length * 0.95) - 1] * 1000).toFixed(1));
  perfSample = { fps: Number(fps.toFixed(1)), missed: Number(loss.toFixed(3)), p95Ms, active: run.enemies.length };
  if (loss > 0.075 || fps < hz * 0.91) {
    stableWindows = 0;
    if (quality > 1) presentation.setQuality(--quality);
  } else if (loss < 0.023 && fps >= hz * 0.96) {
    if (++stableWindows > 4 && quality < 3) {
      presentation.setQuality(++quality);
      stableWindows = 0;
    }
  } else stableWindows = 0;
  perfElapsed = perfFrames = missed = maxFrame = 0;
  perfTimes.length = 0;
}

function simulate(t, sample, stereo) {
  accumulator = Math.min(0.22, accumulator + t);
  while (accumulator + 1e-9 >= STEP && phase === 'playing') {
    accumulator -= STEP;
    const state = stereo ? {
      yaw: sample?.yaw, eyeHeight: sample?.eyeHeight,
      fireHeld: sample?.fireHeld, moveX: sample?.moveX, moveZ: sample?.moveZ, walk: sample?.walk,
    } : desktopInput();
    handling.advance(STEP);
    const aimed = trackedView(stereo);
    const input = {
      ...state, ...queued, roomX, roomZ,
      aim: aimed.aim, lamp: aimed.beam,
      weaponUnavailable: stereo && !aimed.aim,
      lampUnavailable: stereo && !aimed.beam,
    };
    roomX = roomZ = 0;
    for (const key of Object.keys(queued)) delete queued[key];
    const weapon = run.player.weapon;
    const batch = stepRun(run, input);
    handleEvent(batch);
    if (weapon !== run.player.weapon) {
      handling.reset(run.player.weapon, stereo && sample?.supportGrip !== false);
    }
  }
}

function frame(now, xrFrame) {
  const elapsed = lastTime === undefined ? 0.016 : Math.min(0.5, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  const stereo = !!xrFrame && !!xr.active;
  if (phase === 'extracting' && performance.now() >= replyUntil) openResults();
  const previous = phase;
  const sample = stereo ? xr.sample(xrFrame, run.player, settings, phase) : null;

  if (stereo) {
    if (sample) {
      headTrackedAt = performance.now();
      if (phase === 'menu' || phase === 'paused') {
        if (calibrating) {
          if (sample.fire || sample.pause) { calibrating = false; panelKey = ''; }
          else if (sample.interact) updateGunSettings(0, 0);
          else if (sample.anglePitch || sample.angleYaw) {
            updateGunSettings(settings.gunPitch + sample.anglePitch, settings.gunYaw + sample.angleYaw);
          }
        } else if (phase === 'menu' && sample.menuDifficulty) cycleDifficulty();
        else if (phase === 'menu' && sample.menuMode) cycleMode();
        else if (phase === 'paused' && sample.toggleMap) openMapView();
        else if (phase === 'paused' && sample.pause) resume();
        else if (sample.reload) { calibrating = true; panelKey = ''; }
        else if (phase === 'menu' && sample.fire && sample.tracked) start();
        else if (phase === 'paused' && sample.fire && sample.weaponTracked) resume();
      } else if (phase === 'inspect') {
        if (sample.reload) openResults();
        else inspectFlashlights(run, sample);
      } else if (phase === 'results') {
        if (sample.reload && run.status === 'dead') lookAround();
        else if (performance.now() - deathAt > 950) {
          if (sample.fire) start();
          else if (sample.interact) rematch();
        }
      } else if (phase === 'playing') {
        if (sample.pause) pause('Survival Kit & Pause', true);
        else if (!sample.weaponTracked && sample.missingFor > 0.5) pause('Weapon controller tracking was lost.');
        else {
          for (const key of ['reload', 'cycleWeapon', 'fire', 'toggleLight', 'toggleBeam', 'interact']) {
            if (sample[key]) queued[key] = true;
          }
          roomX += sample.roomX; roomZ += sample.roomZ;
        }
      }
    } else if (performance.now() - headTrackedAt > 450) pause('Headset tracking was lost.');
  }

  const dt = Math.min(0.09, elapsed);
  measure(elapsed, stereo);
  if (stereo && phase === 'playing') {
    const kind = run.player.weapon;
    const tracking = { weapon: heldPose(sample?.tools.weapon, true), lamp: heldPose(sample?.tools.lamp, true) };
    handling.updateBrace(kind, tracking, layouts[kind], settings, true, sample?.supportGrip ?? null, elapsed);
  }
  if (phase === 'playing' && (!stereo || xr.active.visibilityState === 'visible')) {
    simulate(previous === phase && (!stereo || sample) ? dt : 0, sample, stereo);
  }

  const view = trackedView(stereo, accumulator);
  const active = phase === 'playing', inspecting = phase === 'inspect' || phase === 'extracting', p = run.player;
  const laser = active && settings.laserDot;
  aimHit = laser && !p.reload && view.aim ? traceAim(run, view.aim) : null;
  const lightsActive = (active || inspecting) && p.flashlight;
  const beam = lightsActive ? resolvePlayerBeam(run, view.beam, view.view?.position) : null;

  presentation.update(run, dt, settings, view.tracking, {
    active, inspecting, stereo, calibration: calibrating, menu: phase === 'menu' && !stereo, beam,
    aim: active ? view.aim : null, aimHit,
    viewpoint: view.view?.position,
    enemyAlpha: active ? clamp(accumulator / STEP, 0, 1) : 1,
  });

  if (view.view) {
    audio.listener(view.view.position, direction0.clone().applyQuaternion(view.view.quaternion),
      vertical.clone().applyQuaternion(view.view.quaternion), run);
  }

  if (phase === 'playing' && !stereo) {
    const isSpray = run.player.weapon === 'spraycan';
    const point = view.aim.origin.clone().addScaledVector(view.aim.ray, isSpray ? 4.2 : 27).project(camera);
    $('crosshair').style.left = (point.x + 1) * 50 + '%';
    $('crosshair').style.top = (1 - point.y) * 50 + '%';
    updateHUD();
  }
  xrUI(sample, view);
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(frame);
setPhase('menu');
