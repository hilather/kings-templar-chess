import { Chess, SQUARES, type Color, type PieceSymbol, type Square } from "chess.js";
import type { GameMove, GameStatus } from "./types";

const FILES = "abcdefgh";

function opposite(color: Color): Color {
  return color === "w" ? "b" : "w";
}

function pieceValue(type: PieceSymbol): number {
  switch (type) {
    case "p":
      return 1;
    case "n":
    case "b":
      return 3;
    case "r":
      return 5;
    case "q":
      return 9;
    case "k":
      return 0;
  }
}

function buildFenFromBoard(
  pieces: Map<Square, { type: PieceSymbol; color: Color }>,
  turn: Color,
  castling: string,
  ep: string,
  halfMoves: number,
  fullMoves: number,
): string {
  const ranks: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const sq = `${FILES[file]}${rank}` as Square;
      const p = pieces.get(sq);
      if (!p) {
        empty++;
      } else {
        if (empty > 0) {
          row += empty;
          empty = 0;
        }
        const ch = p.type;
        row += p.color === "w" ? ch.toUpperCase() : ch;
      }
    }
    if (empty > 0) row += empty;
    ranks.push(row);
  }
  return `${ranks.join("/")} ${turn} ${castling || "-"} ${ep} ${halfMoves} ${fullMoves}`;
}

function parseCastling(fen: string): string {
  return fen.split(" ")[2] ?? "-";
}

function clearCastlingFor(castling: string, color: Color): string {
  if (castling === "-") return "-";
  const remove = color === "w" ? /[KQ]/g : /[kq]/g;
  const next = castling.replace(remove, "");
  return next || "-";
}

function clearCastlingForRookSquare(castling: string, square: Square): string {
  if (castling === "-") return "-";
  const map: Record<string, string> = {
    a1: "Q",
    h1: "K",
    a8: "q",
    h8: "k",
  };
  const ch = map[square];
  if (!ch) return castling;
  const next = castling.replace(ch, "");
  return next || "-";
}

function findKingSquare(
  pieces: Map<Square, { type: PieceSymbol; color: Color }>,
  color: Color,
): Square | null {
  for (const [sq, p] of pieces) {
    if (p.type === "k" && p.color === color) return sq;
  }
  return null;
}

function boardMap(chess: Chess): Map<Square, { type: PieceSymbol; color: Color }> {
  const map = new Map<Square, { type: PieceSymbol; color: Color }>();
  for (const sq of SQUARES) {
    const p = chess.get(sq);
    if (p) map.set(sq, { type: p.type, color: p.color });
  }
  return map;
}

/**
 * Templar Chess engine.
 *
 * Standard chess + Templar King recapture:
 * When the opponent has just captured one of your pieces, your king may
 * "take back" that capturer from anywhere on the board (teleport capture),
 * provided the king is not left in check afterward.
 * Only available on the immediate reply to a capture.
 */
export class TemplarChess {
  private chess: Chess;
  private history: GameMove[] = [];

  constructor(fen?: string) {
    this.chess = new Chess(fen);
  }

  clone(): TemplarChess {
    const t = new TemplarChess(this.chess.fen());
    t.history = this.history.map((m) => ({ ...m }));
    return t;
  }

  fen(): string {
    return this.chess.fen();
  }

  turn(): Color {
    return this.chess.turn();
  }

  board() {
    return this.chess.board();
  }

  get(square: Square) {
    return this.chess.get(square);
  }

  isCheck(): boolean {
    return this.chess.isCheck();
  }

  getHistory(): GameMove[] {
    return this.history;
  }

  /** Last move, if any. */
  lastMove(): GameMove | null {
    return this.history[this.history.length - 1] ?? null;
  }

  /**
   * Square of the enemy piece that just captured (if Templar recapture may apply).
   * Null when the last move was not a capture by the opponent.
   */
  templarRecaptureSquare(): Square | null {
    const last = this.lastMove();
    if (!last?.captured) return null;
    // Capturer was the side that just moved; side to move is the victim
    if (last.color === this.chess.turn()) return null;
    return last.to;
  }

  static isTemplarDistance(from: Square, to: Square): boolean {
    const ff = from.charCodeAt(0) - 97;
    const fr = parseInt(from[1]!, 10);
    const tf = to.charCodeAt(0) - 97;
    const tr = parseInt(to[1]!, 10);
    return Math.max(Math.abs(ff - tf), Math.abs(fr - tr)) > 1;
  }

  private tryTemplarCapture(from: Square, to: Square): GameMove | null {
    const piece = this.chess.get(from);
    const target = this.chess.get(to);
    if (!piece || piece.type !== "k") return null;
    if (!target || target.color === piece.color) return null;
    if (target.type === "k") return null;
    // Adjacent recaptures are already normal king captures
    if (!TemplarChess.isTemplarDistance(from, to)) return null;

    const color = piece.color;
    const pieces = boardMap(this.chess);
    pieces.delete(from);
    pieces.delete(to);
    pieces.set(to, { type: "k", color });

    const fenParts = this.chess.fen().split(" ");
    const nextTurn = opposite(color);
    let castling = parseCastling(this.chess.fen());
    castling = clearCastlingFor(castling, color);
    castling = clearCastlingForRookSquare(castling, to);
    const halfMoves = 0;
    const fullMoves =
      color === "b"
        ? parseInt(fenParts[5] ?? "1", 10) + 1
        : parseInt(fenParts[5] ?? "1", 10);

    const fenAfter = buildFenFromBoard(pieces, nextTurn, castling, "-", halfMoves, fullMoves);

    let probe: Chess;
    try {
      probe = new Chess(fenAfter);
    } catch {
      return null;
    }

    const kingSq = findKingSquare(pieces, color);
    if (!kingSq) return null;
    if (probe.isAttacked(kingSq, nextTurn)) return null;

    return {
      from,
      to,
      piece: "k",
      color,
      captured: target.type,
      isTemplar: true,
      isCastle: false,
      isEnPassant: false,
      san: `K@x${to}`,
      lan: `${from}${to}`,
      fenBefore: this.chess.fen(),
      fenAfter,
    };
  }

