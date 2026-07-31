import type { Color, PieceSymbol, Square } from "chess.js";
import { TemplarChess, pieceValue, SQUARES } from "./engine";

const PST: Record<Exclude<PieceSymbol, "k">, number[][]> = {
  p: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  n: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  b: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  r: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0],
  ],
  q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
};

const KING_MG: number[][] = [
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-20, -30, -30, -40, -40, -30, -30, -20],
  [-10, -20, -20, -20, -20, -20, -20, -20],
  [20, 20, 0, 0, 0, 0, 20, 20],
  [20, 30, 10, 0, 0, 10, 30, 20],
];

function pstScore(type: PieceSymbol, color: Color, square: Square): number {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1]!, 10) - 1;
  const r = color === "w" ? 7 - rank : rank;
  if (type === "k") return KING_MG[r]![file]!;
  return PST[type][r]![file]!;
}

/** Static material + PST only (no Templar lookahead). */
function evaluateStatic(game: TemplarChess): number {
  let score = 0;
  for (const sq of SQUARES) {
    const p = game.get(sq);
    if (!p) continue;
    const mat = pieceValue(p.type) * 100;
    const pos = pstScore(p.type, p.color, sq);
    score += p.color === "w" ? mat + pos : -(mat + pos);
  }
  if (game.isCheck()) {
    score += game.turn() === "w" ? -35 : 35;
  }
  return score;
}

/**
 * White-POV evaluation. When a Templar recapture is legal, also evaluates the
 * position after the take-back and keeps the better score for the side to move.
 */
export function evaluate(game: TemplarChess): number {
  if (game.isGameOver()) {
    const s = game.status();
    if (s === "checkmate") return game.turn() === "w" ? -100_000 : 100_000;
    return 0;
  }

  const base = evaluateStatic(game);
  const templars = game.moves().filter((m) => m.isTemplar);
  if (templars.length === 0) return base;

  const stm = game.turn();
  let best = base;
  for (const m of templars) {
    const next = game.clone();
    next.applyMove(m);
    // Opponent to move after recapture — static eval of resulting board
    let after: number;
    if (next.isGameOver()) {
      const s = next.status();
      after = s === "checkmate" ? (next.turn() === "w" ? -100_000 : 100_000) : 0;
    } else {
      after = evaluateStatic(next);
    }
    if (stm === "w" ? after > best : after < best) {
      best = after;
    }
  }
  return best;
}

export function orderMoves(game: TemplarChess) {
  const moves = game.moves();
  return moves.sort((a, b) => {
    const score = (m: typeof a) => {
      let s = 0;
      if (m.captured) s += 10 + pieceValue(m.captured) * 10 - pieceValue(m.piece);
      if (m.isTemplar) s += 40 + (m.captured ? pieceValue(m.captured) * 12 : 0);
      if (m.promotion) s += 80;
      return s;
    };
    return score(b) - score(a);
  });
}
