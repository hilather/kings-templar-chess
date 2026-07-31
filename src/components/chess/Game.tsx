import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Crown,
  FlipVertical2,
  GraduationCap,
  Info,
  Lightbulb,
  LineChart,
  Loader2,
  RotateCcw,
  Swords,
  Undo2,
} from "lucide-react";
import { TemplarChess } from "@/lib/chess/engine";
import { chooseAiMove, getDifficulty, preloadStockfish } from "@/lib/chess/ai";
import {
  analyzeGame,
  formatEval,
  QUALITY_COLOR,
  QUALITY_LABEL,
  rebuildAt,
  type MoveAnnotation,
  type PositionEval,
} from "@/lib/chess/analysis";
import {
  findBestTrainingMove,
  type TrainingHint,
} from "@/lib/chess/training";
import {
  DIFFICULTY_LEVELS,
  type Color,
  type DifficultyId,
  type GameMove,
  type PieceSymbol,
  type Square,
} from "@/lib/chess/types";
import { Board, findKingSquare, piecesFromBoard } from "./Board";
import { EvalBar } from "./EvalBar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Phase = "menu" | "playing" | "ended" | "analysis";
type EndReason = "checkmate" | "stalemate" | "draw" | "resign" | null;

const PROMO_PIECES: PieceSymbol[] = ["q", "r", "b", "n"];

