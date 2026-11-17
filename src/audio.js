import { ENEMIES } from './simulation.js';

const samples = ['pistol', 'shotgun', 'smg', 'pump', 'reload-short', 'reload-smg-short',
  'growl2', 'z1', 'z5', 'z10', 'z14', 'z20', 'zombienoise3', 'fastzombie1', 'radio-reply'];
const voices = {
  shambler: ['growl2', 'z1', 'z5', 'zombienoise3'],
  shrieker: ['fastzombie1', 'z14'],
  brute: ['z20', 'rasp'],
};
const voiceSamples = new Set(Object.values(voices).flat().concat('z10'));
const voiceLevel = { voice: .90, windup: 1.04, shriek: 1.18 };
const voiceWeight = { voice: 1, windup: 1.65, shriek: 1.48 };
const voiceLimit = 8;

export function threatMix(metres, occluded) {
  const distanceGain = 1 / (1 + (Math.max(0, metres - 1.2) / 4.25) ** 1.75);
  const fade = Math.min(1, Math.max(0, (22 - metres) / 5));
  return { gain: distanceGain * fade * (occluded ? .60 : 1), cutoff: occluded ? 1350 : 19000 };
}

export function voicePriority(type, metres) {
  return threatMix(metres, false).gain * voiceWeight[type];
}

