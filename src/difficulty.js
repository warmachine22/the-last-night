export const DIFFICULTIES = {
  easy: {
    name: 'Easy', speedLimit: 2.95, aggroScale: 0.85,
    triggerRadius: 3.4, darkSight: 1.5, memorySeconds: 7,
  },
  standard: {
    name: 'Normal', speedLimit: 3.15, aggroScale: 1.0,
    triggerRadius: 4.0, darkSight: 1.8, memorySeconds: 9,
  },
  hard: {
    name: 'Hard', speedLimit: 3.40, aggroScale: 1.18,
    triggerRadius: 4.6, darkSight: 2.1, memorySeconds: 11,
  },
};

export const difficultyKey = value => (value === 'easy' || value === 'hard' ? value : 'standard');
