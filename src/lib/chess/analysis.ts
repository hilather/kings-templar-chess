import { TemplarChess } from "./engine";
import { evaluate } from "./eval";
import { getStockfish, type AnalysisResult } from "./stockfish";
import type { Color, GameMove } from "./types";

export type MoveQuality =
  | "best"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export type PositionEval = {
  /** White POV centipawns (Templar-aware when recapture was available). */
  scoreCp: number;
  mate: number | null;
  source: "stockfish" | "local";
  /**
   * True when a legal Templar recapture improved the eval vs raw Stockfish,
   * so the score assumes the side to move takes back.
   */
  templarImproved?: boolean;
  /** Raw Stockfish score before applying Templar option (if different). */
  rawScoreCp?: number;
};

export type MoveAnnotation = {
  ply: number;
  move: GameMove;
  quality: MoveQuality | null;
  /** Centipawn loss for the side that moved (approx). */
  lossCp: number;
  evalBefore: PositionEval;
  evalAfter: PositionEval;
  /** True if a Templar recapture was legal and better, but not played. */
  missedTemplar?: boolean;
};

export function rebuildAt(history: GameMove[], ply: number): TemplarChess {
  const g = new TemplarChess();
  const n = Math.max(0, Math.min(ply, history.length));
  for (let i = 0; i < n; i++) {
    g.applyMove(history[i]!);
  }
  return g;
}

