/**
 * Chess multiplayer wire protocol (reliable channel).
 * Moves are rebuilt with TemplarChess.findMove on the receiver.
 */
import type { Color, PieceSymbol, Square } from "@/lib/chess/types";

export type WireMove = {
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
  isTemplar?: boolean;
  /** History length after this move (ordering / de-dupe). */
  ply: number;
};

export type ChessNetMessage =
  | { t: "hello"; name: string; role: "host" | "guest" }
  | {
      t: "welcome";
      yourColor: Color;
      hostName: string;
      guestName: string;
      moves: WireMove[];
    }
  | { t: "move"; move: WireMove }
  | { t: "resign"; by: Color }
  | { t: "rematch" };

export function normalizeRoomId(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 24);
}

export function generateRoomId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 6; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export function isValidRoomId(id: string): boolean {
  const n = normalizeRoomId(id);
  return n.length >= 3 && n.length <= 24;
}

export function shareRoomUrl(roomId: string): string {
  if (typeof window === "undefined") return roomId;
  const u = new URL(window.location.href);
  u.searchParams.set("room", normalizeRoomId(roomId));
  u.searchParams.delete("demo");
  return u.toString();
}

export function historyToWire(
  history: {
    from: Square;
    to: Square;
    promotion?: PieceSymbol;
    isTemplar: boolean;
  }[],
): WireMove[] {
  return history.map((m, i) => ({
    from: m.from,
    to: m.to,
    promotion: m.promotion,
    isTemplar: m.isTemplar || undefined,
    ply: i + 1,
  }));
}

export function isChessNetMessage(data: unknown): data is ChessNetMessage {
  if (!data || typeof data !== "object") return false;
  const t = (data as { t?: unknown }).t;
  return (
    t === "hello" ||
    t === "welcome" ||
    t === "move" ||
    t === "resign" ||
    t === "rematch"
  );
}
