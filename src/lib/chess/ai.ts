import type { PieceSymbol, Square } from "chess.js";
import { TemplarChess, pieceValue } from "./engine";
import { evaluate, orderMoves } from "./eval";
import { getStockfish } from "./stockfish";
import type { DifficultyLevel, GameMove } from "./types";
import { DIFFICULTY_LEVELS } from "./types";

export function getDifficulty(id: string): DifficultyLevel {
  return DIFFICULTY_LEVELS.find((d) => d.id === id) ?? DIFFICULTY_LEVELS[2]!;
}

const MATE = 90_000;

function orderedLimited(game: TemplarChess, maxMoves = 24): GameMove[] {
  const moves = orderMoves(game);
  if (moves.length <= maxMoves) return moves;
  const priority: GameMove[] = [];
  const quiet: GameMove[] = [];
  for (const m of moves) {
    if (m.captured || m.isTemplar || m.promotion) priority.push(m);
    else quiet.push(m);
  }
  const out = [...priority];
  for (const m of quiet) {
    if (out.length >= maxMoves) break;
    out.push(m);
  }
  return out;
}

function minimax(
  game: TemplarChess,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  deadline: number,
): number {
  if (Date.now() > deadline) return evaluate(game);
  if (depth === 0 || game.isGameOver()) return evaluate(game);

  const moves = orderedLimited(game, depth >= 3 ? 14 : 20);
  if (moves.length === 0) return evaluate(game);

  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      game.applyMove(m);
      const score = minimax(game, depth - 1, alpha, beta, false, deadline);
      game.undo();
      best = Math.max(best, score);
      alpha = Math.max(alpha, score);
      if (beta <= alpha) break;
      if (Date.now() > deadline) break;
    }
    return best;
  }

  let best = Infinity;
  for (const m of moves) {
    game.applyMove(m);
    const score = minimax(game, depth - 1, alpha, beta, true, deadline);
    game.undo();
    best = Math.min(best, score);
    beta = Math.min(beta, score);
    if (beta <= alpha) break;
    if (Date.now() > deadline) break;
  }
  return best;
}

function pickWithBlunder(
  scored: { move: GameMove; score: number }[],
  blunderRate: number,
): GameMove {
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 1) return scored[0]!.move;

  if (Math.random() < blunderRate) {
    const start = Math.min(1, scored.length - 1);
    const weak = scored.slice(start, Math.max(start + 1, Math.ceil(scored.length * 0.5)));
    return weak[Math.floor(Math.random() * weak.length)]!.move;
  }

  if (
    scored.length > 1 &&
    Math.abs(scored[0]!.score - scored[1]!.score) < 25 &&
    Math.random() < 0.2
  ) {
    return scored[1]!.move;
  }
  return scored[0]!.move;
}

function timeBudgetMs(level: DifficultyLevel): number {
  switch (level.id) {
    case "beginner":
      return 80;
    case "novice":
      return 250;
    case "intermediate":
      return 450;
    case "club":
      return 700;
    case "expert":
      return 1100;
    case "master":
      return 1600;
    default:
      return 900;
  }
}

