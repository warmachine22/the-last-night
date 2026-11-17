import { angleDelta, clamp } from './world.js';
import { ENEMY_RIGS } from './enemy-rigs.js';
import { Matrix4, Quaternion, Vector3 } from 'three';

export const HIT_SEGMENTS = [
  [0, 1, 'head', 'head'], [2, 3, 'body', 'body'],
  [4, 5, 'arm', 'arm'], [5, 6, 'arm', 'arm'], [7, 8, 'leg', 'leftLeg'], [8, 9, 'leg', 'leftLeg'],
  [10, 11, 'arm', 'arm'], [11, 12, 'arm', 'arm'], [13, 14, 'leg', 'rightLeg'], [14, 15, 'leg', 'rightLeg'],
];

// All distinct skeletal joints (indices into rig.anchors 0..15) eligible for randomized vital weak points.
export const VITAL_JOINTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
export const VITAL_HIT_RADIUS = 0.145;

export function legacyEnemyMotion(enemy, windupSeconds) {
  const gait = (enemy.gait / (Math.PI * 2)) % 1;
  const attacking = enemy.windup > 0;
  const attack = attacking ? .94 : enemy.recover > .34 ? .56 * clamp((enemy.recover - .34) / .25, 0, 1) : 0;
  const hit = Math.min(1 - attack, enemy.stun * 4.8);
  const stumble = enemy.stumble > 0 ? clamp(1 - enemy.stumble / enemy.stumbleDuration, 0, 1) : 0;
  const stumbleWeight = (1 - attack - hit) * Math.sin(Math.PI * stumble) ** .56;
  return [
    ['Walk', gait, Math.max(0, 1 - attack - hit - stumbleWeight)],
    ['Stumble', stumble, stumbleWeight],
    ['Attack', attacking ? .05 + .50 * (1 - enemy.windup / windupSeconds)
      : .55 + .38 * clamp((1.13 - enemy.recover) / .79, 0, 1), attack],
    ['Hit', clamp((.15 - enemy.stun) * 5.4, 0, .94), hit],
  ];
}

const tau = Math.PI * 2;
const unitScale = new Vector3(1, 1, 1);
const cache = new WeakMap(), decoded = new WeakMap();
export const strideLength = kind => ENEMY_RIGS[kind].stride;
export const attackContact = kind => ENEMY_RIGS[kind].contact;
export const hitRadii = kind => ENEMY_RIGS[kind].radii;
export const BURST_LOAD = .30;
export const BURST_RUN = 1.06;
export const BURST_BRAKE = .46;
const ease = progress => {
  const t = clamp(progress, 0, 1);
  return t * t * (3 - 2 * t);
};

export function burstPhase(enemy, time = enemy.poseTime) {
  if (enemy.kind !== 'shrieker') return null;
  if (time < enemy.burstStart) return 'BurstLoad';
  if (time < enemy.burst) return 'Sprint';
  if (time < enemy.brakeUntil) return 'Brake';
  return null;
}

export function interpolateEnemyTransform(enemy, alpha, position) {
  const from = enemy.previousTransform || enemy;
  position.set(from.x + (enemy.x - from.x) * alpha, from.y + (enemy.y - from.y) * alpha,
    from.z + (enemy.z - from.z) * alpha);
  return from.yaw + angleDelta(enemy.yaw, from.yaw) * alpha;
}

export function attackDirection(enemy, ray) {
  const front = -Math.sin(enemy.yaw)*ray.x + Math.cos(enemy.yaw)*ray.z;
  const side = Math.cos(enemy.yaw)*ray.x + Math.sin(enemy.yaw)*ray.z;
  return Math.abs(front) >= Math.abs(side) ? (front >= 0 ? 'Front' : 'Back') : (side >= 0 ? 'Left' : 'Right');
}

