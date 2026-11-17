export const CELL = 2.0;
export const WALL_HEIGHT = 2.75;
export const DOOR_HEIGHT = 2.15;

const PALETTES = [
  { wall: 0x8f4e42, inner: 0x7b6553, weak: 0x5c422c, roof: 0x4b4142 },
  { wall: 0x67796b, inner: 0x6c7263, weak: 0x524535, roof: 0x51534a },
  { wall: 0x9c8e6b, inner: 0x84785e, weak: 0x634b32, roof: 0x5c4b41 },
  { wall: 0x607180, inner: 0x646e75, weak: 0x4e4237, roof: 0x454049 },
  { wall: 0x95774d, inner: 0x7a654a, weak: 0x593f2b, roof: 0x474f48 },
];

// Build a clean cell-edge floorplan from rectangular rooms, doorways, breakable ambush walls, and exterior doors.
function compileCabin(def) {
  const { cols, rows, rooms, doors, openings, weakWalls, primary, supplies, zombies } = def;
  const owner = Array.from({ length: rows }, () => Array(cols).fill(-1));
  rooms.forEach(([c0, r0, c1, r1], idx) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) owner[r][c] = idx;
  });

  const hEdges = Array.from({ length: rows + 1 }, () => Array(cols).fill('#'));
  const vEdges = Array.from({ length: rows }, () => Array(cols + 1).fill('#'));

  // Open interior passages inside the same room
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r + 1 < rows && owner[r][c] === owner[r + 1][c] && owner[r][c] !== -1) hEdges[r + 1][c] = '.';
      if (c + 1 < cols && owner[r][c] === owner[r][c + 1] && owner[r][c] !== -1) vEdges[r][c + 1] = '.';
    }
  }

  const setEdge = (c1, r1, c2, r2, ch) => {
    if (c2 === c1 + 1 && r1 === r2) vEdges[r1][c1 + 1] = ch;
    else if (c2 === c1 - 1 && r1 === r2) vEdges[r1][c1] = ch;
    else if (r2 === r1 + 1 && c1 === c2) hEdges[r1 + 1][c1] = ch;
    else if (r2 === r1 - 1 && c1 === c2) hEdges[r1][c1] = ch;
  };

  for (const [c1, r1, c2, r2] of openings) setEdge(c1, r1, c2, r2, '.');
  for (const [c1, r1, c2, r2] of weakWalls) setEdge(c1, r1, c2, r2, '%');
  for (const [side, idx] of doors) {
    if (side === 'N') hEdges[0][idx] = 'D';
    else if (side === 'S') hEdges[rows][idx] = 'D';
    else if (side === 'W') vEdges[idx][0] = 'D';
    else if (side === 'E') vEdges[idx][cols] = 'D';
  }

  return { ...def, owner, hEdges, vEdges, primary, supplies, zombies };
}

