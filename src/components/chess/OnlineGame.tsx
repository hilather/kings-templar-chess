import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  Copy,
  Crown,
  Link2,
  Loader2,
  RotateCcw,
  Users,
  Wifi,
} from "lucide-react";
import { TemplarChess } from "@/lib/chess/engine";
import type { Color, GameMove, PieceSymbol, Square } from "@/lib/chess/types";
import { P2PRoom } from "@/lib/multiplayer";
import {
  generateRoomId,
  historyToWire,
  isChessNetMessage,
  isValidRoomId,
  normalizeRoomId,
  shareRoomUrl,
  type ChessNetMessage,
  type WireMove,
} from "@/lib/multiplayer/protocol";
import { Board, findKingSquare, piecesFromBoard } from "./Board";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Phase = "setup" | "lobby" | "playing" | "ended";
const PROMO: PieceSymbol[] = ["q", "r", "b", "n"];

function resolveWire(g: TemplarChess, wire: WireMove): GameMove | null {
  const cands = g.moves({ square: wire.from }).filter((m) => m.to === wire.to);
  if (wire.promotion) return cands.find((m) => m.promotion === wire.promotion) ?? null;
  if (wire.isTemplar) return cands.find((m) => m.isTemplar) ?? null;
  return cands.find((m) => !m.isTemplar) ?? cands[0] ?? null;
}

