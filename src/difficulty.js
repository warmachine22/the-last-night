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
