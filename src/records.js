import { BUILD } from './simulation.js';
import { gunAngle } from './held-tools.js';
import { DIFFICULTIES, difficultyKey } from './difficulty.js';

const scoresKey = 'thelastnight.scores.v1';
const settingsKey = 'thelastnight.settings.v1';
const defaults = {
  leftHanded: false, seated: false, reducedFlashes: false, visibility: false,
  laserDot: false, volume: 0.75, initials: 'YOU', gunPitch: 0, gunYaw: 0, difficulty: 'standard',
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
  settings.difficulty = difficultyKey(settings.difficulty);
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

function allScores() {
  const stored = read(scoresKey, []);
  const scores = new Map((Array.isArray(stored) ? stored : []).filter(row =>
    typeof row?.id === 'string' && Number.isFinite(row.time) && Number.isFinite(row.kills) &&
    typeof row.initials === 'string').map(row => [row.id, row]));
  for (const row of fallbackScores) scores.set(row.id, row);
  return [...scores.values()].map(row => ({ ...row, difficulty: difficultyKey(row.difficulty) }));
}

export function listScores(difficulty = 'standard') {
  return allScores().filter(row => row.difficulty === difficultyKey(difficulty)).sort(compare).slice(0, 10);
}

function compare(a, b) {
  const escDiff = Number(Boolean(b.escaped)) - Number(Boolean(a.escaped));
  if (escDiff) return escDiff;
  if (b.escaped && a.escaped) return a.time - b.time;
  return b.time - a.time || b.kills - a.kills || a.id.localeCompare(b.id);
}

export function recordRun(run, id, label) {
  const entry = {
    id, initials: initials(label), time: Math.floor(run.time * 100) / 100,
    kills: run.player.kills, headshots: run.player.headshots,
    parts: run.search.parts.length, escaped: run.status === 'escaped',
    seed: run.seed, version: BUILD, difficulty: difficultyKey(run.difficulty),
  };
  const scores = [...allScores().filter(row => row.id !== id), entry].sort(compare);
  const records = Object.keys(DIFFICULTIES).flatMap(level => scores.filter(row => row.difficulty === level).slice(0, 10));
  fallbackScores = records;
  const saved = write(scoresKey, records);
  return { saved, place: records.filter(row => row.difficulty === entry.difficulty).findIndex(row => row.id === id) + 1 };
}