export function enemyMotion(enemy, windup) {
  const { kind } = enemy;
  const t = enemy.poseTime ?? 0, cycle = (enemy.gait / tau) % 1;
  if (enemy.fallAge !== undefined) {
    const weight = clamp(enemy.fallAge / .16, 0, 1);
    return [...(enemy.fallFrom || []).map(([name, phase, blend]) => [name, phase, blend * (1-weight)]),
      ['Fall' + (enemy.hitFrom || 'Front'), clamp(enemy.fallAge / (kind === 'brute' ? 1.46 : 1.21), 0, 1),
        enemy.fallFrom ? weight : 1]];
  }
  const idle = [enemy.ambush?.stage === 'holding' ? 'Cover' : 'Idle', (t * .49 + (enemy.id ?? 0)*.37) % 1, 1];
  if (enemy.attackAge !== undefined) {
    const phase = enemy.attackAge * attackContact(kind) / (enemy.attackWindup ?? windup);
    const weight = ease(Math.min(phase * 13, (1 - phase) * 6));
    const entry = enemy.attackFrom ? 1 - ease(enemy.attackAge / .18) : 0;
    const incoming = enemy.attackFrom || [];
    return [[idle[0], idle[1], (1 - weight) * (1 - entry)],
      ...incoming.map(([name, at, blend]) => [name, at, blend * entry * (1 - weight)]),
      [enemy.attackClip || 'Attack', clamp(phase, 0, 1), weight]];
  }
  const speed = enemy.stride ?? 0;
  const walk = ease(speed / .45);
  let base = [[idle[0], idle[1], 1 - walk], ['Walk', cycle, walk]];
  const phase = burstPhase(enemy, t);
  if (phase === 'BurstLoad') {
    const progress = 1 - (enemy.burstStart - t) / BURST_LOAD;
    const weight = ease(progress / .42);
    base = [...base.map(([name, at, blend]) => [name, at, blend * (1 - weight)]), [phase, progress, weight]];
  } else if (phase === 'Sprint') {
    const weight = ease((t - enemy.burstStart) / .15);
    base = [['BurstLoad', 1, 1 - weight], [phase, cycle, weight]];
  } else if (phase === 'Brake') {
    const progress = 1 - (enemy.brakeUntil - t) / BURST_BRAKE;
    const weight = ease(progress / .42);
    const release = ease((progress - .50) / .5);
    base = [['Sprint', cycle, 1 - weight], [phase, progress, weight * (1 - release)],
      ...base.map(([name, at, blend]) => [name, at, blend * weight * release])];
  }
  const additions = [];
  if (!phase && enemy.stumble > 0) {
    const phase = clamp(1 - enemy.stumble / enemy.stumbleDuration, 0, 1);
    additions.push(['Stumble', phase, Math.sin(phase * Math.PI) ** .56]);
  } else if (!phase && speed > .12 && Math.abs(enemy.turnRate ?? 0) > 1.5) {
    additions.push([enemy.turnRate > 0 ? 'TurnR' : 'TurnL', cycle, clamp((Math.abs(enemy.turnRate)-1.5)*.14, 0, .40)]);
  } else if (!phase && enemy.startAge < .19) {
    const phase = enemy.startAge / .19;
    additions.push(['Start', phase, .36 * Math.sin(Math.PI * phase)]);
  }
  if (enemy.hitAge < .29)
    additions.push(['Hit' + (enemy.hitFrom || 'Front'), enemy.hitAge / .29, .83 * Math.sin(Math.PI * enemy.hitAge / .29)**.55]);
  const scale = additions.reduce((total, clip) => total * (1 - clip[2]), 1);
  const totalWeight = additions.reduce((total, clip) => total + clip[2], 0);
  for (const clip of additions) clip[2] *= (1 - scale) / (totalWeight || 1);
  return [...base.map(([name, at, weight]) => [name, at, weight * scale]), ...additions];
}

function samples(clip) {
  if (decoded.has(clip)) return decoded.get(clip);
  const bytes = Uint8Array.from(atob(clip.samples), char => char.charCodeAt(0));
  const values = new Int16Array(bytes.buffer);
  decoded.set(clip, values);
  return values;
}

export function solvedEnemyPose(enemy, windup, correct = true) {
  const rig = ENEMY_RIGS[enemy.kind];
  const motion = enemyMotion(enemy, windup).filter(clip => clip[2] > 0);
  const feet = correct ? enemy.footing : null;
  const signature = motion.map(clip => clip.join('/')).join(':') + (feet ? '/' + feet.flat().join(',') : '');
  let solved = cache.get(enemy);
  if (solved?.signature === signature) return solved;
  const size = rig.bones.length;
  if (!solved) {
    solved = { rig, joints: Array.from({length:size}, () => ({
      position: new Vector3(), rotation: new Quaternion(), matrix: new Matrix4(),
    })) };
    cache.set(enemy, solved);
  }
  const firstRotation = new Quaternion(), q0 = new Quaternion(), q1 = new Quaternion();
  const blend = motion.map(([name, phase, weight]) => {
    const clip = rig.clips[name], frame = clamp(phase,0,1) * clip.frames;
    const from = Math.floor(frame);
    return { data:samples(clip), from:from*size*7, to:Math.min(clip.frames,from+1)*size*7, fraction:frame-from, weight };
  });
  for (let i=0; i<size; i++) {
    const joint = solved.joints[i], offset = i*7;
    let x=0, y=0, z=0, rx=0, ry=0, rz=0, rw=0;
    for (let j=0; j<blend.length; j++) {
      const { data, from, to, fraction, weight } = blend[j], a=from+offset, b=to+offset;
      x += (data[a] + (data[b]-data[a])*fraction)*weight;
      y += (data[a+1] + (data[b+1]-data[a+1])*fraction)*weight;
      z += (data[a+2] + (data[b+2]-data[a+2])*fraction)*weight;
      q0.set(data[a+3],data[a+4],data[a+5],data[a+6]).normalize();
      q1.set(data[b+3],data[b+4],data[b+5],data[b+6]).normalize();
      q0.slerp(q1,fraction);
      if (j===0) firstRotation.copy(q0);
      const signed = firstRotation.dot(q0) < 0 ? -weight : weight;
      rx+=q0.x*signed; ry+=q0.y*signed; rz+=q0.z*signed; rw+=q0.w*signed;
    }
    joint.position.set(x*.0001,y*.0001,z*.0001);
    joint.rotation.set(rx,ry,rz,rw).normalize();
    joint.matrix.compose(joint.position,joint.rotation,unitScale);
    const parent = rig.parents[i];
    if (parent >= 0) joint.matrix.premultiply(solved.joints[parent].matrix);
  }
  if (feet) for (const [i, offset] of feet.entries()) {
    if (offset) fitLeg(solved, i ? 'R' : 'L', offset);
  }
  solved.signature = signature;
  return solved;
}