// 20 unique realistic single-floor cabins (16x14 m up to 22x18 m) with multiple rooms, hallways, closets & breakable walls.
const RAW_CABINS = [
  {
    name: 'Pinecrest Lodge', cols: 9, rows: 8, roof: 'gable',
    rooms: [
      [0, 0, 2, 2], [3, 0, 5, 2], [6, 0, 8, 2],
      [0, 3, 1, 5], [2, 3, 5, 4], [6, 3, 8, 4],
      [2, 5, 5, 5], [6, 5, 8, 7],
      [0, 6, 2, 7], [3, 6, 5, 7],
    ],
    doors: [['N', 4], ['S', 4]],
    openings: [[2, 1, 3, 1], [5, 1, 6, 1], [4, 2, 4, 3], [1, 2, 1, 3], [1, 5, 2, 5], [4, 4, 4, 5], [5, 5, 6, 5], [4, 5, 4, 6], [2, 6, 3, 6], [5, 6, 6, 6], [7, 4, 7, 5]],
    weakWalls: [[2, 4, 1, 4], [5, 3, 6, 3], [0, 5, 0, 6], [6, 4, 6, 5], [3, 5, 3, 6]],
    primary: [[7, 1], [7, 6]], supplies: [[0, 1], [1, 7], [4, 7]],
    zombies: [[1, 1], [4, 1], [0, 4], [3, 3], [7, 3], [4, 5], [1, 6], [7, 7], [4, 7], [6, 1], [2, 3], [8, 6]],
  },
  {
    name: 'Old Ranger Post', cols: 8, rows: 7, roof: 'lean',
    rooms: [
      [0, 0, 2, 2], [3, 0, 5, 2], [6, 0, 7, 3],
      [0, 3, 2, 4], [3, 3, 5, 3],
      [0, 5, 3, 6], [4, 4, 5, 6], [6, 4, 7, 6],
    ],
    doors: [['N', 4], ['S', 1]],
    openings: [[2, 1, 3, 1], [5, 1, 6, 1], [4, 2, 4, 3], [3, 3, 2, 3], [1, 4, 1, 5], [3, 5, 4, 5], [5, 5, 6, 5], [4, 3, 4, 4]],
    weakWalls: [[1, 2, 1, 3], [5, 3, 6, 3], [6, 3, 6, 4], [2, 4, 2, 5]],
    primary: [[7, 1]], supplies: [[0, 0], [0, 6], [7, 5]],
    zombies: [[1, 1], [4, 1], [6, 2], [1, 3], [4, 3], [2, 6], [5, 5], [7, 6], [0, 4], [4, 6], [7, 0], [3, 5]],
  },
  {
    name: 'Twin Creek Bunkhouse', cols: 10, rows: 7, roof: 'gable',
    rooms: [
      [0, 0, 2, 2], [3, 0, 6, 2], [7, 0, 9, 2],
      [0, 3, 9, 3],
      [0, 4, 2, 6], [3, 4, 4, 6], [5, 4, 6, 6], [7, 4, 9, 6],
    ],
    doors: [['N', 4], ['S', 1], ['S', 8]],
    openings: [[2, 1, 3, 1], [6, 1, 7, 1], [4, 2, 4, 3], [1, 3, 1, 4], [3, 3, 3, 4], [5, 3, 5, 4], [8, 3, 8, 4], [4, 5, 5, 5]],
    weakWalls: [[1, 2, 1, 3], [8, 2, 8, 3], [2, 5, 3, 5], [6, 5, 7, 5]],
    primary: [[9, 1]], supplies: [[0, 1], [3, 6], [6, 6]],
    zombies: [[1, 0], [5, 1], [8, 1], [2, 3], [7, 3], [1, 5], [4, 4], [6, 4], [8, 5], [0, 6], [9, 6], [5, 3]],
  },
  {
    name: 'Sawmill House', cols: 9, rows: 7, roof: 'broken',
    rooms: [
      [0, 0, 3, 2], [4, 0, 6, 2], [7, 0, 8, 2],
      [0, 3, 2, 4], [3, 3, 5, 4], [6, 3, 8, 4],
      [0, 5, 4, 6], [5, 5, 8, 6],
    ],
    doors: [['W', 1], ['S', 6]],
    openings: [[3, 1, 4, 1], [6, 1, 7, 1], [1, 2, 1, 3], [2, 3, 3, 3], [5, 3, 6, 3], [4, 4, 4, 5], [4, 5, 5, 5], [7, 4, 7, 5]],
    weakWalls: [[4, 2, 4, 3], [7, 2, 7, 3], [1, 4, 1, 5], [5, 4, 5, 5]],
    primary: [[8, 1]], supplies: [[2, 0], [0, 6], [6, 4]],
    zombies: [[1, 1], [5, 1], [7, 1], [1, 4], [4, 3], [7, 3], [2, 5], [6, 6], [8, 5], [3, 6], [0, 3], [5, 0]],
  },
  {
    name: 'Caretaker Residence', cols: 8, rows: 8, roof: 'gable',
    rooms: [
      [0, 0, 2, 2], [3, 0, 4, 2], [5, 0, 7, 3],
      [0, 3, 3, 3], [4, 3, 4, 5],
      [0, 4, 3, 5], [5, 4, 7, 5],
      [0, 6, 3, 7], [4, 6, 7, 7],
    ],
    doors: [['N', 3], ['E', 6]],
    openings: [[2, 1, 3, 1], [4, 1, 5, 1], [3, 2, 3, 3], [3, 3, 4, 3], [1, 3, 1, 4], [4, 4, 5, 4], [2, 5, 2, 6], [3, 6, 4, 6], [6, 5, 6, 6]],
    weakWalls: [[4, 2, 4, 3], [3, 4, 4, 4], [6, 3, 6, 4], [4, 5, 4, 6]],
    primary: [[7, 1]], supplies: [[0, 1], [1, 7], [6, 4]],
    zombies: [[1, 1], [3, 1], [6, 2], [2, 3], [1, 5], [4, 5], [6, 5], [1, 6], [5, 7], [7, 7], [0, 4], [5, 0]],
  },
  {
    name: 'Timberline Cabin', cols: 9, rows: 7, roof: 'lean',
    rooms: [
      [0, 0, 2, 3], [3, 0, 5, 1], [6, 0, 8, 2],
      [3, 2, 5, 4], [6, 3, 8, 4],
      [0, 4, 2, 6], [3, 5, 5, 6], [6, 5, 8, 6],
    ],
    doors: [['N', 4], ['S', 1]],
    openings: [[2, 1, 3, 1], [5, 1, 6, 1], [4, 1, 4, 2], [5, 3, 6, 3], [2, 4, 3, 4], [4, 4, 4, 5], [5, 5, 6, 5], [1, 3, 1, 4]],
    weakWalls: [[2, 2, 3, 2], [7, 2, 7, 3], [2, 5, 3, 5], [7, 4, 7, 5]],
    primary: [[8, 0]], supplies: [[0, 0], [0, 6], [7, 6]],
    zombies: [[1, 2], [4, 0], [7, 1], [4, 3], [7, 4], [1, 5], [4, 6], [7, 5], [2, 6], [5, 2], [0, 1], [8, 3]],
  },
  {
    name: 'Hollow Ridge Lodge', cols: 11, rows: 8, roof: 'gable',
    rooms: [
      [0, 0, 2, 2], [3, 0, 7, 2], [8, 0, 10, 2],
      [0, 3, 2, 4], [3, 3, 4, 5], [5, 3, 10, 3],
      [5, 4, 7, 5], [8, 4, 10, 5],
      [0, 5, 2, 7], [3, 6, 6, 7], [7, 6, 10, 7],
    ],
    doors: [['N', 5], ['S', 4], ['S', 9]],
    openings: [[2, 1, 3, 1], [7, 1, 8, 1], [5, 2, 5, 3], [4, 3, 5, 3], [2, 3, 3, 3], [6, 3, 6, 4], [9, 3, 9, 4], [1, 4, 1, 5], [3, 5, 3, 6], [6, 6, 7, 6], [9, 5, 9, 6]],
    weakWalls: [[1, 2, 1, 3], [7, 4, 8, 4], [2, 6, 3, 6], [5, 5, 5, 6]],
    primary: [[0, 0], [10, 0]], supplies: [[1, 7], [5, 7], [9, 4]],
    zombies: [[1, 1], [5, 1], [9, 1], [1, 4], [4, 4], [7, 3], [6, 5], [9, 5], [1, 6], [4, 7], [8, 7], [10, 6], [3, 1]],
  },
  {
    name: 'Foxglove Manor', cols: 10, rows: 8, roof: 'gable',
    rooms: [
      [0, 0, 3, 2], [4, 0, 6, 2], [7, 0, 9, 2],
      [0, 3, 1, 5], [2, 3, 7, 3], [8, 3, 9, 5],
      [2, 4, 4, 5], [5, 4, 7, 5],
      [0, 6, 4, 7], [5, 6, 9, 7],
    ],
    doors: [['N', 5], ['S', 2], ['S', 7]],
    openings: [[3, 1, 4, 1], [6, 1, 7, 1], [5, 2, 5, 3], [1, 3, 2, 3], [7, 3, 8, 3], [3, 3, 3, 4], [6, 3, 6, 4], [3, 5, 3, 6], [6, 5, 6, 6], [4, 6, 5, 6]],
    weakWalls: [[1, 2, 1, 3], [8, 2, 8, 3], [4, 5, 5, 5], [1, 5, 1, 6], [8, 5, 8, 6]],
    primary: [[9, 1]], supplies: [[0, 1], [0, 7], [6, 5]],
    zombies: [[2, 1], [5, 1], [8, 1], [0, 4], [4, 3], [9, 4], [3, 5], [6, 4], [2, 7], [7, 7], [1, 6], [9, 6]],
  },
  {
    name: 'Northwatch Outpost', cols: 8, rows: 7, roof: 'broken',
    rooms: [
      [0, 0, 2, 2], [3, 0, 4, 3], [5, 0, 7, 2],
      [0, 3, 2, 4], [5, 3, 7, 4],
      [0, 5, 3, 6], [4, 4, 4, 6], [5, 5, 7, 6],
    ],
    doors: [['N', 1], ['E', 5]],
    openings: [[2, 1, 3, 1], [4, 1, 5, 1], [2, 3, 3, 3], [4, 3, 5, 3], [4, 3, 4, 4], [1, 4, 1, 5], [3, 5, 4, 5], [4, 5, 5, 5]],
    weakWalls: [[1, 2, 1, 3], [6, 2, 6, 3], [6, 4, 6, 5], [3, 6, 4, 6]],
    primary: [[7, 0]], supplies: [[0, 0], [0, 6], [7, 3]],
    zombies: [[1, 1], [3, 2], [6, 1], [1, 4], [6, 4], [2, 6], [4, 5], [6, 6], [0, 5], [7, 6], [4, 0], [2, 3]],
  },
  {
    name: 'Cedar Creek House', cols: 9, rows: 8, roof: 'lean',
    rooms: [
      [0, 0, 2, 3], [3, 0, 5, 2], [6, 0, 8, 2],
      [3, 3, 8, 3],
      [0, 4, 2, 5], [3, 4, 5, 5], [6, 4, 8, 5],
      [0, 6, 3, 7], [4, 6, 8, 7],
    ],
    doors: [['W', 2], ['S', 6]],
    openings: [[2, 1, 3, 1], [5, 1, 6, 1], [4, 2, 4, 3], [2, 3, 3, 3], [1, 3, 1, 4], [4, 3, 4, 4], [7, 3, 7, 4], [1, 5, 1, 6], [3, 6, 4, 6], [6, 5, 6, 6]],
    weakWalls: [[7, 2, 7, 3], [2, 4, 3, 4], [5, 5, 6, 5], [4, 5, 4, 6]],
    primary: [[8, 0]], supplies: [[1, 0], [0, 7], [7, 5]],
    zombies: [[1, 2], [4, 1], [7, 1], [5, 3], [1, 5], [4, 5], [7, 4], [2, 7], [6, 7], [8, 6], [0, 5], [3, 3]],
  },
  {
    name: 'Blackwater Inn', cols: 11, rows: 8, roof: 'gable',
    rooms: [
      [0, 0, 2, 2], [3, 0, 4, 2], [5, 0, 7, 2], [8, 0, 10, 2],
      [0, 3, 10, 3],
      [0, 4, 2, 5], [3, 4, 5, 5], [6, 4, 7, 5], [8, 4, 10, 5],
      [0, 6, 4, 7], [5, 6, 10, 7],
    ],
    doors: [['N', 5], ['S', 2], ['S', 8]],
    openings: [[2, 1, 3, 1], [4, 1, 5, 1], [7, 1, 8, 1], [5, 2, 5, 3], [1, 3, 1, 4], [4, 3, 4, 4], [6, 3, 6, 4], [9, 3, 9, 4], [1, 5, 1, 6], [4, 6, 5, 6], [9, 5, 9, 6]],
    weakWalls: [[1, 2, 1, 3], [9, 2, 9, 3], [2, 4, 3, 4], [5, 5, 6, 5], [7, 4, 8, 4]],
    primary: [[10, 1]], supplies: [[0, 1], [0, 7], [6, 5], [10, 7]],
    zombies: [[1, 1], [3, 1], [6, 1], [9, 1], [3, 3], [8, 3], [1, 5], [4, 5], [7, 4], [9, 5], [2, 7], [7, 7], [10, 6]],
  },
  {
    name: 'Trapper Cabin', cols: 8, rows: 7, roof: 'gable',
    rooms: [
      [0, 0, 3, 2], [4, 0, 7, 2],
      [0, 3, 1, 4], [2, 3, 5, 4], [6, 3, 7, 4],
      [0, 5, 3, 6], [4, 5, 7, 6],
    ],
    doors: [['N', 2], ['E', 3]],
    openings: [[3, 1, 4, 1], [3, 2, 3, 3], [1, 3, 2, 3], [5, 3, 6, 3], [1, 4, 1, 5], [3, 5, 4, 5], [6, 4, 6, 5]],
    weakWalls: [[0, 2, 0, 3], [6, 2, 6, 3], [3, 4, 3, 5], [5, 4, 5, 5]],
    primary: [[7, 0]], supplies: [[0, 0], [0, 6], [7, 6]],
    zombies: [[1, 1], [5, 1], [0, 4], [3, 3], [4, 4], [6, 4], [2, 6], [5, 6], [7, 5], [2, 0], [6, 1], [1, 5]],
  },
  {
    name: 'Birchwood Lodge', cols: 10, rows: 7, roof: 'lean',
    rooms: [
      [0, 0, 2, 2], [3, 0, 6, 2], [7, 0, 9, 2],
      [0, 3, 3, 4], [4, 3, 5, 6], [6, 3, 9, 4],
      [0, 5, 3, 6], [6, 5, 9, 6],
    ],
    doors: [['N', 5], ['S', 2]],
    openings: [[2, 1, 3, 1], [6, 1, 7, 1], [4, 2, 4, 3], [3, 3, 4, 3], [5, 3, 6, 3], [1, 4, 1, 5], [3, 5, 4, 5], [5, 5, 6, 5]],
    weakWalls: [[1, 2, 1, 3], [8, 2, 8, 3], [8, 4, 8, 5], [2, 4, 2, 5]],
    primary: [[0, 1]], supplies: [[9, 0], [0, 6], [9, 6]],
    zombies: [[1, 0], [5, 1], [8, 1], [1, 3], [4, 4], [7, 3], [9, 4], [2, 6], [5, 6], [7, 6], [0, 5], [3, 1]],
  },
  {
    name: 'Misty Hollow House', cols: 9, rows: 8, roof: 'broken',
    rooms: [
      [0, 0, 2, 2], [3, 0, 5, 2], [6, 0, 8, 2],
      [0, 3, 2, 5], [3, 3, 5, 3], [6, 3, 8, 4],
      [3, 4, 5, 5], [6, 5, 8, 7],
      [0, 6, 2, 7], [3, 6, 5, 7],
    ],
    doors: [['S', 4], ['W', 4]],
    openings: [[2, 1, 3, 1], [5, 1, 6, 1], [4, 2, 4, 3], [2, 3, 3, 3], [4, 3, 4, 4], [5, 4, 6, 4], [1, 5, 1, 6], [4, 5, 4, 6], [2, 7, 3, 7], [5, 6, 6, 6]],
    weakWalls: [[1, 2, 1, 3], [7, 2, 7, 3], [7, 4, 7, 5], [2, 4, 3, 4]],
    primary: [[8, 0]], supplies: [[0, 0], [0, 7], [7, 7]],
    zombies: [[1, 1], [4, 1], [7, 1], [1, 4], [4, 3], [7, 4], [4, 5], [1, 7], [4, 7], [7, 6], [8, 3], [3, 4]],
  },
  {
    name: 'Alder Point Cabin', cols: 8, rows: 8, roof: 'gable',
    rooms: [
      [0, 0, 2, 2], [3, 0, 5, 2], [6, 0, 7, 2],
      [0, 3, 7, 3],
      [0, 4, 2, 5], [3, 4, 4, 5], [5, 4, 7, 5],
      [0, 6, 3, 7], [4, 6, 7, 7],
    ],
    doors: [['N', 4], ['S', 1]],
    openings: [[2, 1, 3, 1], [5, 1, 6, 1], [4, 2, 4, 3], [1, 3, 1, 4], [3, 3, 3, 4], [6, 3, 6, 4], [1, 5, 1, 6], [3, 6, 4, 6], [6, 5, 6, 6]],
    weakWalls: [[1, 2, 1, 3], [2, 4, 3, 4], [4, 5, 5, 5], [4, 5, 4, 6]],
    primary: [[0, 1]], supplies: [[7, 0], [0, 7], [7, 7]],
    zombies: [[1, 0], [4, 1], [7, 1], [2, 3], [6, 3], [1, 5], [3, 5], [6, 4], [2, 7], [5, 7], [7, 5], [0, 6]],
  },
  {
    name: 'Deepwood Infirmary', cols: 10, rows: 8, roof: 'lean',
    rooms: [
      [0, 0, 2, 2], [3, 0, 6, 2], [7, 0, 9, 2],
      [0, 3, 2, 4], [3, 3, 6, 4], [7, 3, 9, 4],
      [0, 5, 9, 5],
      [0, 6, 2, 7], [3, 6, 5, 7], [6, 6, 9, 7],
    ],
    doors: [['S', 4], ['E', 5]],
    openings: [[2, 1, 3, 1], [6, 1, 7, 1], [4, 2, 4, 3], [2, 3, 3, 3], [6, 3, 7, 3], [4, 4, 4, 5], [1, 5, 1, 6], [4, 5, 4, 6], [7, 5, 7, 6]],
    weakWalls: [[1, 2, 1, 3], [8, 2, 8, 3], [1, 4, 1, 5], [8, 4, 8, 5], [5, 6, 6, 6]],
    primary: [[0, 0]], supplies: [[9, 0], [0, 7], [8, 7]],
    zombies: [[1, 1], [5, 1], [8, 1], [1, 4], [5, 3], [8, 4], [3, 5], [7, 5], [1, 7], [4, 7], [8, 6], [3, 4], [9, 6]],
  },
  {
    name: 'Stony Brook Lodge', cols: 9, rows: 7, roof: 'gable',
    rooms: [
      [0, 0, 3, 2], [4, 0, 5, 3], [6, 0, 8, 2],
      [0, 3, 3, 3], [6, 3, 8, 3],
      [0, 4, 2, 6], [3, 4, 5, 6], [6, 4, 8, 6],
    ],
    doors: [['N', 4], ['S', 4]],
    openings: [[3, 1, 4, 1], [5, 1, 6, 1], [3, 3, 4, 3], [5, 3, 6, 3], [4, 3, 4, 4], [2, 5, 3, 5], [5, 5, 6, 5]],
    weakWalls: [[1, 2, 1, 3], [7, 2, 7, 3], [1, 3, 1, 4], [7, 3, 7, 4]],
    primary: [[8, 1]], supplies: [[0, 0], [0, 6], [8, 6]],
    zombies: [[2, 1], [4, 2], [7, 1], [2, 3], [7, 3], [1, 5], [4, 5], [7, 5], [0, 4], [5, 6], [8, 4], [3, 0]],
  },
  {
    name: 'Crow Nest Cabin', cols: 8, rows: 7, roof: 'broken',
    rooms: [
      [0, 0, 2, 2], [3, 0, 4, 2], [5, 0, 7, 2],
      [0, 3, 2, 4], [3, 3, 4, 4], [5, 3, 7, 4],
      [0, 5, 3, 6], [4, 5, 7, 6],
    ],
    doors: [['N', 3], ['S', 5]],
    openings: [[2, 1, 3, 1], [4, 1, 5, 1], [3, 2, 3, 3], [2, 3, 3, 3], [4, 3, 5, 3], [1, 4, 1, 5], [3, 5, 4, 5], [5, 4, 5, 5]],
    weakWalls: [[1, 2, 1, 3], [6, 2, 6, 3], [3, 4, 3, 5], [6, 4, 6, 5]],
    primary: [[7, 1]], supplies: [[0, 1], [0, 6], [7, 6]],
    zombies: [[1, 0], [4, 1], [6, 1], [1, 4], [3, 4], [6, 4], [2, 6], [5, 6], [7, 5], [0, 3], [5, 0], [4, 6]],
  },
  {
    name: 'Ashen Pines House', cols: 10, rows: 8, roof: 'gable',
    rooms: [
      [0, 0, 2, 2], [3, 0, 5, 2], [6, 0, 9, 2],
      [0, 3, 2, 5], [3, 3, 6, 3], [7, 3, 9, 5],
      [3, 4, 6, 5],
      [0, 6, 4, 7], [5, 6, 9, 7],
    ],
    doors: [['N', 4], ['S', 2], ['E', 4]],
    openings: [[2, 1, 3, 1], [5, 1, 6, 1], [4, 2, 4, 3], [2, 3, 3, 3], [6, 3, 7, 3], [5, 3, 5, 4], [1, 5, 1, 6], [4, 6, 5, 6], [5, 5, 5, 6]],
    weakWalls: [[1, 2, 1, 3], [8, 2, 8, 3], [2, 4, 3, 4], [6, 4, 7, 4], [8, 5, 8, 6]],
    primary: [[4, 1]], supplies: [[0, 0], [9, 0], [0, 7], [8, 7]],
    zombies: [[1, 1], [3, 1], [8, 1], [1, 4], [5, 3], [8, 4], [4, 5], [2, 7], [7, 7], [9, 6], [0, 5], [6, 4], [6, 1]],
  },
  {
    name: 'Hunter Lodge', cols: 11, rows: 8, roof: 'lean',
    rooms: [
      [0, 0, 2, 2], [3, 0, 5, 2], [6, 0, 7, 2], [8, 0, 10, 2],
      [0, 3, 10, 3],
      [0, 4, 2, 5], [3, 4, 6, 5], [7, 4, 10, 5],
      [0, 6, 4, 7], [5, 6, 10, 7],
    ],
    doors: [['N', 4], ['S', 2], ['S', 8]],
    openings: [[2, 1, 3, 1], [5, 1, 6, 1], [7, 1, 8, 1], [4, 2, 4, 3], [1, 3, 1, 4], [5, 3, 5, 4], [8, 3, 8, 4], [1, 5, 1, 6], [4, 6, 5, 6], [8, 5, 8, 6]],
    weakWalls: [[1, 2, 1, 3], [9, 2, 9, 3], [2, 5, 3, 5], [6, 5, 7, 5], [5, 5, 5, 6]],
    primary: [[0, 0]], supplies: [[10, 0], [0, 7], [10, 7], [4, 5]],
    zombies: [[1, 1], [4, 1], [6, 1], [9, 1], [2, 3], [7, 3], [1, 5], [4, 4], [9, 4], [2, 7], [7, 7], [10, 6], [5, 5]],
  },
];