export function formatEval(ev: PositionEval): string {
  if (ev.mate !== null) {
    return ev.mate > 0 ? `M${ev.mate}` : `-M${Math.abs(ev.mate)}`;
  }
  const p = ev.scoreCp / 100;
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}`;
}

/**
 * Eval bar fill % from white's perspective (0–100, 50 = equal).
 * Scaled so even ~0.5 pawns is clearly visible on the bar.
 */
export function evalBarPercent(ev: PositionEval | null): number {
  if (!ev) return 50;
  if (ev.mate !== null) {
    return ev.mate > 0 ? 97 : 3;
  }
  // Chess.com-ish: expand mid-range so small advantages read
  // ±1.0 pawn → ~70/30, ±3.0 → ~88/12, ±6+ near extremes
  const pawns = Math.max(-12, Math.min(12, ev.scoreCp / 100));
  const t = Math.tanh(pawns * 0.75);
  return Math.round(50 + t * 47);
}

export function classifyLoss(lossCp: number): MoveQuality {
  if (lossCp < 30) return "best";
  if (lossCp < 80) return "good";
  if (lossCp < 150) return "inaccuracy";
  if (lossCp < 300) return "mistake";
  return "blunder";
}

function effectiveCp(ev: Pick<PositionEval, "scoreCp" | "mate">): number {
  if (ev.mate !== null) {
    return ev.mate > 0 ? 100_000 - ev.mate * 100 : -100_000 - Math.abs(ev.mate) * 100;
  }
  return ev.scoreCp;
}

function betterFor(side: Color, a: PositionEval, b: PositionEval): boolean {
  const ae = effectiveCp(a);
  const be = effectiveCp(b);
  return side === "w" ? ae > be : ae < be;
}

function resultToEval(r: AnalysisResult): PositionEval {
  return { scoreCp: r.scoreCp, mate: r.mate, source: "stockfish" };
}

function localEval(game: TemplarChess): PositionEval {
  if (game.isGameOver()) {
    const s = game.status();
    if (s === "checkmate") {
      return {
        scoreCp: game.turn() === "w" ? -100_000 : 100_000,
        mate: game.turn() === "w" ? -1 : 1,
        source: "local",
      };
    }
    return { scoreCp: 0, mate: null, source: "local" };
  }
  return { scoreCp: evaluate(game), mate: null, source: "local" };
}

type RawEvalFn = (game: TemplarChess) => Promise<PositionEval>;

/**
 * Templar-aware evaluation:
 * score the position, then if a take-back is legal, score after it and keep
 * the better result for the side to move.
 */
export async function evaluateTemplarAware(
  game: TemplarChess,
  rawEval: RawEvalFn,
): Promise<PositionEval> {
  if (game.isGameOver()) {
    return localEval(game);
  }

  const base = await rawEval(game);
  const templars = game.moves().filter((m) => m.isTemplar);
  if (templars.length === 0) {
    return base;
  }

  const stm = game.turn();
  let best = base;
  let improved = false;

  for (const m of templars) {
    const next = game.clone();
    next.applyMove(m);
    const after = await rawEval(next);
    if (betterFor(stm, after, best)) {
      best = after;
      improved = true;
    }
  }

  if (!improved) return base;

  return {
    ...best,
    templarImproved: true,
    rawScoreCp: base.scoreCp,
  };
}

function buildAnnotations(
  history: GameMove[],
  evals: PositionEval[],
): MoveAnnotation[] {
  const annotations: MoveAnnotation[] = [];
  for (let i = 0; i < history.length; i++) {
    const move = history[i]!;
    const before = evals[i];
    const after = evals[i + 1];
    if (!before || !after) continue;

    const beforeMover = move.color === "w" ? before.scoreCp : -before.scoreCp;
    const afterMover = move.color === "w" ? after.scoreCp : -after.scoreCp;
    const b = Math.max(-2000, Math.min(2000, beforeMover));
    const a = Math.max(-2000, Math.min(2000, afterMover));
    const lossCp = Math.max(0, b - a);

    let missedTemplar = false;
    if (!move.isTemplar && before.templarImproved) {
      missedTemplar = lossCp >= 30;
    }

    annotations.push({
      ply: i,
      move,
      quality: classifyLoss(lossCp),
      lossCp,
      evalBefore: before,
      evalAfter: after,
      missedTemplar,
    });
  }
  return annotations;
}

/**
 * Analyze every position with Templar-aware Stockfish (fallback local).
 * Streams results via onPosition so the eval bar updates live.
 */
export async function analyzeGame(
  history: GameMove[],
  opts: {
    depth?: number;
    signal?: { cancelled: boolean };
    onProgress?: (done: number, total: number) => void;
    onPosition?: (ply: number, ev: PositionEval, evals: PositionEval[]) => void;
  } = {},
): Promise<{ evals: PositionEval[]; annotations: MoveAnnotation[] }> {
  const depth = opts.depth ?? 12;
  const total = history.length + 1;
  const evals: PositionEval[] = new Array(total);
  const sf = getStockfish();

  let useSf = true;
  try {
    await sf.init();
    await sf.setFullStrength();
  } catch {
    useSf = false;
  }

  const rawEval: RawEvalFn = async (game) => {
    if (!useSf) return localEval(game);
    try {
      const r = await sf.analyzePosition(game.fen(), depth, 250);
      return resultToEval(r);
    } catch {
      try {
        const r = await sf.analyzePosition(game.fen(), Math.min(depth, 8));
        return resultToEval(r);
      } catch {
        useSf = false;
        return localEval(game);
      }
    }
  };

  const emit = (ply: number) => {
    // Always send a dense copy so React state indices match plies
    const copy = evals.map((e, i) =>
      e ?? { scoreCp: 0, mate: null, source: "local" as const },
    );
    if (evals[ply]) opts.onPosition?.(ply, evals[ply]!, copy);
  };

  // Seed with fast local evals immediately so the bar isn't stuck at 50
  for (let ply = 0; ply <= history.length; ply++) {
    if (opts.signal?.cancelled) break;
    const g = rebuildAt(history, ply);
    evals[ply] = await evaluateTemplarAware(g, async (gg) => localEval(gg));
    emit(ply);
  }
  opts.onProgress?.(0, total);

  // Refine with Stockfish
  for (let ply = 0; ply <= history.length; ply++) {
    if (opts.signal?.cancelled) break;
    const g = rebuildAt(history, ply);
    try {
      evals[ply] = await evaluateTemplarAware(g, rawEval);
      emit(ply);
    } catch {
      // keep local seed
    }
    opts.onProgress?.(ply + 1, total);
    await new Promise((r) => setTimeout(r, 0));
  }

  for (let ply = 0; ply < total; ply++) {
    if (!evals[ply]) {
      const g = rebuildAt(history, ply);
      evals[ply] = await evaluateTemplarAware(g, async (gg) => localEval(gg));
    }
  }

  const finalEvals = evals as PositionEval[];
  return {
    evals: finalEvals,
    annotations: buildAnnotations(history, finalEvals),
  };
}

export const QUALITY_LABEL: Record<MoveQuality, string> = {
  best: "Best",
  good: "Good",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
};

export const QUALITY_COLOR: Record<MoveQuality, string> = {
  best: "text-primary",
  good: "text-primary/80",
  inaccuracy: "text-warn",
  mistake: "text-warn",
  blunder: "text-danger",
};
