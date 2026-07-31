import { TemplarChess } from "./engine";
import { evaluate, orderMoves } from "./eval";
import { getStockfish } from "./stockfish";
import type { GameMove, PieceSymbol, Square } from "./types";

export type TrainingHint = {
  move: GameMove;
  /** White-POV score of the position after the suggested move. */
  scoreCp: number;
  /** Higher = better for the side that would play the hint. */
  scoreForSide: number;
  source: "stockfish" | "local";
  /** True if this move delivers checkmate. */
  isMate?: boolean;
  /** True while a deeper refine may still replace this hint. */
  provisional?: boolean;
};

const MATE_SCORE = 100_000;

function parseUci(uci: string): { from: Square; to: Square; promotion?: PieceSymbol } | null {
  if (uci.length < 4) return null;
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci[4] as PieceSymbol | undefined,
  };
}

function moveKey(m: GameMove): string {
  return `${m.from}${m.to}${m.promotion ?? ""}${m.isTemplar ? "T" : ""}`;
}

function forSide(whiteCp: number, stm: "w" | "b"): number {
  return stm === "w" ? whiteCp : -whiteCp;
}

/**
 * Score the position after `move` for the side that just played.
 * Local evaluate already models opponent's Templar take-back when helpful.
 * Mutates `game` via apply/undo — pass a clone of the live engine.
 */
function scoreMoveLocal(
  game: TemplarChess,
  move: GameMove,
  stm: "w" | "b",
): { whiteCp: number; forSide: number; mate: boolean } {
  game.applyMove(move);
  let whiteCp: number;
  let mate = false;
  if (game.status() === "checkmate") {
    whiteCp = game.turn() === "w" ? -MATE_SCORE : MATE_SCORE;
    mate = true;
  } else if (game.isGameOver()) {
    whiteCp = 0;
  } else {
    whiteCp = evaluate(game);
  }
  game.undo();
  return { whiteCp, forSide: forSide(whiteCp, stm), mate };
}

function rankMovesLocal(game: TemplarChess): {
  ranked: { move: GameMove; whiteCp: number; forSide: number; mate: boolean }[];
  mateMove: GameMove | null;
} {
  const stm = game.turn();
  const all = orderMoves(game);
  const ranked: { move: GameMove; whiteCp: number; forSide: number; mate: boolean }[] = [];
  let mateMove: GameMove | null = null;

  for (const m of all) {
    const s = scoreMoveLocal(game, m, stm);
    ranked.push({ move: m, ...s });
    if (s.mate && !mateMove) mateMove = m;
  }

  ranked.sort((a, b) => b.forSide - a.forSide);
  return { ranked, mateMove };
}

/**
 * Best move for training — fast path first, then light Stockfish refine.
 *
 * Profile (opening, browser):
 *  - local rank all moves: ~10–40ms  → arrow via onPartial
 *  - SF bestmove: ~100–150ms
 *  - SF refine ≤4 candidates × ~70ms: ~300ms
 *  - total typically < 700ms (was multi-second with 22×280ms evals)
 */