function distance3(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

function mouth(zombie) {
  return { x: zombie.x, y: zombie.y + ENEMIES[zombie.kind].height * .84, z: zombie.z };
}

function setPosition(node, position) {
  if (node.positionX) {
    node.positionX.value = position.x;
    node.positionY.value = position.y;
    node.positionZ.value = position.z;
  } else node.setPosition(position.x, position.y, position.z);
}

export function createAudio() {
  const buffers = new Map(), active = new Map();
  let context, master, ambience, threats, weapons, effects, listenerPosition;
  let lastCreak = 0, lastCrow = 18, volume = .76, paused = true, ducked = false;

  async function unlock() {
    if (!context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      context = new Audio();
      master = context.createGain();
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 18;
      limiter.ratio.value = 6;
      limiter.attack.value = .003;
      limiter.release.value = .11;
      master.gain.value = volume;
      master.connect(limiter).connect(context.destination);
      [ambience, threats, weapons, effects] = Array.from({ length: 4 }, () => {
        const bus = context.createGain(); bus.connect(master); return bus;
      });
      ambience.gain.value = paused ? .12 : .46;
      threats.gain.value = paused ? .01 : .94;
      weapons.gain.value = .78;
      effects.gain.value = .47;
      ambienceLoop();
      for (const key of samples) {
        fetch(new URL('./assets/audio/' + key + '.ogg', import.meta.url))
          .then(response => { if (!response.ok) throw Error(key); return response.arrayBuffer(); })
          .then(data => context.decodeAudioData(data))
          .then(data => buffers.set(key, voiceSamples.has(key) ? levelVoice(data) : data))
          .catch(() => {});
      }
      makeSounds();
    }
    if (context.state !== 'running') await context.resume().catch(() => {});
  }

  function levelVoice(input) {
    const samples = input.getChannelData(0);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    if (peak === 0) return input;
    let energy = 0, count = 0;
    for (const sample of samples) {
      if (Math.abs(sample) >= peak * .06) { energy += sample * sample; count++; }
    }
    const gain = Math.min(40, .24 / Math.sqrt(energy / count));
    const result = context.createBuffer(1, input.length, input.sampleRate);
    const output = result.getChannelData(0);
    for (let i = 0; i < output.length; i++) {
      const value = samples[i] * gain, magnitude = Math.abs(value);
      output[i] = magnitude <= .66 ? value : Math.sign(value) * (.66 + .24 * Math.tanh((magnitude - .66) / .24));
    }
    return result;
  }

  function procedural(name, duration, calculate, channels = 1) {
    const count = Math.ceil(context.sampleRate * duration), b = context.createBuffer(channels, count, context.sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const data = b.getChannelData(ch);
      let noise = 0;
      for (let i = 0; i < count; i++) {
        const white = Math.random() * 2 - 1;
        noise = .935 * noise + white * .065;
        data[i] = calculate(i / context.sampleRate, white, noise, ch);
      }
    }
    buffers.set(name, b);
    return b;
  }

  function ambienceLoop() {
    const source = context.createBufferSource();
    source.buffer = procedural('wind', 10, (t, n, smooth, c) =>
      smooth * (.14 + .047 * Math.sin(t * Math.PI * .4 + c)) * Math.min(1, t * 5, (10 - t) * 5) +
      Math.sin(t * Math.PI * 37) * .0065 * (Math.sin(t * Math.PI * .2) ** 2), 2);
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 485;
    source.connect(filter).connect(ambience);
    source.start();
  }

  function makeSounds() {
    procedural('gravel', .26, (t, n, low) => (.55*n + .45*low) * Math.exp(-t * 14)
      * Math.min(1, t * 120) * (.64 + .36*Math.sin(2*Math.PI*38*t)**2));
    procedural('brush', .43, (t, n, low) => (.46*n + .54*low) * Math.exp(-t * 7)
      * Math.min(1, t*110) * (.65 + .35 * Math.sin(2*Math.PI*59*t)**2));
    procedural('creak', .81, (t, n, low) => (Math.sin(2*Math.PI*(76 + 19*t)*t)*.23 + low*.77)
      * Math.sin(Math.PI*t/.81)**3 * (Math.sin(t*36)**2));
    // Distant crow caw: nasal falling two-note call, low in frequency compared to zombie shrieks.
    procedural('caw', .72, (t, n, low) => {
      const pulse = (t < .26 ? Math.sin(Math.PI * t / .26) : t > .36 && t < .66 ? Math.sin(Math.PI * (t - .36) / .30) : 0) ** 1.3;
      const f = 560 - 110 * t;
      const harm = Math.sin(2 * Math.PI * f * t) * .45 + Math.sin(2 * Math.PI * f * 1.5 * t) * .25 + Math.sin(2 * Math.PI * f * 2 * t) * .15;
      return (harm * .72 + low * .35 + n * .05) * pulse * .48;
    });
    procedural('switch', .10, (t, n, low) => (n*.68 + low*.32) * Math.exp(-t*54) * Math.min(1,t*160));
    procedural('flare', .68, (t, n, low) => (n*.74 + low*.26) * .50 * Math.exp(-t*5)
      * Math.min(1,t*74) * (.52 + .48*Math.sin(170*t)**2));
    procedural('flaregun', .42, (t, n, low) => (low * .53 + n * .13) * Math.exp(-t * 28) * Math.min(1, t * 900)
      + (.14 * Math.sin(2 * Math.PI * (290 * t + 565 * t * t)) + .12 * n)
        * Math.sin(Math.PI * t / .42) ** 2);
    procedural('swing', .23, (t, n, low) => (n*.4 + low*.6) * .56 * Math.sin(Math.PI*t/.23)**3);
    procedural('rasp', .88, (t, n, low) => {
      const voice = Math.sin(2 * Math.PI * (77*t + 1.2*Math.sin(8*t))) + .45 * Math.sin(2 * Math.PI * 221*t);
      return (.17 * voice + .80*low + .065*n) * Math.sin(Math.PI*t/.88) ** 1.4 * (.68 + .32*Math.sin(t*43)**2);
    });
    procedural('armor', .33, (t, n) => (.43 * Math.sin(2*Math.PI*91*t) + n*.57)
      * Math.exp(-t*22) * Math.min(1,t*90));
    procedural('fallback', .42, (t, n, low) => (n*.56 + low*.44)
      * Math.exp(-t*23) * .93 * Math.min(1,t*900));
    procedural('carbine', .33, (t, n, low) => {
      const crack = (.76 * n + .24 * Math.sin(2 * Math.PI * 880 * t)) * Math.exp(-t * 86);
      const report = (.50 * n + .34 * low + .28 * Math.sin(2 * Math.PI * (155 - 140 * t) * t)) * Math.exp(-t * 29);
      const echo = t > .067 ? low * .75 * Math.exp(-(t - .067) * 20) : 0;
      return Math.tanh((crack + report + echo) * 1.4) * Math.min(1, t * 1800);
    });
  }

  function play(name, { bus = effects, gain = .4, speed = 1, loc } = {}) {
    const data = buffers.get(name);
    if (!data || !context || !bus) return;
    const player = context.createBufferSource(), adjust = context.createGain();
    player.buffer = data; player.playbackRate.value = speed;
    adjust.gain.value = gain;
    player.connect(adjust);
    if (loc) {
      const panner = context.createPanner();
      panner.panningModel = 'HRTF'; panner.distanceModel = 'linear';
      panner.refDistance = 1.35; panner.maxDistance = 21; panner.rolloffFactor = 1;
      setPosition(panner, loc);
      adjust.connect(panner);
      panner.connect(bus);
    } else adjust.connect(bus);
    player.start();
  }

  function stopVoice(voice) {
    active.delete(voice.id);
    const now = context.currentTime;
    voice.gain.gain.setTargetAtTime(0, now, .014);
    voice.source.stop(now + .055);
  }

  function applyThreatMix(voice, distance, now) {
    const { gain, cutoff } = threatMix(distance, voice.occluded);
    voice.gain.gain.setTargetAtTime(gain * voiceLevel[voice.type], now, .035);
    voice.filter.frequency.setTargetAtTime(cutoff, now, .07);
  }

  function playVoice(event, run) {
    const { id, kind, type } = event;
    const head = listenerPosition || { x: run.player.x, y: run.player.y + run.player.eyeHeight, z: run.player.z };
    const metres = distance3(head, event);
    const priority = voicePriority(type, metres);
    if (priority <= 0 || paused) return;
    const own = active.get(id);
    if (own && (type === 'voice' || voiceWeight[own.type] > voiceWeight[type])) return;
    if (own) stopVoice(own);
    if (active.size >= voiceLimit) {
      let lowest, score = Infinity;
      for (const voice of active.values()) {
        const next = voicePriority(voice.type, distance3(head, voice.position));
        if (next < score) { lowest = voice; score = next; }
      }
      if (score >= priority) return;
      stopVoice(lowest);
    }
    const list = voices[kind];
    const key = type === 'shriek' ? 'z10' : list[Math.floor(Math.random() * list.length)];
    const source = context.createBufferSource(), gain = context.createGain(), filter = context.createBiquadFilter();
    const panner = context.createPanner();
    source.buffer = buffers.get(key) || buffers.get('rasp');
    source.playbackRate.value = (kind === 'brute' ? .67 : kind === 'shrieker' ? 1 : .84) + Math.random() * .18;
    gain.gain.value = 0;
    filter.type = 'lowpass';
    panner.panningModel = 'HRTF';
    panner.rolloffFactor = 0;
    setPosition(panner, event);
    source.connect(filter).connect(gain).connect(panner).connect(threats);
    const now = context.currentTime;
    const voice = { id, type, position: event, source, panner, filter, gain,
      occluded: !run.world.clear(head, event, false), nextCover: now + .14 };
    applyThreatMix(voice, metres, now);
    active.set(id, voice);
    source.onended = () => { if (active.get(id) === voice) active.delete(id); };
    source.start();
  }

  function setPaused(value) {
    paused = value;
    if (!context) return;
    const t = context.currentTime;
    ambience.gain.setTargetAtTime(value ? .12 : .46, t, .11);
    threats.gain.setTargetAtTime(value ? .01 : .94, t, .06);
    ducked = false;
    if (value) for (const voice of active.values()) stopVoice(voice);
  }

  function setVolume(value) {
    volume = value;
    if (master) master.gain.setTargetAtTime(value, context.currentTime, .06);
  }

  function listener(position, facing, up, run) {
    if (!context) return;
    listenerPosition = position;
    const l = context.listener;
    setPosition(l, position);
    if (l.forwardX) {
      l.forwardX.value = facing.x; l.forwardY.value = facing.y; l.forwardZ.value = facing.z;
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    } else l.setOrientation(facing.x, facing.y, facing.z, up.x, up.y, up.z);
    const now = context.currentTime;
    let close = false;
    for (const voice of active.values()) {
      const zombie = run.enemies.find(e => e.id === voice.id && !e.dead);
      if (!zombie) { stopVoice(voice); continue; }
      voice.position = mouth(zombie);
      const metres = distance3(position, voice.position);
      close ||= metres <= 7;
      setPosition(voice.panner, voice.position);
      if (now >= voice.nextCover) {
        voice.occluded = !run.world.clear(position, voice.position, false);
        voice.nextCover = now + .14;
      }
      applyThreatMix(voice, metres, now);
    }
    if (!paused && close !== ducked) {
      ducked = close;
      ambience.gain.setTargetAtTime(close ? .28 : .46, now, close ? .10 : .37);
    }
    if (!paused && run.time > lastCreak) {
      const a = Math.random() * Math.PI * 2, d = 7 + Math.random() * 10;
      lastCreak = run.time + 9 + Math.random() * 12;
      play('creak', { bus: ambience, loc: { x:position.x+Math.cos(a)*d,y:position.y+.8,z:position.z+Math.sin(a)*d },
        gain: .21, speed: .72+Math.random()*.53 });
    }
    if (!paused && !close && run.time > lastCrow) {
      const a = Math.random() * Math.PI * 2, d = 16 + Math.random() * 10;
      lastCrow = run.time + 28 + Math.random() * 27;
      play('caw', { bus: ambience, loc: { x: position.x + Math.cos(a) * d, y: position.y + 7, z: position.z + Math.sin(a) * d },
        gain: .16, speed: .9 + Math.random() * .2 });
    }
  }

  // 1.1.0 carcass buzz: one looped, positional, quiet sound. A steady 182 Hz buzz with a fast
  // flutter, unlike any zombie cue, audible only within about 9 m of remains that have flies.
  let buzz;
  function setBuzz(target) {
    if (!context) return;
    const now = context.currentTime;
    if (!buzz) {
      if (!target || paused) return;
      const source = context.createBufferSource(), gain = context.createGain(), panner = context.createPanner();
      source.buffer = procedural('buzz', 2, (t, n) => (Math.sin(2 * Math.PI * 182 * t) + .5 * Math.sin(2 * Math.PI * 364 * t))
        * (.5 + .5 * Math.sin(2 * Math.PI * 23 * t)) ** 2 * .28 + n * .04);
      source.loop = true;
      panner.panningModel = 'HRTF'; panner.distanceModel = 'linear';
      panner.refDistance = 1; panner.maxDistance = 10; panner.rolloffFactor = 1;
      gain.gain.value = 0;
      source.connect(gain).connect(panner).connect(ambience);
      source.start();
      buzz = { gain, panner };
    }
    if (!target || paused) { buzz.gain.gain.setTargetAtTime(0, now, .3); return; }
    setPosition(buzz.panner, target);
    const level = Math.max(0, Math.min(1, (9 - target.d) / 9));
    buzz.gain.gain.setTargetAtTime(level * level * .24, now, .25);
  }

  function events(batch, run) {
    if (!context) return;
    for (const e of batch) {
      if (e.type === 'extraction') {
        play('switch', { gain: .13 });
        play('radio-reply', { gain: 1.18 });
      } else if (e.type === 'shot') {
        const gain = e.weapon === 'shotgun' ? .81 : e.weapon === 'carbine' ? .72 : .59;
        play(buffers.has(e.weapon) ? e.weapon : 'fallback', { bus: weapons, gain,
          speed: .94 + Math.random() * .13 });
      } else if (e.type === 'reload') {
        play(e.weapon === 'smg' || e.weapon === 'carbine' ? 'reload-smg-short' : e.weapon === 'shotgun' ? 'pump' : 'reload-short',
          { bus: weapons, gain: .35 });
      } else if (e.type === 'loaded' || e.type === 'reloaded' || e.type === 'dry' || e.type === 'light' || e.type === 'pickup' || e.type === 'weaponSwitch') {
        play('switch', { gain: e.type === 'dry' ? .36 : .23, speed: e.type === 'pickup' ? 1.57 : 1 });
      } else if (e.type === 'wallBreak') {
        play('armor', { gain: .78, loc: e, speed: .54 });
        play('creak', { gain: .65, loc: e, speed: .62 });
      } else if (e.type === 'deflect') {
        play('switch', { gain: .34, loc: e, speed: 1.9 });
      } else if (e.type === 'footstep' || e.type === 'step') {
        play(e.road ? 'gravel' : 'brush', { gain: e.running ? .055 : .024, speed: .86 + Math.random() * .26 });
      } else if (e.type === 'flare' || e.type === 'signalFlare') {
        play('flare', { gain: e.type === 'signalFlare' ? .63 : .39, loc: e });
      } else if (e.type === 'death' || e.type === 'armorHit') {
        play('armor', { gain: .61, speed: e.type === 'death' ? .62 : .91 });
      } else if (e.type === 'swing') {
        play('swing', { gain:.40, loc:e, speed:e.kind==='brute'?.72:e.kind==='shrieker'?1.19:1 });
      } else if (e.type in voiceLevel) playVoice(e, run);
    }
  }

  return { unlock, setPaused, setVolume, listener, events, setBuzz, reset() {
    lastCreak = 2.8;
    lastCrow = 18 + Math.random() * 14;
    listenerPosition = undefined;
    for (const voice of active.values()) stopVoice(voice);
  } };
}
