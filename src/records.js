import { BUILD } from './simulation.js';
import { gunAngle } from './held-tools.js';
import { ARENA_SIZES, arenaSizeKey, DIFFICULTIES, difficultyKey, modeKey } from './difficulty.js';

const scoresKey = 'thelastnight.scores.v1';
const settingsKey = 'thelastnight.settings.v1';
const defaults = {
  leftHanded: false, seated: false, reducedFlashes: false, visibility: false,
  laserDot: false, volume: 0.75, initials: 'YOU', gunPitch: 0, gunYaw: 0,
  mode: 'labyrinth', difficulty: 'standard', arenaSize: 'medium',
};
let fallbackScores = [];

function read(key, otherwise) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : otherwise;
  } catch { return otherwise; }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function initials(text) {
  return String(text).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'YOU';
}

export function loadSettings() {
  const value = read(settingsKey, {});
  const settings = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (typeof value?.[key] === typeof defaults[key]) settings[key] = value[key];
  }
  settings.volume = Math.max(0, Math.min(1, settings.volume));
  settings.initials = initials(settings.initials);
  settings.gunPitch = gunAngle(settings.gunPitch);
  settings.gunYaw = gunAngle(settings.gunYaw);
  settings.mode = modeKey(settings.mode);
  settings.difficulty = difficultyKey(settings.difficulty);
  settings.arenaSize = arenaSizeKey(settings.arenaSize);
  return settings;
}

export function saveSettings(settings) {
  write(settingsKey, settings);
}

export function formatTime(seconds) {
  const s = Math.floor(Math.max(0, seconds));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

export function rapidSeed() {
  return Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('-');
}

export const SCORE_BUCKETS = [
  ...Object.entries(DIFFICULTIES).map(([k, v]) => [k, 'Labyrinth · ' + v.name]),
  ...Object.entries(ARENA_SIZES).map(([k, v]) => ['arena:' + k, 'Tight Space · ' + v.name]),
];

const bucketKey = value => (String(value || '').startsWith('arena:')
  ? 'arena:' + arenaSizeKey(String(value).slice(6))
  : difficultyKey(value));

function allScores() {
  const stored = read(scoresKey, []);
  const scores = new Map((Array.isArray(stored) ? stored : []).filter(row =>
    typeof row?.id === 'string' && Number.isFinite(row.time) && Number.isFinite(row.kills) &&
    typeof row.initials === 'string').map(row => [row.id, row]));
  for (const row of fallbackScores) scores.set(row.id, row);
  return [...scores.values()].map(row => ({ ...row, difficulty: bucketKey(row.difficulty) }));
}

export function listScores(bucket = 'standard') {
  const key = bucketKey(bucket);
  return allScores().filter(row => row.difficulty === key).sort(compare).slice(0, 10);
}

function compare(a, b) {
  const escDiff = Number(Boolean(b.escaped)) - Number(Boolean(a.escaped));
  if (escDiff) return escDiff;
  if (b.escaped && a.escaped) return a.time - b.time;
  return b.time - a.time || b.kills - a.kills || a.id.localeCompare(b.id);
}

export function recordRun(run, id, label) {
  const bucket = run.mode === 'arena' ? 'arena:' + arenaSizeKey(run.arenaSize || run.difficulty) : difficultyKey(run.difficulty);
  const entry = {
    id, initials: initials(label), time: Math.floor(run.time * 100) / 100,
    kills: run.player.kills, headshots: run.player.headshots,
    parts: run.player.kills, escaped: run.status === 'escaped',
    seed: run.seed, version: BUILD, difficulty: bucket,
  };
  const scores = [...allScores().filter(row => row.id !== id), entry].sort(compare);
  const validBuckets = SCORE_BUCKETS.map(([k]) => k);
  const records = validBuckets.flatMap(level => scores.filter(row => row.difficulty === level).slice(0, 10));
  fallbackScores = records;
  const saved = write(scoresKey, records);
  return { saved, place: records.filter(row => row.difficulty === entry.difficulty).findIndex(row => row.id === id) + 1 };
}