function fitLeg({rig,joints}, side, offset) {
  const [hip,knee,ankle] = ['Thigh','Shin','Foot'].map(part => rig.bones.indexOf(part+side));
  const top=joints[hip], lower=joints[knee], foot=joints[ankle];
  const start=new Vector3().setFromMatrixPosition(top.matrix);
  const middle=new Vector3().setFromMatrixPosition(lower.matrix);
  const end=new Vector3().setFromMatrixPosition(foot.matrix);
  const oldUpper=middle.clone().sub(start), oldLower=end.clone().sub(middle);
  const footRotation=new Quaternion().setFromRotationMatrix(foot.matrix);
  const target=end.clone().add(new Vector3(...offset).clampLength(0,.15));
  const line=target.sub(start), upperLength=oldUpper.length(), lowerLength=oldLower.length();
  if (line.lengthSq()<.001) return;
  const distance=clamp(line.length(),Math.abs(upperLength-lowerLength)+.002,upperLength+lowerLength-.003);
  line.normalize();
  const legPlane=oldUpper.clone().addScaledVector(line,-oldUpper.dot(line)).normalize();
  if (legPlane.lengthSq()<.5) return;
  const along=(distance*distance+upperLength*upperLength-lowerLength*lowerLength)/(2*distance);
  const bent=legPlane.multiplyScalar(Math.sqrt(Math.max(0,upperLength*upperLength-along*along))).addScaledVector(line,along);
  const shinVector=line.multiplyScalar(distance).sub(bent);
  const rotate=(original, direction, joint) => new Quaternion().setFromUnitVectors(original.normalize(),direction.clone().normalize())
    .multiply(new Quaternion().setFromRotationMatrix(joint.matrix));
  const upperRotation=rotate(oldUpper,bent,top), lowerRotation=rotate(oldLower,shinVector,lower);
  function setRotation(index, worldRotation) {
    const joint=joints[index], parent=joints[rig.parents[index]];
    joint.rotation.setFromRotationMatrix(parent.matrix).invert().multiply(worldRotation).normalize();
    joint.matrix.compose(joint.position,joint.rotation,unitScale).premultiply(parent.matrix);
  }
  setRotation(hip,upperRotation);
  setRotation(knee,lowerRotation);
  setRotation(ankle,footRotation);
}

export function updateEnemyFooting(world, enemy, windup, gap) {
  if (gap>12 || enemy.stride<.14 || enemy.attackAge!==undefined || enemy.stumble>0 || enemy.hitAge<.29 ||
      burstPhase(enemy)) {
    enemy.footing=null;
    enemy.plantLocks=null;
    return;
  }
  const turn=Math.cos(enemy.yaw), cross=Math.sin(enemy.yaw);
  const phase=(enemy.gait/tau)%1;
  const {rig,joints}=solvedEnemyPose(enemy,windup,false);
  enemy.plantLocks ||= [null,null];
  enemy.footing = ['L','R'].map((side,i) => {
    const fraction=(phase+(i?(enemy.kind==='shambler'?.43:.5):0))%1;
    const stance=i&&enemy.kind==='shambler'?.70:.60;
    if (fraction>=stance) { enemy.plantLocks[i]=null; return null; }
    const ankle=new Vector3().setFromMatrixPosition(joints[rig.bones.indexOf('Foot'+side)].matrix);
    const x=enemy.x-turn*ankle.x+cross*ankle.z, z=enemy.z-cross*ankle.x-turn*ankle.z;
    let lock=enemy.plantLocks[i];
    if (!lock || fraction<lock.fraction) lock=enemy.plantLocks[i]={x,z};
    lock.fraction=fraction;
    const blend=clamp(Math.min(fraction/.10,(stance-fraction)/.12),0,1)*Math.min(1,enemy.stride/.43);
    const dx=lock.x-x, dz=lock.z-z;
    const dy=world.height(lock.x,lock.z)-enemy.y;
    return [(-turn*dx-cross*dz)*blend,dy*blend,(cross*dx-turn*dz)*blend];
  });
}

export function animatedAnchors(enemy, windup, count = 16) {
  const solved = solvedEnemyPose(enemy, windup);
  const c = Math.cos(enemy.yaw), s = Math.sin(enemy.yaw), position = new Vector3();
  return solved.rig.anchors.slice(0,count).map(([joint,x,y,z]) => {
    const at = position.set(x,y,z).applyMatrix4(solved.joints[joint].matrix);
    return { x:enemy.x-c*at.x+s*at.z, y:enemy.y+at.y, z:enemy.z-s*at.x-c*at.z };
  });
}
