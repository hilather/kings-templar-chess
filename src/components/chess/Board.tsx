import { useMemo } from "react";
import type { Color, PieceSymbol, Square } from "@/lib/chess/types";
import { PieceSvg } from "./PieceSvg";
import { cn } from "@/lib/utils";

export interface BoardPiece {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

export type HintMove = {
  from: Square;
  to: Square;
  isTemplar?: boolean;
};

interface BoardProps {
  pieces: BoardPiece[];
  orientation: Color;
  selected: Square | null;
  legalTargets: Square[];
  lastMove: { from: Square; to: Square } | null;
  checkSquare: Square | null;
  templarTargets: Square[];
  hintMove?: HintMove | null;
  interactive: boolean;
  onSquareClick: (square: Square) => void;
}

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

function squareCenter(
  square: Square,
  orientation: Color,
): { x: number; y: number } {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1]!, 10) - 1;
  const col = orientation === "w" ? file : 7 - file;
  const row = orientation === "w" ? 7 - rank : rank;
  return { x: (col + 0.5) / 8, y: (row + 0.5) / 8 };
}

export function Board({
  pieces,
  orientation,
  selected,
  legalTargets,
  lastMove,
  checkSquare,
  templarTargets,
  hintMove,
  interactive,
  onSquareClick,
}: BoardProps) {
  const pieceMap = useMemo(() => {
    const m = new Map<Square, BoardPiece>();
    for (const p of pieces) m.set(p.square, p);
    return m;
  }, [pieces]);

  const ranks =
    orientation === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === "w" ? [...FILES] : [...FILES].reverse();

  const legalSet = useMemo(() => new Set(legalTargets), [legalTargets]);
  const templarSet = useMemo(() => new Set(templarTargets), [templarTargets]);

  const arrow = useMemo(() => {
    if (!hintMove) return null;
    const a = squareCenter(hintMove.from, orientation);
    const b = squareCenter(hintMove.to, orientation);
    return { a, b, templar: !!hintMove.isTemplar };
  }, [hintMove, orientation]);

  return (
    <div
      className="relative w-full max-w-[min(100%,72vh)] aspect-square select-none rounded-[var(--radius-lg)] overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.45)] ring-1 ring-border"
      role="grid"
      aria-label="Chess board"
    >
      <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
        {ranks.map((rank, ri) =>
          files.map((file, fi) => {
            const square = `${file}${rank}` as Square;
            const isLight = (fi + ri) % 2 === 0;
            const piece = pieceMap.get(square);
            const isSelected = selected === square;
            const isLegal = legalSet.has(square);
            const isTemplar = templarSet.has(square);
            const isLast =
              lastMove && (lastMove.from === square || lastMove.to === square);
            const isCheck = checkSquare === square;
            const isCapture = isLegal && !!piece;
            const isHintFrom = hintMove?.from === square;
            const isHintTo = hintMove?.to === square;

            return (
              <button
                key={square}
                type="button"
                role="gridcell"
                disabled={!interactive}
                onClick={() => onSquareClick(square)}
                aria-label={`${square}${piece ? `, ${piece.color === "w" ? "white" : "black"} ${piece.type}` : ""}`}
                className={cn(
                  "relative flex items-center justify-center border-0 p-0 transition-colors duration-100",
                  isLight ? "bg-board-light" : "bg-board-dark",
                  interactive && "hover:brightness-105",
                  !interactive && "cursor-default",
                )}
              >
                {isLast && (
                  <span className="absolute inset-0 bg-board-last/35 pointer-events-none" />
                )}
                {isHintFrom && (
                  <span
                    className={cn(
                      "absolute inset-0 pointer-events-none",
                      hintMove?.isTemplar ? "bg-templar/40" : "bg-primary/40",
                    )}
                  />
                )}
                {isHintTo && (
                  <span
                    className={cn(
                      "absolute inset-0 pointer-events-none",
                      hintMove?.isTemplar ? "bg-templar/50" : "bg-primary/50",
                    )}
                  />
                )}
                {isSelected && (
                  <span className="absolute inset-0 bg-board-selected/55 pointer-events-none" />
                )}
                {isCheck && (
                  <span className="absolute inset-0 bg-board-check/50 pointer-events-none" />
                )}

                {fi === 0 && (
                  <span
                    className={cn(
                      "absolute top-0.5 left-1 text-[10px] sm:text-xs font-semibold leading-none pointer-events-none",
                      isLight ? "text-board-dark/70" : "text-board-light/80",
                    )}
                  >
                    {rank}
                  </span>
                )}
                {ri === 7 && (
                  <span
                    className={cn(
                      "absolute bottom-0.5 right-1 text-[10px] sm:text-xs font-semibold leading-none pointer-events-none",
                      isLight ? "text-board-dark/70" : "text-board-light/80",
                    )}
                  >
                    {file}
                  </span>
                )}

                {piece && (
                  <PieceSvg
                    type={piece.type}
                    color={piece.color}
                    templar={piece.type === "k"}
                    className="relative z-[1] w-[86%] h-[86%] drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)] pointer-events-none"
                  />
                )}

                {isLegal && !isCapture && (
                  <span
                    className={cn(
                      "absolute w-[28%] h-[28%] rounded-full pointer-events-none z-[2]",
                      isTemplar ? "bg-templar/70" : "bg-black/25",
                    )}
                  />
                )}
                {isLegal && isCapture && (
                  <span
                    className={cn(
                      "absolute inset-[6%] rounded-full border-[3px] pointer-events-none z-[2]",
                      isTemplar ? "border-templar/80" : "border-black/30",
                    )}
                  />
                )}
              </button>
            );
          }),
        )}
      </div>

      {arrow && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-[3]"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden
        >
          <defs>
            <marker
              id="hint-arrow"
              markerWidth="0.08"
              markerHeight="0.08"
              refX="0.04"
              refY="0.04"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M0,0 L0.08,0.04 L0,0.08 Z"
                fill={arrow.templar ? "#4dd0e1" : "#8bc34a"}
              />
            </marker>
          </defs>
          <line
            x1={arrow.a.x}
            y1={arrow.a.y}
            x2={arrow.b.x}
            y2={arrow.b.y}
            stroke={arrow.templar ? "#4dd0e1" : "#8bc34a"}
            strokeWidth={0.028}
            strokeLinecap="round"
            opacity={0.9}
            markerEnd="url(#hint-arrow)"
          />
        </svg>
      )}
    </div>
  );
}

export function piecesFromBoard(
  board: ({ type: PieceSymbol; color: Color } | null)[][],
): BoardPiece[] {
  const out: BoardPiece[] = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r]![f];
      if (!p) continue;
      const file = FILES[f]!;
      const rank = 8 - r;
      out.push({
        square: `${file}${rank}` as Square,
        type: p.type,
        color: p.color,
      });
    }
  }
  return out;
}

export function findKingSquare(pieces: BoardPiece[], color: Color): Square | null {
  return pieces.find((p) => p.type === "k" && p.color === color)?.square ?? null;
}