export function Game() {
  const [phase, setPhase] = useState<Phase>("menu");
  const [playerColor, setPlayerColor] = useState<Color>("w");
  const [difficultyId, setDifficultyId] = useState<DifficultyId>("intermediate");
  const [trainingMode, setTrainingMode] = useState(false);
  const [engine, setEngine] = useState(() => new TemplarChess());
  const [selected, setSelected] = useState<Square | null>(null);
  const [legalMoves, setLegalMoves] = useState<GameMove[]>([]);
  const [aiThinking, setAiThinking] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [endReason, setEndReason] = useState<EndReason>(null);
  const [winner, setWinner] = useState<Color | null>(null);
  const [showEndModal, setShowEndModal] = useState(false);
  const [flip, setFlip] = useState(false);
  const [pendingPromo, setPendingPromo] = useState<{
    from: Square;
    to: Square;
  } | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [moveTick, setMoveTick] = useState(0);

  const [analysisHistory, setAnalysisHistory] = useState<GameMove[]>([]);
  const [analysisPly, setAnalysisPly] = useState(0);
  const [evals, setEvals] = useState<PositionEval[]>([]);
  const [annotations, setAnnotations] = useState<MoveAnnotation[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ done: 0, total: 0 });
  const analysisCancel = useRef({ cancelled: false });

  const [trainingHint, setTrainingHint] = useState<TrainingHint | null>(null);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const trainingCancel = useRef({ cancelled: false });

  const aiCancel = useRef(0);
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const difficulty = getDifficulty(difficultyId);
  const orientation: Color = flip ? (playerColor === "w" ? "b" : "w") : playerColor;

  const isAnalysis = phase === "analysis";
  const liveHistory = engine.getHistory();
  const history = isAnalysis ? analysisHistory : liveHistory;

  const viewGame = useMemo(() => {
    if (isAnalysis) return rebuildAt(analysisHistory, analysisPly);
    return engine;
  }, [isAnalysis, analysisHistory, analysisPly, engine, moveTick]);

  const pieces = useMemo(
    () => piecesFromBoard(viewGame.board()),
    [viewGame, moveTick, analysisPly, isAnalysis],
  );

  const lastMove = useMemo(() => {
    if (isAnalysis) {
      if (analysisPly === 0) return null;
      const m = analysisHistory[analysisPly - 1];
      return m ? { from: m.from, to: m.to } : null;
    }
    if (!liveHistory.length) return null;
    const m = liveHistory[liveHistory.length - 1]!;
    return { from: m.from, to: m.to };
  }, [isAnalysis, analysisPly, analysisHistory, liveHistory]);

  const checkSquare = viewGame.isCheck()
    ? findKingSquare(pieces, viewGame.turn())
    : null;

  const legalTargets = legalMoves.map((m) => m.to);
  const templarTargets = legalMoves.filter((m) => m.isTemplar).map((m) => m.to);
  const templarAvailable =
    !isAnalysis && engine.templarRecaptureSquare() !== null && phase === "playing";

  const material = viewGame.material();
  const materialDiff =
    playerColor === "w" ? material.w - material.b : material.b - material.w;

  const currentEval: PositionEval | null = isAnalysis
    ? (evals[analysisPly] ?? null)
    : null;
  const currentAnnotation: MoveAnnotation | null =
    isAnalysis && analysisPly > 0
      ? (annotations[analysisPly - 1] ?? null)
      : null;

  const isPlayerTurn =
    phase === "playing" && !aiThinking && engine.turn() === playerColor;

  const boardHint =
    trainingMode && isPlayerTurn && trainingHint
      ? {
          from: trainingHint.move.from,
          to: trainingHint.move.to,
          isTemplar: trainingHint.move.isTemplar,
        }
      : null;

  const refreshStatus = useCallback((g: TemplarChess) => {
    const s = g.status();
    if (s === "checkmate") {
      setEndReason("checkmate");
      setWinner(g.winner());
      setPhase("ended");
      setShowEndModal(true);
      setStatusMsg("Checkmate");
    } else if (s === "stalemate") {
      setEndReason("stalemate");
      setWinner(null);
      setPhase("ended");
      setShowEndModal(true);
      setStatusMsg("Stalemate");
    } else if (s === "draw") {
      setEndReason("draw");
      setWinner(null);
      setPhase("ended");
      setShowEndModal(true);
      setStatusMsg("Draw");
    } else if (s === "check") {
      setStatusMsg("Check!");
    } else {
      setStatusMsg(g.turn() === "w" ? "White to move" : "Black to move");
    }
  }, []);

  const startGame = (color: Color, diff: DifficultyId) => {
    aiCancel.current += 1;
    analysisCancel.current.cancelled = true;
    trainingCancel.current.cancelled = true;
    const g = new TemplarChess();
    setEngine(g);
    setPlayerColor(color);
    setDifficultyId(diff);
    setSelected(null);
    setLegalMoves([]);
    setPendingPromo(null);
    setEndReason(null);
    setWinner(null);
    setShowEndModal(false);
    setAiThinking(false);
    setPhase("playing");
    setFlip(false);
    setMoveTick((t) => t + 1);
    setAnalysisHistory([]);
    setEvals([]);
    setAnnotations([]);
    setAnalysisPly(0);
    setAnalysisLoading(false);
    setTrainingHint(null);
    setTrainingLoading(false);
    refreshStatus(g);
    void preloadStockfish();
  };

  const enterAnalysis = useCallback(
    (sourceHistory?: GameMove[]) => {
      const h = sourceHistory ?? engine.getHistory();
      if (h.length === 0) return;
      aiCancel.current += 1;
      trainingCancel.current.cancelled = true;
      setAiThinking(false);
      setSelected(null);
      setLegalMoves([]);
      setPendingPromo(null);
      setShowEndModal(false);
      setTrainingHint(null);

      setAnalysisHistory(h.map((m) => ({ ...m })));
      setAnalysisPly(h.length);
      setEvals([]);
      setAnnotations([]);
      setPhase("analysis");
      setStatusMsg("Analysis");

      analysisCancel.current = { cancelled: false };
      setAnalysisLoading(true);
      setAnalysisProgress({ done: 0, total: h.length + 1 });

      void (async () => {
        try {
          const result = await analyzeGame(h, {
            depth: 12,
            signal: analysisCancel.current,
            onProgress: (done, total) => setAnalysisProgress({ done, total }),
            onPosition: (_ply, _ev, partial) => {
              setEvals([...partial]);
            },
          });
          if (analysisCancel.current.cancelled) return;
          setEvals(result.evals);
          setAnnotations(result.annotations);
        } catch (e) {
          console.error("Analysis failed", e);
        } finally {
          if (!analysisCancel.current.cancelled) setAnalysisLoading(false);
        }
      })();
    },
    [engine],
  );

  useEffect(() => {
    if (phase !== "playing") return;
    if (engine.turn() === playerColor) return;
    if (engine.isGameOver()) return;

    const token = ++aiCancel.current;
    setAiThinking(true);
    setTrainingHint(null);
    setStatusMsg(`${difficulty.label} is thinking…`);

    const run = async () => {
      await new Promise((r) => setTimeout(r, 120));
      if (token !== aiCancel.current) return;
      try {
        const g = engineRef.current;
        const move = await chooseAiMove(g, difficulty);
        if (token !== aiCancel.current) return;
        const next = g.clone();
        next.applyMove(move);
        setEngine(next);
        setMoveTick((t) => t + 1);
        setSelected(null);
        setLegalMoves([]);
        refreshStatus(next);
      } catch {
        if (token !== aiCancel.current) return;
        setStatusMsg("AI failed to move — try undo or new game");
      } finally {
        if (token === aiCancel.current) setAiThinking(false);
      }
    };
    void run();
  }, [phase, engine, playerColor, difficulty, refreshStatus, moveTick]);

  useEffect(() => {
    if (!trainingMode || phase !== "playing") {
      setTrainingHint(null);
      setTrainingLoading(false);
      return;
    }
    if (!isPlayerTurn || engine.isGameOver()) {
      setTrainingHint(null);
      setTrainingLoading(false);
      return;
    }

    trainingCancel.current = { cancelled: false };
    const signal = trainingCancel.current;
    setTrainingLoading(true);
    setTrainingHint(null);

    const run = async () => {
      try {
        const hint = await findBestTrainingMove(engine, {
          signal,
          movetime: 90,
          // Show a local arrow immediately; SF refine may replace it
          onPartial: (partial) => {
            if (signal.cancelled) return;
            setTrainingHint(partial);
            // Keep loading=true while provisional so user sees "refining"
            if (!partial.provisional) setTrainingLoading(false);
          },
        });
        if (signal.cancelled) return;
        setTrainingHint(hint);
      } catch {
        if (!signal.cancelled) setTrainingHint(null);
      } finally {
        if (!signal.cancelled) setTrainingLoading(false);
      }
    };
    void run();

    return () => {
      signal.cancelled = true;
    };
  }, [trainingMode, phase, isPlayerTurn, engine, moveTick]);

  useEffect(() => {
    if (!isAnalysis) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "j") {
        e.preventDefault();
        setAnalysisPly((p) => Math.max(0, p - 1));
      } else if (e.key === "ArrowRight" || e.key === "k") {
        e.preventDefault();
        setAnalysisPly((p) => Math.min(analysisHistory.length, p + 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        setAnalysisPly(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setAnalysisPly(analysisHistory.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAnalysis, analysisHistory.length]);

  const tryPlayerMove = (from: Square, to: Square, promotion?: PieceSymbol) => {
    if (!isPlayerTurn) return;
    const g = engine;
    const move = g.findMove(from, to, promotion);
    if (!move) return;

    if (!promotion && move.piece === "p") {
      const rank = to[1];
      if ((move.color === "w" && rank === "8") || (move.color === "b" && rank === "1")) {
        const promos = g.moves({ square: from }).filter((m) => m.to === to && m.promotion);
        if (promos.length > 0) {
          setPendingPromo({ from, to });
          return;
        }
      }
    }

    const next = g.clone();
    next.applyMove(move);
    setEngine(next);
    setMoveTick((t) => t + 1);
    setSelected(null);
    setLegalMoves([]);
    setPendingPromo(null);
    setTrainingHint(null);
    refreshStatus(next);
  };

  const onSquareClick = (square: Square) => {
    if (!isPlayerTurn || pendingPromo) return;

    if (selected) {
      if (square === selected) {
        setSelected(null);
        setLegalMoves([]);
        return;
      }
      const isTarget = legalMoves.some((m) => m.to === square);
      if (isTarget) {
        tryPlayerMove(selected, square);
        return;
      }
    }

    const piece = engine.get(square);
    if (piece && piece.color === playerColor && engine.turn() === playerColor) {
      setSelected(square);
      setLegalMoves(engine.moves({ square }));
    } else {
      setSelected(null);
      setLegalMoves([]);
    }
  };

  const playHint = () => {
    if (!trainingHint || !isPlayerTurn) return;
    const m = trainingHint.move;
    tryPlayerMove(m.from, m.to, m.promotion);
  };

  const undo = () => {
    if (phase !== "playing" || aiThinking) return;
    aiCancel.current += 1;
    trainingCancel.current.cancelled = true;
    setAiThinking(false);
    const next = engine.clone();
    next.undo();
    if (next.turn() !== playerColor && next.getHistory().length > 0) {
      next.undo();
    }
    if (next.getHistory().length > 0 && next.turn() !== playerColor) {
      next.undo();
    }
    setEngine(next);
    setMoveTick((t) => t + 1);
    setSelected(null);
    setLegalMoves([]);
    setPendingPromo(null);
    setEndReason(null);
    setWinner(null);
    setShowEndModal(false);
    setPhase("playing");
    setTrainingHint(null);
    refreshStatus(next);
  };

  const resign = () => {
    if (phase !== "playing") return;
    aiCancel.current += 1;
    trainingCancel.current.cancelled = true;
    setAiThinking(false);
    setEndReason("resign");
    setWinner(playerColor === "w" ? "b" : "w");
    setPhase("ended");
    setShowEndModal(true);
    setStatusMsg("You resigned");
    setTrainingHint(null);
  };

  const capturedBy = (color: Color) => {
    const counts: Partial<Record<PieceSymbol, number>> = {};
    for (const m of history) {
      if (m.color === color && m.captured) {
        counts[m.captured] = (counts[m.captured] ?? 0) + 1;
      }
    }
    const order: PieceSymbol[] = ["q", "r", "b", "n", "p"];
    return order.flatMap((t) => Array.from({ length: counts[t] ?? 0 }, () => t));
  };

  if (phase === "menu") {
    return (
      <div className="min-h-full flex flex-col">
        <header className="border-b border-border bg-surface/80 backdrop-blur-sm">
          <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-primary/15 text-primary">
                <Crown className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight leading-tight">
                  Templar Chess
                </h1>
                <p className="text-xs text-muted">Play vs AI · up to Stockfish</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowRules(true)}>
              <Info className="h-4 w-4" />
              Rules
            </Button>
          </div>
        </header>

        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8 md:py-12">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] items-start">
            <section className="space-y-6">
              <div>
                <p className="text-sm font-medium text-primary mb-2">New game</p>
                <h2 className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight max-w-xl">
                  Chess.com-style play with one divine exception
                </h2>
                <p className="mt-3 text-muted max-w-lg text-base leading-relaxed">
                  Standard chess rules — plus the{" "}
                  <span className="text-templar font-medium">Templar King</span>: when a
                  piece of yours is captured, your king may immediately take that capturer
                  back from anywhere on the board, if he is not left in check.
                </p>
              </div>

              <div className="rounded-[var(--radius-xl)] border border-border bg-surface p-5 sm:p-6 space-y-5">
                <div>
                  <label className="text-sm font-medium text-fg mb-2 block">Play as</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPlayerColor("w")}
                      className={cn(
                        "h-12 rounded-[var(--radius-md)] border text-sm font-medium transition-colors",
                        playerColor === "w"
                          ? "border-primary bg-primary/15 text-fg"
                          : "border-border bg-surface-2 text-muted hover:text-fg",
                      )}
                    >
                      White
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlayerColor("b")}
                      className={cn(
                        "h-12 rounded-[var(--radius-md)] border text-sm font-medium transition-colors",
                        playerColor === "b"
                          ? "border-primary bg-primary/15 text-fg"
                          : "border-border bg-surface-2 text-muted hover:text-fg",
                      )}
                    >
                      Black
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-fg mb-2 block">
                    Opponent strength
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2 max-h-[300px] overflow-y-auto pr-1">
                    {DIFFICULTY_LEVELS.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setDifficultyId(d.id)}
                        className={cn(
                          "text-left rounded-[var(--radius-md)] border px-3 py-3 transition-colors min-h-14",
                          difficultyId === d.id
                            ? "border-primary bg-primary/12"
                            : "border-border bg-surface-2 hover:border-border-strong",
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium text-sm">{d.label}</span>
                          <span className="text-xs text-muted tabular">~{d.rating}</span>
                        </div>
                        <p className="text-xs text-subtle mt-0.5 leading-snug">
                          {d.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setTrainingMode((t) => !t)}
                  className={cn(
                    "w-full flex items-start gap-3 rounded-[var(--radius-md)] border px-3 py-3 text-left transition-colors",
                    trainingMode
                      ? "border-primary bg-primary/12"
                      : "border-border bg-surface-2 hover:border-border-strong",
                  )}
                >
                  <GraduationCap
                    className={cn(
                      "h-5 w-5 shrink-0 mt-0.5",
                      trainingMode ? "text-primary" : "text-muted",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">Training mode</span>
                      <span
                        className={cn(
                          "text-[11px] font-semibold uppercase tracking-wide",
                          trainingMode ? "text-primary" : "text-subtle",
                        )}
                      >
                        {trainingMode ? "On" : "Off"}
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-0.5 leading-snug">
                      Shows mate-in-one first, then the best Templar-aware move (full legal
                      scan + Stockfish).
                    </p>
                  </div>
                </button>

                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => startGame(playerColor, difficultyId)}
                >
                  <Swords className="h-4 w-4" />
                  Start game
                </Button>
              </div>
            </section>

            <aside className="rounded-[var(--radius-xl)] border border-border bg-surface p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2 text-templar">
                <Crown className="h-5 w-5" />
                <h3 className="font-semibold">Templar King</h3>
              </div>
              <ul className="space-y-3 text-sm text-muted leading-relaxed">
                <li className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-templar" />
                  The king moves and castles as usual.
                </li>
                <li className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-templar" />
                  <span>
                    <strong className="text-fg font-medium">Take back:</strong> right after
                    an enemy piece captures one of yours, your king may teleport to capture
                    that same piece — from any distance.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>
                    <strong className="text-fg font-medium">Training:</strong> green arrow
                    for the best move; cyan for a Templar take-back; never misses mate in
                    one.
                  </span>
                </li>
              </ul>
            </aside>
          </div>
        </main>

        {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      </div>
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-border bg-surface/90 backdrop-blur-sm sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                aiCancel.current += 1;
                analysisCancel.current.cancelled = true;
                trainingCancel.current.cancelled = true;
                setPhase("menu");
                setAiThinking(false);
                setAnalysisLoading(false);
                setShowEndModal(false);
                setTrainingHint(null);
              }}
              aria-label="Back to menu"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">
                {isAnalysis
                  ? "Game review"
                  : `vs ${difficulty.label}${trainingMode ? " · Training" : ""}`}
              </p>
              <p className="text-xs text-muted truncate">
                {isAnalysis
                  ? "Templar-aware Stockfish eval"
                  : `~${difficulty.rating} · you play ${playerColor === "w" ? "White" : "Black"}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {!isAnalysis && (
              <Button
                variant={trainingMode ? "secondary" : "ghost"}
                size="icon"
                onClick={() => setTrainingMode((t) => !t)}
                aria-label={trainingMode ? "Turn off training" : "Turn on training"}
                title="Training mode"
                className={cn(trainingMode && "text-primary")}
              >
                <GraduationCap className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setFlip((f) => !f)}
              aria-label="Flip board"
            >
              <FlipVertical2 className="h-4 w-4" />
            </Button>
            {!isAnalysis && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={undo}
                  disabled={liveHistory.length === 0 || aiThinking || phase !== "playing"}
                  aria-label="Undo"
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => startGame(playerColor, difficultyId)}
                  aria-label="New game"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-3 sm:px-4 py-4 md:py-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
          <div className="flex flex-col items-center gap-3">
            <div className="w-full max-w-[min(100%,72vh)] flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-8 w-8 rounded-[var(--radius-sm)] bg-surface-2 border border-border flex items-center justify-center text-xs font-semibold">
                  AI
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{difficulty.label}</p>
                  <div className="flex gap-0.5 flex-wrap">
                    {capturedBy(playerColor === "w" ? "b" : "w").map((t, i) => (
                      <span key={i} className="text-[11px] text-muted font-mono">
                        {t.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              {aiThinking && (
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Thinking
                </span>
              )}
            </div>

            <div className="w-full max-w-[min(100%,72vh)] flex gap-2 items-stretch">
              {isAnalysis && (
                <div className="self-stretch flex w-8 sm:w-9 shrink-0">
                  <EvalBar
                    evaluation={currentEval}
                    loading={analysisLoading}
                    className="h-full min-h-[min(100%,56vw)] w-full"
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <Board
                  pieces={pieces}
                  orientation={orientation}
                  selected={isAnalysis ? null : selected}
                  legalTargets={isAnalysis ? [] : legalTargets}
                  lastMove={lastMove}
                  checkSquare={checkSquare}
                  templarTargets={isAnalysis ? [] : templarTargets}
                  hintMove={isAnalysis ? null : boardHint}
                  interactive={isPlayerTurn && !pendingPromo}
                  onSquareClick={onSquareClick}
                />
              </div>
            </div>

            <div className="w-full max-w-[min(100%,72vh)] flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-8 w-8 rounded-[var(--radius-sm)] bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-semibold text-primary">
                  You
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">You</p>
                  <div className="flex gap-0.5 flex-wrap">
                    {capturedBy(playerColor).map((t, i) => (
                      <span key={i} className="text-[11px] text-muted font-mono">
                        {t.toUpperCase()}
                      </span>
                    ))}
                    {materialDiff !== 0 && (
                      <span className="text-[11px] text-primary font-mono ml-1 tabular">
                        {materialDiff > 0 ? `+${materialDiff}` : materialDiff}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right min-w-0">
                {isAnalysis && currentAnnotation?.quality && (
                  <p
                    className={cn(
                      "text-xs font-medium",
                      QUALITY_COLOR[currentAnnotation.quality],
                    )}
                  >
                    {QUALITY_LABEL[currentAnnotation.quality]}
                    {currentAnnotation.lossCp >= 30
                      ? ` · −${(currentAnnotation.lossCp / 100).toFixed(1)}`
                      : ""}
                    {currentAnnotation.missedTemplar ? " · missed take-back" : ""}
                  </p>
                )}
                <p
                  className={cn(
                    "text-sm font-medium",
                    statusMsg === "Check!" && "text-check",
                    phase === "ended" && "text-primary",
                    templarAvailable && isPlayerTurn && "text-templar",
                    isAnalysis && "text-muted",
                  )}
                >
                  {isAnalysis
                    ? currentEval
                      ? `Eval ${formatEval(currentEval)}${
                          currentEval.templarImproved ? " (via take-back)" : ""
                        }`
                      : analysisLoading
                        ? "Evaluating…"
                        : "Review"
                    : templarAvailable && isPlayerTurn
                      ? "Templar take-back available"
                      : statusMsg}
                </p>
              </div>
            </div>

            {isAnalysis && (
              <div className="w-full max-w-[min(100%,72vh)] flex items-center justify-center gap-1">
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Start"
                  onClick={() => setAnalysisPly(0)}
                  disabled={analysisPly === 0}
                >
                  <ChevronFirst className="h-4 w-4" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Previous move"
                  onClick={() => setAnalysisPly((p) => Math.max(0, p - 1))}
                  disabled={analysisPly === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted font-mono tabular px-2 min-w-[4.5rem] text-center">
                  {analysisPly}/{analysisHistory.length}
                </span>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Next move"
                  onClick={() =>
                    setAnalysisPly((p) => Math.min(analysisHistory.length, p + 1))
                  }
                  disabled={analysisPly >= analysisHistory.length}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="End"
                  onClick={() => setAnalysisPly(analysisHistory.length)}
                  disabled={analysisPly >= analysisHistory.length}
                >
                  <ChevronLast className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <aside className="rounded-[var(--radius-xl)] border border-border bg-surface overflow-hidden flex flex-col max-h-[min(70vh,560px)]">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold">{isAnalysis ? "Review" : "Moves"}</h2>
              <span className="text-xs text-muted tabular">{history.length}</span>
            </div>

            {trainingMode && phase === "playing" && (
              <div className="px-3 py-2.5 border-b border-border bg-primary/8 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <Lightbulb className="h-3.5 w-3.5" />
                  Training hint
                </div>
                {!isPlayerTurn && (
                  <p className="text-xs text-muted">Waiting for your turn…</p>
                )}
                {isPlayerTurn && trainingLoading && !trainingHint && (
                  <p className="text-xs text-muted flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Finding best move…
                  </p>
                )}
                {isPlayerTurn && trainingHint && (
                  <div className="space-y-2">
                    <p className="text-sm font-mono font-semibold">
                      <span
                        className={cn(
                          trainingHint.isMate
                            ? "text-primary"
                            : trainingHint.move.isTemplar
                              ? "text-templar"
                              : "text-fg",
                        )}
                      >
                        {trainingHint.move.san}
                      </span>
                      <span className="text-muted font-sans font-normal text-xs ml-2">
                        {trainingHint.move.from}→{trainingHint.move.to}
                        {trainingHint.isMate
                          ? " · Mate!"
                          : trainingHint.move.isTemplar
                            ? " · Templar"
                            : ""}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted leading-snug">
                      {trainingHint.isMate ? (
                        <span className="text-primary font-medium">Checkmate in one</span>
                      ) : (
                        <>
                          After this move, eval ≈{" "}
                          <span className="font-mono text-fg">
                            {formatEval({
                              scoreCp: trainingHint.scoreCp,
                              mate: null,
                              source: trainingHint.source,
                            })}
                          </span>
                          {trainingLoading || trainingHint.provisional
                            ? " · refining…"
                            : " (Templar-aware)"}
                        </>
                      )}
                    </p>
                    <Button size="sm" className="w-full" onClick={playHint}>
                      Play suggested move
                    </Button>
                  </div>
                )}
                {isPlayerTurn && !trainingLoading && !trainingHint && (
                  <p className="text-xs text-muted">No hint available.</p>
                )}
              </div>
            )}

            {isAnalysis && analysisLoading && (
              <div className="px-4 py-2 border-b border-border bg-surface-2">
                <div className="flex items-center gap-2 text-xs text-muted mb-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  Refining with Stockfish…
                  <span className="tabular ml-auto">
                    {analysisProgress.done}/{analysisProgress.total}
                  </span>
                </div>
                <div className="h-1 rounded-full bg-surface-3 overflow-hidden">
                  <div
                    className="h-full bg-primary transition-[width] duration-200"
                    style={{
                      width: `${
                        analysisProgress.total
                          ? (100 * analysisProgress.done) / analysisProgress.total
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-2 py-2 font-mono text-sm">
              {history.length === 0 && (
                <p className="text-xs text-subtle px-2 py-3">No moves yet. Your move.</p>
              )}
              <ol className="space-y-0.5">
                {Array.from({ length: Math.ceil(history.length / 2) }, (_, i) => {
                  const w = history[i * 2];
                  const b = history[i * 2 + 1];
                  const wPly = i * 2 + 1;
                  const bPly = i * 2 + 2;
                  return (
                    <li
                      key={i}
                      className="grid grid-cols-[2rem_1fr_1fr] gap-1 px-1 py-0.5 rounded-[var(--radius-sm)]"
                    >
                      <span className="text-subtle tabular self-center pl-1">{i + 1}.</span>
                      <MoveLabel
                        move={w}
                        ply={wPly}
                        active={isAnalysis && analysisPly === wPly}
                        annotation={annotations[i * 2]}
                        clickable={isAnalysis}
                        onClick={() => isAnalysis && setAnalysisPly(wPly)}
                      />
                      <MoveLabel
                        move={b}
                        ply={bPly}
                        active={isAnalysis && analysisPly === bPly}
                        annotation={annotations[i * 2 + 1]}
                        clickable={isAnalysis}
                        onClick={() => isAnalysis && setAnalysisPly(bPly)}
                      />
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="border-t border-border p-3 space-y-2">
              {isAnalysis ? (
                <>
                  <p className="text-[11px] text-subtle leading-relaxed px-0.5">
                    Bar is white-up. When a Templar take-back is legal and good, the score
                    assumes it. Step with ← →.
                  </p>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => startGame(playerColor, difficultyId)}
                  >
                    Play again
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      analysisCancel.current.cancelled = true;
                      setPhase("menu");
                      setAnalysisLoading(false);
                    }}
                  >
                    Back to menu
                  </Button>
                </>
              ) : (
                <>
                  <div className="rounded-[var(--radius-md)] bg-surface-2 px-3 py-2 text-xs text-muted leading-relaxed">
                    <span className="text-templar font-medium">Templar:</span> after they
                    take a piece of yours, select your king — a cyan ring marks the
                    capturer you may take back.
                  </div>
                  {phase === "playing" && (
                    <Button variant="danger" size="sm" className="w-full" onClick={resign}>
                      Resign
                    </Button>
                  )}
                  {phase === "ended" && !showEndModal && history.length > 0 && (
                    <Button size="sm" className="w-full" onClick={() => enterAnalysis()}>
                      <LineChart className="h-4 w-4" />
                      Analyze game
                    </Button>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      </main>

      {pendingPromo && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg/70 backdrop-blur-sm p-4">
          <div className="rounded-[var(--radius-xl)] border border-border bg-surface p-5 w-full max-w-xs shadow-xl">
            <p className="text-sm font-semibold mb-3 text-center">Promote pawn</p>
            <div className="grid grid-cols-4 gap-2">
              {PROMO_PIECES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="h-14 rounded-[var(--radius-md)] border border-border bg-surface-2 hover:border-primary hover:bg-primary/10 flex items-center justify-center"
                  onClick={() => tryPlayerMove(pendingPromo.from, pendingPromo.to, p)}
                >
                  <span className="font-mono font-semibold text-lg uppercase">{p}</span>
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full mt-3"
              onClick={() => setPendingPromo(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {phase === "ended" && showEndModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg/70 backdrop-blur-sm p-4">
          <div className="rounded-[var(--radius-xl)] border border-border bg-surface p-6 w-full max-w-sm shadow-xl text-center space-y-4">
            <div className="mx-auto h-12 w-12 rounded-full bg-primary/15 flex items-center justify-center">
              <Crown className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">
                {endReason === "resign"
                  ? "Game over"
                  : endReason === "checkmate"
                    ? "Checkmate"
                    : endReason === "stalemate"
                      ? "Stalemate"
                      : "Draw"}
              </h2>
              <p className="text-sm text-muted mt-1">
                {winner
                  ? winner === playerColor
                    ? "You win!"
                    : `${difficulty.label} wins`
                  : "The game is drawn"}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {liveHistory.length > 0 && (
                <Button onClick={() => enterAnalysis()}>
                  <LineChart className="h-4 w-4" />
                  Analyze game
                </Button>
              )}
              <Button
                variant={liveHistory.length > 0 ? "secondary" : "default"}
                onClick={() => startGame(playerColor, difficultyId)}
              >
                Play again
              </Button>
              <Button variant="ghost" onClick={() => setShowEndModal(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MoveLabel({
  move,
  ply,
  active,
  annotation,
  clickable,
  onClick,
}: {
  move?: GameMove;
  ply?: number;
  active?: boolean;
  annotation?: MoveAnnotation;
  clickable?: boolean;
  onClick?: () => void;
}) {
  if (!move) return <span />;
  const quality = annotation?.quality;
  const content = (
    <>
      <span className={cn("truncate", move.isTemplar && "text-templar font-medium")}>
        {move.san}
      </span>
      {annotation?.missedTemplar && (
        <span
          className="ml-0.5 text-[9px] font-sans text-templar shrink-0"
          title="Missed Templar take-back"
        >
          T?
        </span>
      )}
      {quality && quality !== "best" && quality !== "good" && (
        <span
          className={cn(
            "ml-1 text-[10px] font-sans font-semibold shrink-0",
            QUALITY_COLOR[quality],
          )}
          title={QUALITY_LABEL[quality]}
        >
          {quality === "blunder"
            ? "??"
            : quality === "mistake"
              ? "?"
              : quality === "inaccuracy"
                ? "?!"
                : ""}
        </span>
      )}
    </>
  );

  if (clickable) {
    return (
      <button
        type="button"
        data-ply={ply}
        onClick={onClick}
        className={cn(
          "flex items-center min-w-0 px-1.5 py-1 rounded-[var(--radius-sm)] text-left transition-colors",
          active ? "bg-primary/20 text-fg" : "hover:bg-surface-2",
        )}
        title={
          move.isTemplar
            ? "Templar take-back"
            : annotation?.missedTemplar
              ? "Missed Templar take-back"
              : quality
                ? QUALITY_LABEL[quality]
                : move.san
        }
      >
        {content}
      </button>
    );
  }

  return (
    <span
      className={cn("flex items-center min-w-0 px-1.5 py-1", move.isTemplar && "text-templar")}
      title={move.isTemplar ? "Templar take-back" : move.san}
    >
      {content}
    </span>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-bg/70 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="rounded-t-[var(--radius-xl)] sm:rounded-[var(--radius-xl)] border border-border bg-surface p-6 w-full max-w-md shadow-xl space-y-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">How to play</h2>
        <div className="space-y-3 text-sm text-muted leading-relaxed">
          <p>
            Standard chess plus the Templar King take-back: after the opponent captures
            one of your pieces, your king may recapture that piece from anywhere if not
            left in check.
          </p>
          <p>
            <strong className="text-fg">Training mode</strong> scans every legal move for
            mate-in-one first, then picks the best Templar-aware continuation.
          </p>
          <p>
            <strong className="text-fg">Analyze game</strong> after a match for the full
            eval bar and move quality markers.
          </p>
        </div>
        <Button className="w-full" onClick={onClose}>
          Got it
        </Button>
      </div>
    </div>
  );
}
