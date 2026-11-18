export const DIFFICULTIES = {
  standard: {
    name: 'Standard (78 m)',
    mazeSize: 78,
    speedLimit: 1.53,
    aggroScale: 0.94,
    blindSight: 1.25,
    memorySeconds: 6.5,
    ammoScale: 1.15,
  },
  hard: {
    name: 'Hard (114 m)',
    mazeSize: 114,
    speedLimit: 1.66,
    aggroScale: 1.0,
    blindSight: 1.45,
    memorySeconds: 8.5,
    ammoScale: 0.95,
  },
  nightmare: {
    name: 'Nightmare (156 m)',
    mazeSize: 156,
    speedLimit: 1.74,
    aggroScale: 1.05,
    blindSight: 1.65,
    memorySeconds: 10.5,
    ammoScale: 0.80,
  },
};

export const difficultyKey = value => (value === 'hard' || value === 'nightmare' ? value : 'standard');

export const MODES = {
  labyrinth: { name: 'Labyrinth Escape' },
  arena: { name: 'Fight in Tight Space' },
};

export const modeKey = value => (value === 'arena' ? 'arena' : 'labyrinth');

export const ARENA_SIZES = {
  compact: {
    name: 'Compact (16 m)',
    diameter: 16,
    cellSize: 2.0,
    speedLimit: 1.62,
    aggroScale: 0.96,
    blindSight: 1.5,
    memorySeconds: 9.0,
  },
  medium: {
    name: 'Medium (24 m)',
    diameter: 24,
    cellSize: 2.2,
    speedLimit: 1.66,
    aggroScale: 1.0,
    blindSight: 1.6,
    memorySeconds: 9.5,
  },
  spacious: {
    name: 'Large (32 m)',
    diameter: 32,
    cellSize: 2.4,
    speedLimit: 1.70,
    aggroScale: 1.02,
    blindSight: 1.65,
    memorySeconds: 10.0,
  },
  grand: {
    name: 'Extra Large (40 m)',
    diameter: 40,
    cellSize: 2.5,
    speedLimit: 1.74,
    aggroScale: 1.05,
    blindSight: 1.7,
    memorySeconds: 10.5,
  },
};

export const arenaSizeKey = value => (value && value in ARENA_SIZES ? value : 'medium');
