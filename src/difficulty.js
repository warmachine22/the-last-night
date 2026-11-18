export const DIFFICULTIES = {
  standard: {
    name: 'Standard (64 m)',
    mazeSize: 64,
    speedLimit: 1.18,
    aggroScale: 0.94,
    blindSight: 1.25,
    memorySeconds: 6.5,
    ammoScale: 1.15,
  },
  hard: {
    name: 'Hard (96 m)',
    mazeSize: 96,
    speedLimit: 1.28,
    aggroScale: 1.0,
    blindSight: 1.45,
    memorySeconds: 8.5,
    ammoScale: 0.95,
  },
  nightmare: {
    name: 'Nightmare (144 m)',
    mazeSize: 144,
    speedLimit: 1.34,
    aggroScale: 1.05,
    blindSight: 1.65,
    memorySeconds: 10.5,
    ammoScale: 0.80,
  },
};

export const difficultyKey = value => (value === 'hard' || value === 'nightmare' ? value : 'standard');