export function OnlineGame({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [displayName, setDisplayName] = useState("Player");
  const [roomInput, setRoomInput] = useState("");
  const [hostColor, setHostColor] = useState<Color>("w");
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [role, setRole] = useState<"host" | "guest" | null>(null);
  const [playerColor, setPlayerColor] = useState<Color>("w");
  const [engine, setEngine] = useState(() => new TemplarChess());
  const [selected, setSelected] = useState<Square | null>(null);
  const [legalMoves, setLegalMoves] = useState<GameMove[]>([]);
  const [statusMsg, setStatusMsg] = useState("");
  const [peerConnected, setPeerConnected] = useState(false);
  const [opponentName, setOpponentName] = useState("Opponent");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [moveTick, setMoveTick] = useState(0);
  const [winner, setWinner] = useState<Color | null>(null);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [pendingPromo, setPendingPromo] = useState<{ from: Square; to: Square } | null>(null);

  const engineRef = useRef(engine);
  engineRef.current = engine;
  const p2pRef = useRef<P2PRoom | null>(null);
  const roleRef = useRef<"host" | "guest" | null>(null);
  const colorRef = useRef<Color>("w");
  colorRef.current = playerColor;
  const nameRef = useRef(displayName);
  nameRef.current = displayName;
  const greeted = useRef(new Set<string>());

  const leave = useCallback(() => {
    p2pRef.current?.close();
    p2pRef.current = null;
    roleRef.current = null;
    greeted.current.clear();
    setPeerConnected(false);
  }, []);

  useEffect(() => () => leave(), [leave]);

  const refreshStatus = useCallback((g: TemplarChess) => {
    const s = g.status();
    if (s === "checkmate") {
      setWinner(g.winner());
      setEndReason("checkmate");
      setPhase("ended");
      setStatusMsg("Checkmate");
    } else if (s === "stalemate" || s === "draw") {
      setWinner(null);
      setEndReason(s);
      setPhase("ended");
      setStatusMsg(s === "stalemate" ? "Stalemate" : "Draw");
    } else if (s === "check") {
      setStatusMsg("Check!");
    } else {
      setStatusMsg(g.turn() === "w" ? "White to move" : "Black to move");
    }
  }, []);

  const applyWire = useCallback(
    (wire: WireMove) => {
      const g = engineRef.current;
      if (g.getHistory().length >= wire.ply) return;
      if (g.getHistory().length + 1 !== wire.ply) return;
      const move = resolveWire(g, wire);
      if (!move) return;
      const next = g.clone();
      next.applyMove(move);
      setEngine(next);
      setMoveTick((t) => t + 1);
      setSelected(null);
      setLegalMoves([]);
      setPendingPromo(null);
      refreshStatus(next);
    },
    [refreshStatus],
  );

  const onNet = useCallback(
    (data: unknown) => {
      if (!isChessNetMessage(data)) return;
      if (data.t === "hello") {
        setOpponentName(data.name || "Opponent");
        if (roleRef.current === "host") {
          p2pRef.current?.send({
            t: "welcome",
            yourColor: colorRef.current === "w" ? "b" : "w",
            hostName: nameRef.current || "Host",
            guestName: data.name || "Guest",
            moves: historyToWire(engineRef.current.getHistory()),
          } satisfies ChessNetMessage);
          setPeerConnected(true);
          setPhase("playing");
          setStatusMsg("Opponent joined — game on");
        }
        return;
      }
      if (data.t === "welcome") {
        setOpponentName(data.hostName || "Host");
        setPlayerColor(data.yourColor);
        colorRef.current = data.yourColor;
        const g = new TemplarChess();
        for (const w of data.moves ?? []) {
          const m = resolveWire(g, w);
          if (!m) break;
          g.applyMove(m);
        }
        setEngine(g);
        setMoveTick((t) => t + 1);
        setPeerConnected(true);
        setPhase("playing");
        setStatusMsg("Connected — game on");
        refreshStatus(g);
        return;
      }
      if (data.t === "move") {
        applyWire(data.move);
        return;
      }
      if (data.t === "resign") {
        setWinner(data.by === "w" ? "b" : "w");
        setEndReason("resign");
        setPhase("ended");
        setStatusMsg("Opponent resigned");
        return;
      }
      if (data.t === "rematch") {
        const g = new TemplarChess();
        setEngine(g);
        setMoveTick((t) => t + 1);
        setWinner(null);
        setEndReason(null);
        setPhase("playing");
        refreshStatus(g);
        setStatusMsg("Rematch started");
      }
    },
    [applyWire, refreshStatus],
  );

  const openRoom = useCallback(
    async (code: string, as: "host" | "guest", color: Color) => {
      leave();
      const room = normalizeRoomId(code);
      if (!isValidRoomId(room)) throw new Error("Room name must be 3–24 characters");
      const selfId = `p-${Math.random().toString(36).slice(2, 10)}`;
      setRoomCode(room);
      setRole(as);
      roleRef.current = as;
      setPlayerColor(color);
      colorRef.current = color;
      setEngine(new TemplarChess());
      setMoveTick((t) => t + 1);
      greeted.current.clear();
      setError(null);

      const p2p = new P2PRoom({
        room,
        selfId,
        name: nameRef.current || (as === "host" ? "Host" : "Guest"),
        onPeersChanged: (peers) => {
          const live = peers.filter((p) => p.connectionState === "connected");
          setPeerConnected(live.length > 0);
          for (const p of live) {
            if (greeted.current.has(p.id)) continue;
            greeted.current.add(p.id);
            p2p.send(
              {
                t: "hello",
                name: nameRef.current || (as === "host" ? "Host" : "Guest"),
                role: as,
              } satisfies ChessNetMessage,
              p.id,
            );
          }
        },
        onMessage: (_from, data, channel) => {
          if (channel === "reliable") onNet(data);
        },
      });
      p2pRef.current = p2p;
      setPhase("lobby");
      setStatusMsg(as === "host" ? "Waiting for opponent…" : "Connecting…");
      setBusy(true);
      await p2p.join();
      setBusy(false);
    },
    [leave, onNet],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const room = new URLSearchParams(window.location.search).get("room");
    if (room && isValidRoomId(room)) {
      setRoomInput(normalizeRoomId(room));
      void openRoom(room, "guest", "b").catch((e) =>
        setError(e instanceof Error ? e.message : "Join failed"),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isMyTurn =
    phase === "playing" && peerConnected && engine.turn() === playerColor;

  const tryMove = (from: Square, to: Square, promotion?: PieceSymbol) => {
    if (!isMyTurn) return;
    const move = engine.findMove(from, to, promotion);
    if (!move) return;
    if (!promotion && move.piece === "p") {
      const rank = to[1];
      if ((move.color === "w" && rank === "8") || (move.color === "b" && rank === "1")) {
        if (engine.moves({ square: from }).some((m) => m.to === to && m.promotion)) {
          setPendingPromo({ from, to });
          return;
        }
      }
    }
    const next = engine.clone();
    next.applyMove(move);
    setEngine(next);
    setMoveTick((t) => t + 1);
    setSelected(null);
    setLegalMoves([]);
    setPendingPromo(null);
    refreshStatus(next);
    p2pRef.current?.send({
      t: "move",
      move: {
        from: move.from,
        to: move.to,
        promotion: move.promotion,
        isTemplar: move.isTemplar || undefined,
        ply: next.getHistory().length,
      },
    } satisfies ChessNetMessage);
  };

  const onSquareClick = (square: Square) => {
    if (!isMyTurn || pendingPromo) return;
    if (selected) {
      if (square === selected) {
        setSelected(null);
        setLegalMoves([]);
        return;
      }
      if (legalMoves.some((m) => m.to === square)) {
        tryMove(selected, square);
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

  const pieces = useMemo(() => piecesFromBoard(engine.board()), [engine, moveTick]);
  const history = engine.getHistory();
  const last = history.length
    ? { from: history[history.length - 1]!.from, to: history[history.length - 1]!.to }
    : null;
  const checkSquare = engine.isCheck() ? findKingSquare(pieces, engine.turn()) : null;
  const templarSq = engine.templarRecaptureSquare();

  if (phase === "setup") {
    return (
      <div className="min-h-full flex flex-col">
        <header className="border-b border-border bg-surface/90 backdrop-blur-sm">
          <div className="mx-auto max-w-lg px-4 py-3 flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div>
              <p className="text-sm font-semibold">Online multiplayer</p>
              <p className="text-xs text-muted">Peer-to-peer · named rooms</p>
            </div>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-md px-4 py-8 space-y-5">
          <div className="rounded-[var(--radius-xl)] border border-border bg-surface p-5 space-y-4">
            <p className="text-xs text-muted leading-relaxed">
              Create a room and share the code or link. Moves travel browser-to-browser after a
              short handshake.
            </p>
            <div>
              <label className="text-sm font-medium mb-2 block">Your name</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value.slice(0, 20))}
                className="w-full h-11 px-3 rounded-[var(--radius-md)] border border-border bg-surface-2 text-sm outline-none focus:border-primary"
                maxLength={20}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Room name</label>
              <div className="flex gap-2">
                <input
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                  className="flex-1 h-11 px-3 rounded-[var(--radius-md)] border border-border bg-surface-2 text-sm font-mono tracking-wider outline-none focus:border-primary uppercase"
                  placeholder="TEMPLAR"
                  maxLength={24}
                />
                <Button type="button" variant="secondary" onClick={() => setRoomInput(generateRoomId())}>
                  Random
                </Button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Host plays as</label>
              <div className="grid grid-cols-2 gap-2">
                {(["w", "b"] as Color[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setHostColor(c)}
                    className={cn(
                      "h-11 rounded-[var(--radius-md)] border text-sm font-medium",
                      hostColor === c
                        ? "border-primary bg-primary/15"
                        : "border-border bg-surface-2 text-muted",
                    )}
                  >
                    {c === "w" ? "White" : "Black"}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                size="lg"
                disabled={busy}
                onClick={() => {
                  const code = roomInput.trim() ? roomInput : generateRoomId();
                  setRoomInput(code);
                  void openRoom(code, "host", hostColor).catch((e) =>
                    setError(e instanceof Error ? e.message : "Create failed"),
                  );
                }}
              >
                <Wifi className="h-4 w-4" /> Create room
              </Button>
              <Button
                size="lg"
                variant="secondary"
                disabled={busy || !roomInput.trim()}
                onClick={() =>
                  void openRoom(roomInput, "guest", "b").catch((e) =>
                    setError(e instanceof Error ? e.message : "Join failed"),
                  )
                }
              >
                <Users className="h-4 w-4" /> Join room
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (phase === "lobby") {
    const link = roomCode ? shareRoomUrl(roomCode) : "";
    return (
      <div className="min-h-full flex flex-col">
        <header className="border-b border-border bg-surface/90">
          <div className="mx-auto max-w-lg px-4 py-3 flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                leave();
                setPhase("setup");
              }}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div>
              <p className="text-sm font-semibold">Online room</p>
              <p className="text-xs text-muted">{busy ? "Connecting…" : "Waiting for opponent"}</p>
            </div>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-[var(--radius-xl)] border border-border bg-surface p-6 space-y-5 text-center">
            <div className="mx-auto h-14 w-14 rounded-full bg-primary/15 flex items-center justify-center">
              <Loader2 className="h-7 w-7 text-primary animate-spin" />
            </div>
            <p className="text-3xl font-mono font-bold tracking-[0.2em]">{roomCode}</p>
            <p className="text-sm text-muted">
              You are <strong className="text-fg">{role}</strong>
              {role === "host" ? (
                <>
                  {" "}
                  · play as{" "}
                  <strong className="text-fg">{playerColor === "w" ? "White" : "Black"}</strong>
                </>
              ) : (
                <> · color assigned when host connects</>
              )}
            </p>
            <Button
              variant="secondary"
              className="w-full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 2000);
                } catch {
                  /* ignore */
                }
              }}
            >
              {linkCopied ? "Copied!" : (
                <>
                  <Link2 className="h-4 w-4" /> Copy invite link
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(roomCode ?? "");
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 2000);
                } catch {
                  /* ignore */
                }
              }}
            >
              <Copy className="h-4 w-4" /> Copy room name
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-border bg-surface/90 sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-3 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                leave();
                onBack();
              }}
              aria-label="Leave"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">
                vs {opponentName}
                {roomCode ? ` · ${roomCode}` : ""}
              </p>
              <p className="text-xs text-muted truncate">
                {peerConnected ? "Connected" : "Reconnecting…"} · you play{" "}
                {playerColor === "w" ? "White" : "Black"}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (phase !== "playing") return;
              p2pRef.current?.send({ t: "resign", by: playerColor });
              setWinner(playerColor === "w" ? "b" : "w");
              setEndReason("resign");
              setPhase("ended");
              setStatusMsg("You resigned");
            }}
            aria-label="Resign"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-3 py-4 flex flex-col lg:flex-row gap-4 items-start justify-center">
        <div className="w-full max-w-[min(100%,560px)] mx-auto">
          <Board
            pieces={pieces}
            orientation={playerColor}
            selected={selected}
            legalTargets={legalMoves.map((m) => m.to)}
            lastMove={last}
            checkSquare={checkSquare}
            templarTargets={
              templarSq && isMyTurn && selected && engine.get(selected)?.type === "k"
                ? [templarSq]
                : []
            }
            interactive={isMyTurn && !pendingPromo}
            onSquareClick={onSquareClick}
          />
          <p className="mt-2 text-center text-sm text-muted">{statusMsg}</p>
        </div>
        <aside className="w-full lg:w-64 space-y-3">
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-3">
            <div className="flex items-center gap-2 mb-2">
              <Crown className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Moves</span>
            </div>
            <div className="max-h-48 overflow-y-auto text-sm font-mono space-y-0.5">
              {history.length === 0 && <p className="text-muted text-xs">No moves yet.</p>}
              {Array.from({ length: Math.ceil(history.length / 2) }, (_, i) => {
                const w = history[i * 2];
                const b = history[i * 2 + 1];
                return (
                  <div key={i} className="flex gap-2">
                    <span className="text-subtle w-6">{i + 1}.</span>
                    <span className="w-16">{w?.san ?? ""}</span>
                    <span>{b?.san ?? ""}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </main>

      {pendingPromo && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-[var(--radius-xl)] p-4 flex gap-2">
            {PROMO.map((p) => (
              <Button key={p} onClick={() => tryMove(pendingPromo.from, pendingPromo.to, p)}>
                {p.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>
      )}

      {phase === "ended" && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-[var(--radius-xl)] p-6 max-w-sm w-full space-y-4 text-center">
            <h2 className="text-xl font-semibold">
              {winner ? (winner === playerColor ? "You win!" : `${opponentName} wins`) : "Draw"}
            </h2>
            <p className="text-sm text-muted">{endReason}</p>
            <div className="flex gap-2 justify-center">
              <Button
                onClick={() => {
                  const g = new TemplarChess();
                  setEngine(g);
                  setMoveTick((t) => t + 1);
                  setWinner(null);
                  setEndReason(null);
                  setPhase("playing");
                  refreshStatus(g);
                  p2pRef.current?.send({ t: "rematch" });
                }}
              >
                Rematch
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  leave();
                  onBack();
                }}
              >
                Menu
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
