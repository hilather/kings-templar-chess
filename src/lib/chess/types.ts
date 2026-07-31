import type { Color, PieceSymbol, Square } from "chess.js";

export type { Color, PieceSymbol, Square };

export type DifficultyId =
  | "beginner"
  | "novice"
  | "intermediate"
  | "club"
  | "expert"
  | "master"
  | "cm"
  | "im"
  | "gm"
  | "stockfish";

export interface DifficultyLevel {
  id: DifficultyId;
  label: string;
  rating: number;
  description: string;
  engine: "minimax" | "stockfish";
  depth: number;
  skill?: number;
  movetime?: number;
  blunderRate?: number;
}

export const DIFFICULTY_LEVELS: DifficultyLevel[] = [
  {
    id: "beginner",
    label: "Beginner",
    rating: 400,
    description: "Casual play — often misses tactics",
    engine: "minimax",
    depth: 1,
    blunderRate: 0.45,
  },
  {
    id: "novice",
    label: "Novice",
    rating: 800,
    description: "Looks one move ahead for material",
    engine: "minimax",
    depth: 1,
    blunderRate: 0.18,
  },
  {
    id: "intermediate",
    label: "Intermediate",
    rating: 1200,
    description: "Two-ply search with basic evaluation",
    engine: "minimax",
    depth: 2,
    blunderRate: 0.06,
  },
  {
    id: "club",
    label: "Club Player",
    rating: 1600,
    description: "Solid club-level tactical vision",
    engine: "minimax",
    depth: 2,
  },
  {
    id: "expert",
    label: "Expert",
    rating: 1900,
    description: "Strong tactics and take-back awareness",
    engine: "minimax",
    depth: 3,
  },
  {
    id: "master",
    label: "Master",
    rating: 2200,
    description: "Deep local search",
    engine: "minimax",
    depth: 3,
  },
  {
    id: "cm",
    label: "Candidate Master",
    rating: 2400,
    description: "Stockfish skill limited",
    engine: "stockfish",
    depth: 8,
    skill: 8,
    movetime: 350,
  },
  {
    id: "im",
    label: "International Master",
    rating: 2600,
    description: "Stockfish with stronger skill",
    engine: "stockfish",
    depth: 10,
    skill: 14,
    movetime: 550,
  },
  {
    id: "gm",
    label: "Grandmaster",
    rating: 2800,
    description: "Near full Stockfish power",
    engine: "stockfish",
    depth: 12,
    skill: 18,
    movetime: 800,
  },
  {
    id: "stockfish",
    label: "Stockfish",
    rating: 3200,
    description: "Full-strength Stockfish (lite WASM)",
    engine: "stockfish",
    depth: 14,
    skill: 20,
    movetime: 1200,
  },
];

export interface GameMove {
  from: Square;
  to: Square;
  piece: PieceSymbol;
  color: Color;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  isTemplar: boolean;
  isCastle: boolean;
  isEnPassant: boolean;
  san: string;
  lan: string;
  fenBefore: string;
  fenAfter: string;
}

export type GameStatus =
  | "idle"
  | "playing"
  | "check"
  | "checkmate"
  | "stalemate"
  | "draw"
  | "resign";

export type PlayerColor = Color;

export interface BoardSquare {
  square: Square;
  file: number;
  rank: number;
  piece: { type: PieceSymbol; color: Color } | null;
}
