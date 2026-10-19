// ── Types ──────────────────────────────────────────────────────────────────
export type Color = 'red' | 'green' | 'yellow' | 'blue';
export const COLORS: Color[] = ['red', 'green', 'yellow', 'blue'];

// ── Board layout (15×15 grid, 0-indexed) ──────────────────────────────────
// BOARD_PATH[i] = [row, col] — 52 main-track squares in clockwise order.
// Red exits at index 0.  Green at 13.  Yellow at 26.  Blue at 39.
export const BOARD_PATH: [number, number][] = [
  // 0-4   Red exit → right along row 6
  [6,1],[6,2],[6,3],[6,4],[6,5],
  // 5-10  up along col 6
  [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],
  // 11-12 top-middle (safe at 11)
  [0,7],[0,8],
  // 13-17 Green exit → down along col 8
  [1,8],[2,8],[3,8],[4,8],[5,8],
  // 18-23 right along row 6
  [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
  // 24-25 right-middle (safe at 24)
  [7,14],[8,14],
  // 26-30 Yellow exit → left along row 8
  [8,13],[8,12],[8,11],[8,10],[8,9],
  // 31-36 down along col 8
  [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
  // 37-38 bottom-middle (safe at 37)
  [14,7],[14,6],
  // 39-43 Blue exit → up along col 6
  [13,6],[12,6],[11,6],[10,6],[9,6],
  // 44-49 left along row 8
  [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
  // 50-51 left-middle (safe at 50)
  [7,0],[6,0],
];

// Safe positions on the main track (cannot be captured here)
export const SAFE_SET = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// Each color's "start" index on BOARD_PATH (where they enter from home base)
export const COLOR_START: Record<Color, number> = {
  red: 0, green: 13, yellow: 26, blue: 39,
};

// Home column squares [row, col][] — 6 squares leading into the center triangle
export const HOME_COLUMNS: Record<Color, [number, number][]> = {
  red:    [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
  green:  [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
  yellow: [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
  blue:   [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]],
};

// Token circles in the home-base area [row, col][]
export const HOME_BASES: Record<Color, [number, number][]> = {
  red:    [[1,1],[1,3],[3,1],[3,3]],
  green:  [[1,11],[1,13],[3,11],[3,13]],
  yellow: [[11,11],[11,13],[13,11],[13,13]],
  blue:   [[11,1],[11,3],[13,1],[13,3]],
};

// ── Position encoding ──────────────────────────────────────────────────────
//  -1        : in home base
//   0 – 51   : on main track (relative to color's start)
//  52 – 57   : in home column (52 = 1st square, 57 = 6th = winning square)
//  58        : finished / won

export function getMainPathIndex(color: Color, relPos: number): number {
  return (relPos + COLOR_START[color]) % 52;
}

export function getTokenCoords(color: Color, pos: number): [number, number] | null {
  if (pos === -1 || pos >= 58) return null;
  if (pos <= 51) return BOARD_PATH[getMainPathIndex(color, pos)];
  return HOME_COLUMNS[color][pos - 52];
}

export function isSafe(color: Color, pos: number): boolean {
  if (pos < 0 || pos >= 52) return true;
  return SAFE_SET.has(getMainPathIndex(color, pos));
}

// ── State types ────────────────────────────────────────────────────────────
export interface Token { position: number }

export interface Player {
  color: Color;
  type: 'human' | 'bot';
  name: string;
  connected: boolean;
  tokens: Token[];
}

export interface GameState {
  id: string;
  players: Record<Color, Player>;
  playerOrder: Color[];
  currentTurn: Color;
  dice: number | null;
  diceRolled: boolean;
  movablePieces: number[];
  phase: 'waiting' | 'playing' | 'finished';
  winner: Color | null;
  connectedCount: number;
  createdAt: number;
}

// ── Game logic ─────────────────────────────────────────────────────────────
export function getValidMoves(state: GameState, color: Color, dice: number): number[] {
  const valid: number[] = [];
  for (let i = 0; i < 4; i++) {
    const pos = state.players[color].tokens[i].position;
    if (pos === 58) continue;
    if (pos === -1) { if (dice === 6) valid.push(i); }
    else if (pos + dice <= 57) valid.push(i);
  }
  return valid;
}

export function applyMove(
  state: GameState,
  color: Color,
  tokenIdx: number,
  dice: number,
): { state: GameState; captured: boolean; extraTurn: boolean } {
  const s: GameState = JSON.parse(JSON.stringify(state));
  const token = s.players[color].tokens[tokenIdx];
  let captured = false;

  if (token.position === -1) {
    token.position = 0;
  } else {
    token.position = Math.min(token.position + dice, 57);
    if (token.position === 57) token.position = 58; // reached center → finished
  }

  // Capture check — main track only, non-safe squares
  if (token.position >= 0 && token.position < 52) {
    const myIdx = getMainPathIndex(color, token.position);
    if (!SAFE_SET.has(myIdx)) {
      for (const c of COLORS) {
        if (c === color) continue;
        for (const ot of s.players[c].tokens) {
          if (ot.position >= 0 && ot.position < 52 &&
              getMainPathIndex(c as Color, ot.position) === myIdx) {
            ot.position = -1;
            captured = true;
          }
        }
      }
    }
  }

  // Win check
  if (s.players[color].tokens.every(t => t.position === 58)) {
    s.winner = color;
    s.phase = 'finished';
  }

  const extraTurn = dice === 6 || captured;

  if (!extraTurn && s.phase === 'playing') {
    const idx = s.playerOrder.indexOf(color);
    s.currentTurn = s.playerOrder[(idx + 1) % s.playerOrder.length];
  }
  s.dice = null;
  s.diceRolled = false;
  s.movablePieces = [];
  return { state: s, captured, extraTurn };
}

export function rollDice(): number {
  return Math.floor(Math.random() * 6) + 1;
}

// Simple bot: win > capture > advance furthest token
export function botChooseMove(state: GameState, color: Color): number {
  const dice = state.dice!;
  const moves = getValidMoves(state, color, dice);
  if (!moves.length) return -1;

  const tokens = state.players[color].tokens;

  // Win
  for (const i of moves) {
    if (tokens[i].position !== -1 && tokens[i].position + dice >= 57) return i;
  }

  // Capture
  for (const i of moves) {
    const pos = tokens[i].position;
    if (pos < 0) continue;
    const np = pos + dice;
    if (np < 52) {
      const mainIdx = getMainPathIndex(color, np);
      if (!SAFE_SET.has(mainIdx)) {
        for (const c of COLORS) {
          if (c === color) continue;
          for (const ot of state.players[c].tokens) {
            if (ot.position >= 0 && ot.position < 52 &&
                getMainPathIndex(c as Color, ot.position) === mainIdx) return i;
          }
        }
      }
    }
  }

  // Furthest token
  let best = moves[0];
  for (const i of moves) {
    if (tokens[i].position > tokens[best].position) best = i;
  }
  return best;
}

export function createInitialState(id: string): GameState {
  const mk = () => [0,1,2,3].map(() => ({ position: -1 }));
  return {
    id,
    players: {
      red:    { color: 'red',    type: 'bot', name: 'Red',    connected: false, tokens: mk() },
      green:  { color: 'green',  type: 'bot', name: 'Green',  connected: false, tokens: mk() },
      yellow: { color: 'yellow', type: 'bot', name: 'Yellow', connected: false, tokens: mk() },
      blue:   { color: 'blue',   type: 'bot', name: 'Blue',   connected: false, tokens: mk() },
    },
    playerOrder: ['red', 'green', 'yellow', 'blue'],
    currentTurn: 'red',
    dice: null,
    diceRolled: false,
    movablePieces: [],
    phase: 'waiting',
    winner: null,
    connectedCount: 0,
    createdAt: Date.now(),
  };
}