async function minimaxMove(game: TemplarChess, level: DifficultyLevel): Promise<GameMove> {
  const moves = orderedLimited(game, 28);
  if (moves.length === 0) throw new Error("No legal moves");

  if (level.id === "beginner") {
    const captures = moves
      .filter((m) => m.captured)
      .sort(
        (a, b) =>
          pieceValue(b.captured!) * (b.isTemplar ? 1.15 : 1) -
          pieceValue(a.captured!) * (a.isTemplar ? 1.15 : 1),
      );
    if (captures.length && Math.random() < 0.55) return captures[0]!;
    if (captures.length && Math.random() < 0.3) {
      return captures[Math.min(captures.length - 1, Math.floor(Math.random() * 3))]!;
    }
    return moves[Math.floor(Math.random() * moves.length)]!;
  }

  const maximizing = game.turn() === "w";
  const deadline = Date.now() + timeBudgetMs(level);
  const rootDepth = Math.min(level.depth, 3);
  const work = game.clone();

  let bestScored: { move: GameMove; score: number }[] = moves.map((m) => ({
    move: m,
    score: m.captured ? pieceValue(m.captured) * 10 : 0,
  }));

  for (let depth = 1; depth <= rootDepth; depth++) {
    if (Date.now() > deadline) break;
    const scored: { move: GameMove; score: number }[] = [];
    const ordered = bestScored.map((s) => s.move);

    for (let i = 0; i < ordered.length; i++) {
      const m = ordered[i]!;
      if (Date.now() > deadline && scored.length > 0) break;
      work.applyMove(m);
      const raw = minimax(work, depth - 1, -Infinity, Infinity, !maximizing, deadline);
      work.undo();
      scored.push({ move: m, score: maximizing ? raw : -raw });
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    if (scored.length) {
      scored.sort((a, b) => b.score - a.score);
      bestScored = scored;
      if (scored[0]!.score > MATE / 2) break;
    }
  }

  return pickWithBlunder(bestScored, level.blunderRate ?? 0);
}

function parseUci(uci: string): { from: Square; to: Square; promotion?: PieceSymbol } | null {
  if (uci.length < 4) return null;
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promo = uci[4] as PieceSymbol | undefined;
  return { from, to, promotion: promo };
}

async function stockfishMove(game: TemplarChess, level: DifficultyLevel): Promise<GameMove> {
  const sf = getStockfish();
  await sf.init();
  if (level.skill !== undefined) await sf.setSkill(level.skill);

  const moves = orderedLimited(game, 22);
  if (moves.length === 0) throw new Error("No legal moves");

  const maximizing = game.turn() === "w";
  const fen = game.fen();

  let sfPreferred: string | null = null;
  try {
    sfPreferred = await sf.bestMove(fen, {
      depth: Math.min(level.depth, 10),
      movetime: Math.min(level.movetime ?? 400, 600),
      skill: level.skill,
    });
  } catch {
    return minimaxMove(game, { ...level, engine: "minimax", depth: 2 });
  }

  const candidates: GameMove[] = [];
  const seen = new Set<string>();
  const add = (m: GameMove) => {
    const k = `${m.from}${m.to}${m.promotion ?? ""}${m.isTemplar ? "T" : ""}`;
    if (!seen.has(k)) {
      seen.add(k);
      candidates.push(m);
    }
  };

  if (sfPreferred) {
    const parsed = parseUci(sfPreferred);
    if (parsed) {
      const match = game.findMove(parsed.from, parsed.to, parsed.promotion);
      if (match) add(match);
    }
  }
  for (const m of moves) {
    if (m.captured || m.isTemplar || m.promotion) add(m);
  }
  for (const m of moves) {
    if (candidates.length >= 10) break;
    add(m);
  }

  const scored: { move: GameMove; score: number }[] = [];
  const evalDepth = level.id === "stockfish" ? 5 : level.id === "gm" ? 4 : 3;

  for (let i = 0; i < candidates.length; i++) {
    const m = candidates[i]!;
    const next = game.clone();
    next.applyMove(m);
    let score: number;
    try {
      const local = evaluate(next);
      if (!m.isTemplar && !m.captured && i > 2 && sfPreferred) {
        score = local;
      } else {
        const sfScore = await sf.evaluateFen(next.fen(), evalDepth);
        score = m.isTemplar ? local * 0.5 + sfScore * 0.5 : local * 0.2 + sfScore * 0.8;
      }
    } catch {
      score = evaluate(next);
    }

    if (sfPreferred && m.lan.startsWith(sfPreferred.slice(0, 4)) && !m.isTemplar) {
      score += maximizing ? 30 : -30;
    }

    scored.push({ move: m, score: maximizing ? score : -score });
    await new Promise((r) => setTimeout(r, 0));
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.move;
}

export async function chooseAiMove(
  game: TemplarChess,
  level: DifficultyLevel,
): Promise<GameMove> {
  if (level.engine === "stockfish") {
    try {
      return await stockfishMove(game, level);
    } catch {
      return minimaxMove(game, { ...level, engine: "minimax", depth: 2 });
    }
  }
  return minimaxMove(game, level);
}

export async function preloadStockfish(): Promise<void> {
  try {
    await getStockfish().init();
  } catch {
    // optional
  }
}