export async function findBestTrainingMove(
  root: TemplarChess,
  opts: {
    signal?: { cancelled: boolean };
    movetime?: number;
    onPartial?: (hint: TrainingHint) => void;
  } = {},
): Promise<TrainingHint | null> {
  if (root.isGameOver()) return null;

  const game = root.clone();
  const stm = game.turn();
  const movetime = opts.movetime ?? 70;

  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { ranked, mateMove } = rankMovesLocal(game);
  const localMs =
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;

  if (ranked.length === 0) return null;

  if (mateMove) {
    const hint: TrainingHint = {
      move: mateMove,
      scoreCp: stm === "w" ? MATE_SCORE : -MATE_SCORE,
      scoreForSide: MATE_SCORE,
      source: "local",
      isMate: true,
    };
    opts.onPartial?.(hint);
    return hint;
  }

  const bestLocal = ranked[0]!;
  const provisional: TrainingHint = {
    move: bestLocal.move,
    scoreCp: bestLocal.whiteCp,
    scoreForSide: bestLocal.forSide,
    source: "local",
    provisional: true,
  };
  opts.onPartial?.(provisional);

  if (opts.signal?.cancelled) return { ...provisional, provisional: false };

  // Obvious local winner — skip SF
  const second = ranked[1];
  if (second && bestLocal.forSide - second.forSide >= 400) {
    return { ...provisional, provisional: false };
  }

  const candidates: GameMove[] = [];
  const seen = new Set<string>();
  const add = (m: GameMove) => {
    const k = moveKey(m);
    if (seen.has(k)) return;
    seen.add(k);
    candidates.push(m);
  };

  // Prioritize tactical local moves, then top quiet
  for (const r of ranked) {
    if (r.move.isTemplar || r.move.captured || r.move.promotion || r.move.san.includes("+")) {
      add(r.move);
    }
  }
  for (const r of ranked.slice(0, 4)) add(r.move);

  let useSf = true;
  const sf = getStockfish();
  try {
    await sf.init();
    await sf.setFullStrength();
    if (opts.signal?.cancelled) return { ...provisional, provisional: false };

    // Single root search — also used as strong candidate
    const preferred = await sf.bestMove(game.fen(), {
      movetime: Math.min(movetime + 50, 120),
      depth: 11,
    });
    if (preferred) {
      const p = parseUci(preferred);
      if (p) {
        const match = game.findMove(p.from, p.to, p.promotion);
        if (match) {
          // SF pick goes first in refine list
          const rest = candidates.filter((m) => moveKey(m) !== moveKey(match));
          candidates.length = 0;
          candidates.push(match, ...rest);
        }
      }
    }
  } catch {
    useSf = false;
  }

  if (opts.signal?.cancelled || !useSf) {
    return { ...provisional, provisional: false };
  }

  // ≤4 deep evals — biggest speed win vs old 22×280ms
  const toScore = candidates.slice(0, 4);
  let best: TrainingHint = { ...provisional, provisional: false };

  for (const m of toScore) {
    if (opts.signal?.cancelled) break;

    game.applyMove(m);
    if (game.status() === "checkmate") {
      game.undo();
      return {
        move: m,
        scoreCp: stm === "w" ? MATE_SCORE : -MATE_SCORE,
        scoreForSide: MATE_SCORE,
        source: "local",
        isMate: true,
      };
    }

    let whiteCp = evaluate(game);
    // Capture Templar replies only (0–1) — don't re-search full tree
    const templars = game.moves().filter((x) => x.isTemplar);

    try {
      // Prefer SF preferred move's root score without re-search when match
      const base = await sf.analyzePosition(game.fen(), 9, movetime);
      whiteCp = base.scoreCp;

      for (const t of templars) {
        if (opts.signal?.cancelled) break;
        game.applyMove(t);
        try {
          const r = await sf.analyzePosition(game.fen(), 7, Math.min(movetime, 50));
          const after = r.scoreCp;
          if (stm === "w" ? after < whiteCp : after > whiteCp) whiteCp = after;
        } catch {
          const after = evaluate(game);
          if (stm === "w" ? after < whiteCp : after > whiteCp) whiteCp = after;
        }
        game.undo();
      }
    } catch {
      /* local already set */
    }

    game.undo();

    const side = forSide(whiteCp, stm);
    const localRow = ranked.find((r) => moveKey(r.move) === moveKey(m));
    const blended = side * 0.72 + (localRow?.forSide ?? side) * 0.28;

    if (blended > best.scoreForSide) {
      best = {
        move: m,
        scoreCp: whiteCp,
        scoreForSide: blended,
        source: "stockfish",
      };
    }
  }

  if (typeof console !== "undefined" && console.debug) {
    console.debug(
      `[training] local ${localMs.toFixed(0)}ms · sf-cands ${toScore.length} · ${best.move.san}`,
    );
  }

  return best;
}