export const CABIN_BLUEPRINTS = RAW_CABINS.map((raw, index) => {
  const compiled = compileCabin(raw);
  const palette = PALETTES[index % PALETTES.length];
  return { ...compiled, index, palette, width: raw.cols * CELL, depth: raw.rows * CELL };
});

export function cabinBounds(site) {
  const bp = CABIN_BLUEPRINTS[site.layout];
  const halfW = (bp.cols * CELL) / 2;
  const halfD = (bp.rows * CELL) / 2;
  return { halfW, halfD, radius: Math.hypot(halfW, halfD) };
}

function edgePassable(ch) {
  return ch === '.' || ch === 'D';
}

export function buildCabinSite(entry, area, height, box) {
  const bp = CABIN_BLUEPRINTS[entry.layout];
  const { cols, rows, hEdges, vEdges, palette, roof: roofStyle } = bp;
  const w = cols * CELL;
  const d = rows * CELL;
  const h = WALL_HEIGHT;
  const y = height(entry.x, entry.z) - 0.14;
  const thickness = 0.22;

  const worldX = gc => entry.x - w / 2 + gc * (CELL / 2);
  const worldZ = gr => entry.z - d / 2 + gr * (CELL / 2);
  const cellCenter = (c, r) => ({ x: worldX(c * 2 + 1), z: worldZ(r * 2 + 1) });

  const addWallBox = (cx, cz, bw, bh, bd, base = y, kind = 'districtWall', tint = palette.wall, extra = null) => {
    const collider = box(cx, cz, bw, bh, bd, base, kind, tint);
    if (extra) Object.assign(collider, extra);
    return collider;
  };

  area.props.push({
    x: entry.x, z: entry.z, y: y + 0.04,
    rx: w / 2 + 0.12, ry: 0.06, rz: d / 2 + 0.12,
    kind: 'districtFloor', tint: 0x3b3129,
  });

  const breakableWalls = [];
  const doors = [];

  for (let r = 0; r <= rows; r++) {
    const outer = r === 0 || r === rows;
    const tint = outer ? palette.wall : palette.inner;
    let c = 0;
    while (c < cols) {
      const ch = hEdges[r][c];
      if (ch === '#') {
        let end = c + 1;
        while (end < cols && hEdges[r][end] === '#') end++;
        const span = (end - c) * CELL;
        const cx = (worldX(c * 2) + worldX(end * 2)) / 2;
        addWallBox(cx, worldZ(r * 2), span + thickness * 0.4, h, thickness, y, 'districtWall', tint);
        c = end;
        continue;
      }
      if (ch === '%') {
        const cx = worldX(c * 2 + 1);
        const cz = worldZ(r * 2);
        const wallId = `${entry.id}:bw:h:${r}:${c}`;
        const bw = addWallBox(cx, cz, CELL - 0.04, h - 0.14, 0.18, y, 'breakableWall', palette.weak, {
          id: wallId, cabinId: entry.id, hp: 2, maxHp: 2, broken: false,
          axis: 'h', cellA: [c, r - 1], cellB: [c, r],
        });
        breakableWalls.push(bw);
      } else if (ch === 'D' || ch === '.') {
        const cx = worldX(c * 2 + 1);
        const cz = worldZ(r * 2);
        addWallBox(cx, cz, CELL, h - DOOR_HEIGHT, thickness, y + DOOR_HEIGHT, 'districtLintel', tint);
        if (ch === 'D') doors.push({ x: cx, z: cz, c, r: r === 0 ? 0 : rows - 1, dir: r === 0 ? -1 : 1, axis: 'h' });
      }
      c++;
    }
  }

  for (let c = 0; c <= cols; c++) {
    const outer = c === 0 || c === cols;
    const tint = outer ? palette.wall : palette.inner;
    let r = 0;
    while (r < rows) {
      const ch = vEdges[r][c];
      if (ch === '#') {
        let end = r + 1;
        while (end < rows && vEdges[end][c] === '#') end++;
        const span = (end - r) * CELL;
        const cz = (worldZ(r * 2) + worldZ(end * 2)) / 2;
        addWallBox(worldX(c * 2), cz, thickness, h, span + thickness * 0.4, y, 'districtWall', tint);
        r = end;
        continue;
      }
      if (ch === '%') {
        const cx = worldX(c * 2);
        const cz = worldZ(r * 2 + 1);
        const wallId = `${entry.id}:bw:v:${r}:${c}`;
        const bw = addWallBox(cx, cz, 0.18, h - 0.14, CELL - 0.04, y, 'breakableWall', palette.weak, {
          id: wallId, cabinId: entry.id, hp: 2, maxHp: 2, broken: false,
          axis: 'v', cellA: [c - 1, r], cellB: [c, r],
        });
        breakableWalls.push(bw);
      } else if (ch === 'D' || ch === '.') {
        const cx = worldX(c * 2);
        const cz = worldZ(r * 2 + 1);
        addWallBox(cx, cz, thickness, h - DOOR_HEIGHT, CELL, y + DOOR_HEIGHT, 'districtLintel', tint);
        if (ch === 'D') doors.push({ x: cx, z: cz, c: c === 0 ? 0 : cols - 1, r, dir: c === 0 ? -1 : 1, axis: 'v' });
      }
      r++;
    }
  }

  const addRoof = (rx, rz, rw, rd, base, slope) => {
    const item = addWallBox(entry.x + rx, entry.z + rz, rw, 0.16, rd, base, 'shedRoof', palette.roof);
    item.slope = slope;
  };
  if (roofStyle === 'lean') {
    addRoof(0, 0, w + 0.7, d + 0.7, y + h + 0.55, 0.08);
  } else {
    addRoof(-w / 4, 0, w / 2 + 0.5, d + 0.65, y + h + 0.42, 0.16);
    addRoof(w / 4, 0, w / 2 + 0.5, d + 0.65, y + h + 0.42, -0.16);
    for (const side of [-1, 1]) {
      area.props.push({
        x: entry.x, z: entry.z + side * d / 2, y: y + h + 0.05,
        width: w, height: w * 0.08 + 0.14, kind: 'districtGable', tint: palette.wall,
      });
    }
  }

  // Exterior porch torch/lantern at every cabin + warm interior room light
  const mainDoor = doors[0] || { x: entry.x, z: entry.z - d / 2, dir: -1, axis: 'h' };
  const torchX = mainDoor.x + (mainDoor.axis === 'h' ? 1.15 : mainDoor.dir * 0.95);
  const torchZ = mainDoor.z + (mainDoor.axis === 'h' ? mainDoor.dir * 0.95 : 1.15);
  area.lights.push({
    type: 'lantern',
    x: torchX,
    y: y + 2.25,
    z: torchZ,
    ray: {
      x: mainDoor.axis === 'v' ? mainDoor.dir * 0.45 : 0,
      y: -0.84,
      z: mainDoor.axis === 'h' ? mainDoor.dir * 0.54 : 0,
    },
    radius: 12, angle: 0.85,
  });
  area.lights.push({
    type: 'shelter',
    x: entry.x,
    y: y + h - 0.25,
    z: entry.z,
    ray: { x: 0, y: -0.99, z: 0.1 },
    radius: 10, angle: 0.98,
  });

  const primarySpots = bp.primary.map(([c, r]) => ({ ...cellCenter(c, r), c, r }));
  const supplySpots = bp.supplies.map(([c, r]) => ({ ...cellCenter(c, r), c, r }));
  const zombieSpots = bp.zombies.map(([c, r]) => ({ ...cellCenter(c, r), c, r }));

  const cabin = {
    id: entry.id,
    name: bp.name,
    layout: entry.layout,
    palette: entry.palette,
    x: entry.x,
    z: entry.z,
    y,
    w,
    d,
    cols,
    rows,
    doors,
    primarySpots,
    supplySpots,
    zombieSpots,
    breakableWalls,
    horizontalEdges: hEdges,
    verticalEdges: vEdges,
    worldToCell(wx, wz) {
      const c = Math.max(0, Math.min(cols - 1, Math.floor((wx - (entry.x - w / 2)) / CELL)));
      const r = Math.max(0, Math.min(rows - 1, Math.floor((wz - (entry.z - d / 2)) / CELL)));
      return [c, r];
    },
    roomAt(wx, wz) {
      const [c, r] = this.worldToCell(wx, wz);
      return bp.owner?.[r]?.[c] ?? -1;
    },
    cellCenter,
    contains(wx, wz, margin = 0.5) {
      return Math.abs(wx - entry.x) <= w / 2 + margin && Math.abs(wz - entry.z) <= d / 2 + margin;
    },
  };

  area.buildings.push(cabin);
  return cabin;
}