  private standardMovesAsGameMoves(square?: Square): GameMove[] {
    const verbose = this.chess.moves({ square, verbose: true });
    const fenBefore = this.chess.fen();
    const out: GameMove[] = [];

    for (const m of verbose) {
      const isCastle = (m.flags?.includes("k") || m.flags?.includes("q")) ?? false;
      const isEnPassant = m.flags?.includes("e") ?? false;
      out.push({
        from: m.from,
        to: m.to,
        piece: m.piece,
        color: m.color,
        captured: m.captured,
        promotion: m.promotion,
        isTemplar: false,
        isCastle,
        isEnPassant,
        san: m.san,
        lan: m.lan,
        fenBefore,
        fenAfter: m.after,
      });
    }
    return out;
  }

  private findKing(color: Color): Square | null {
    for (const sq of SQUARES) {
      const p = this.chess.get(sq);
      if (p?.type === "k" && p.color === color) return sq;
    }
    return null;
  }

  /**
   * Templar recapture only: if opponent just took one of our pieces,
   * king may teleport-capture that capturer (on last.to), if legal.
   */
  private templarMoves(): GameMove[] {
    const recaptureSq = this.templarRecaptureSquare();
    if (!recaptureSq) return [];

    const color = this.chess.turn();
    const kingSq = this.findKing(color);
    if (!kingSq) return [];

    const target = this.chess.get(recaptureSq);
    if (!target || target.color === color || target.type === "k") return [];

    const m = this.tryTemplarCapture(kingSq, recaptureSq);
    return m ? [m] : [];
  }

  moves(opts?: { square?: Square }): GameMove[] {
    const square = opts?.square;
    const standard = this.standardMovesAsGameMoves(square);

    if (square) {
      const p = this.chess.get(square);
      if (p?.type === "k" && p.color === this.chess.turn()) {
        return [...standard, ...this.templarMoves()];
      }
      return standard;
    }
    return [...standard, ...this.templarMoves()];
  }

  hasLegalMove(): boolean {
    if (this.chess.moves().length > 0) return true;
    return this.templarMoves().length > 0;
  }

  legalTargets(from: Square): Square[] {
    return this.moves({ square: from }).map((m) => m.to);
  }

  findMove(from: Square, to: Square, promotion?: PieceSymbol): GameMove | null {
    const candidates = this.moves({ square: from }).filter((m) => m.to === to);
    if (candidates.length === 0) return null;
    if (promotion) {
      const promo = candidates.find((m) => m.promotion === promotion);
      if (promo) return promo;
    }
    return candidates.find((m) => !m.isTemplar) ?? candidates[0] ?? null;
  }

  move(from: Square, to: Square, promotion?: PieceSymbol): GameMove | null {
    const m = this.findMove(from, to, promotion);
    if (!m) return null;
    this.applyMove(m);
    return m;
  }

  applyMove(m: GameMove): void {
    if (m.isTemplar) {
      this.chess.load(m.fenAfter);
    } else {
      const result = this.chess.move({
        from: m.from,
        to: m.to,
        promotion: m.promotion,
      });
      if (!result) {
        this.chess.load(m.fenAfter);
      }
    }
    this.history.push({ ...m, fenAfter: this.chess.fen() });
  }

  undo(): GameMove | null {
    const last = this.history.pop();
    if (!last) return null;
    this.chess.load(last.fenBefore);
    return last;
  }

  status(): GameStatus {
    if (!this.hasLegalMove()) {
      return this.isCheck() ? "checkmate" : "stalemate";
    }
    if (this.chess.isInsufficientMaterial()) return "draw";
    if (this.chess.isThreefoldRepetition()) return "draw";
    if (this.chess.isDrawByFiftyMoves()) return "draw";
    if (this.isCheck()) return "check";
    return "playing";
  }

  isGameOver(): boolean {
    const s = this.status();
    return s === "checkmate" || s === "stalemate" || s === "draw";
  }

  winner(): Color | null {
    if (this.status() !== "checkmate") return null;
    return opposite(this.turn());
  }

  material(): { w: number; b: number } {
    let w = 0;
    let b = 0;
    for (const sq of SQUARES) {
      const p = this.chess.get(sq);
      if (!p || p.type === "k") continue;
      const v = pieceValue(p.type);
      if (p.color === "w") w += v;
      else b += v;
    }
    return { w, b };
  }

  ascii(): string {
    return this.chess.ascii();
  }
}

export function squareColor(square: Square): "light" | "dark" {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1]!, 10);
  return (file + rank) % 2 === 0 ? "dark" : "light";
}

export function coordsToSquare(file: number, rank: number): Square {
  return `${FILES[file]}${rank}` as Square;
}

export { SQUARES, pieceValue };