// Tactical cost-modulated Dijkstra pathfinder (Game AI Pro LoS/exposure avoidance + breakable-wall flanking).
export function findCabinStep(cabin, fromPos, toPos, allowBreakOrOpts = true, preferBreak = false) {
  const opts = typeof allowBreakOrOpts === 'object' && allowBreakOrOpts !== null
    ? allowBreakOrOpts
    : { allowBreak: allowBreakOrOpts, preferBreak };
  const allowBreak = opts.allowBreak ?? true;
  const preferWall = opts.preferBreak ?? false;
  const avoidPos = opts.avoidPos || null;
  const avoidYaw = opts.avoidYaw ?? 0;
  const isExposed = opts.isExposed || null;
  const occupiedCells = opts.occupiedCells || null;

  const [sc, sr] = cabin.worldToCell(fromPos.x, fromPos.z);
  const [tc, tr] = cabin.worldToCell(toPos.x, toPos.z);
  if (sc === tc && sr === tr) return { target: toPos, wall: null, reachable: true };

  const key = (c, r) => r * cabin.cols + c;
  const dist = new Map([[key(sc, sr), 0]]);
  const parent = new Map();
  const queue = [[sc, sr, 0]];
  const fx = Math.sin(avoidYaw), fz = -Math.cos(avoidYaw);

  const wallBetween = (c1, r1, c2, r2) => {
    if (c2 === c1 + 1) return cabin.breakableWalls.find(w => !w.broken && w.axis === 'v' && w.cellA[0] === c1 && w.cellA[1] === r1) || null;
    if (c2 === c1 - 1) return cabin.breakableWalls.find(w => !w.broken && w.axis === 'v' && w.cellA[0] === c2 && w.cellA[1] === r1) || null;
    if (r2 === r1 + 1) return cabin.breakableWalls.find(w => !w.broken && w.axis === 'h' && w.cellA[0] === c1 && w.cellA[1] === r1) || null;
    if (r2 === r1 - 1) return cabin.breakableWalls.find(w => !w.broken && w.axis === 'h' && w.cellA[0] === c1 && w.cellA[1] === r2) || null;
    return null;
  };

  const edgeAt = (c1, r1, c2, r2) => {
    if (c2 === c1 + 1) return cabin.verticalEdges[r1][c1 + 1];
    if (c2 === c1 - 1) return cabin.verticalEdges[r1][c1];
    if (r2 === r1 + 1) return cabin.horizontalEdges[r1 + 1][c1];
    if (r2 === r1 - 1) return cabin.horizontalEdges[r1][c1];
    return '#';
  };

  while (queue.length) {
    queue.sort((a, b) => a[2] - b[2]);
    const [c, r, d] = queue.shift();
    if (c === tc && r === tr) break;
    if (d > (dist.get(key(c, r)) ?? Infinity)) continue;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= cabin.cols || nr < 0 || nr >= cabin.rows) continue;
      const edge = edgeAt(c, r, nc, nr);
      const bw = edge === '%' ? wallBetween(c, r, nc, nr) : null;
      const open = edgePassable(edge) || (edge === '%' && (!bw || bw.broken));
      if (!open && !(allowBreak && bw)) continue;

      let stepCost = open ? 1 : (preferWall ? 0.65 : 2.35);
      const nk = key(nc, nr);
      if (!(nc === tc && nr === tr)) {
        if (occupiedCells?.has(nk)) stepCost += 2.6;
        if (avoidPos) {
          const center = cabin.cellCenter(nc, nr);
          const dx = center.x - avoidPos.x, dz = center.z - avoidPos.z;
          const distToPlayer = Math.hypot(dx, dz) || 1;
          const dot = (dx * fx + dz * fz) / distToPlayer;
          if (isExposed && isExposed(center)) {
            stepCost += dot > 0.35 && distToPlayer < 15 ? 9.5 : 5.5;
          } else if (dot > 0.6 && distToPlayer < 6.5) {
            stepCost += 3.0;
          }
        }
      }

      const cost = d + stepCost;
      if (cost < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, cost);
        parent.set(nk, [c, r]);
        queue.push([nc, nr, cost]);
      }
    }
  }

  let cur = [tc, tr];
  if (!parent.has(key(tc, tr))) return { target: toPos, wall: null, reachable: false };
  while (parent.has(key(cur[0], cur[1]))) {
    const prev = parent.get(key(cur[0], cur[1]));
    if (prev[0] === sc && prev[1] === sr) break;
    cur = prev;
  }
  const blocking = wallBetween(sc, sr, cur[0], cur[1]);
  return { target: cabin.cellCenter(cur[0], cur[1]), wall: blocking, reachable: true };
}
