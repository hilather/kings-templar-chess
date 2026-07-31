# Engine & AI notes

## `TemplarChess` (`src/lib/chess/engine.ts`)

Wraps `chess.js` and injects Templar moves into legal generation:

- Tracks the **last capture square / capturer** for the side to move.
- `templarMoves()` / `tryTemplarCapture()` validate teleport recapture and check safety.
- History stores `GameMove` with `isTemplar` for UI, analysis, and undo.

## Local evaluation (`eval.ts`)

Material + piece-square tables + bonuses for available Templar recaptures. Used by:

- low/mid difficulty minimax,
- training’s instant ranking,
- analysis fallback when Stockfish is unavailable.

## Opponents (`ai.ts`)

| Band | Method |
| --- | --- |
| Beginner–Master | Time-budgeted alpha-beta, ordered captures/Templar first, optional blunder rate |
| CM–Stockfish | Stockfish UCI + local re-score of captures/Templar candidates so the engine “sees” the variant |

## Stockfish (`stockfish.ts`)

- Lite single-thread WASM worker under `public/stockfish/`.
- Serialized command queue (AI + analysis never race a single `go`).
- Scores converted to **white POV**.

## Training (`training.ts`)

Pipeline optimized for UI latency:

1. **Mate-in-one scan** — every legal move (instant).
2. **Local rank all moves** with Templar-aware static eval (~10–40ms) → `onPartial` arrow.
3. Optional skip if local gap is huge (free piece).
4. **≤4 Stockfish refines** (~70ms each) + root bestmove (~120ms).
5. If opponent would have a Templar reply, score after that reply when it hurts the side to move.

## Analysis (`analysis.ts`)

- Seeds every ply with local eval (eval bar never stuck at 50%).
- Refines with Stockfish + `evaluateTemplarAware`.
- Move quality from centipawn loss; `missedTemplar` when a take-back was better and skipped.

## Performance tips

- Prefer `apply` / `undo` over deep cloning in hot loops.
- Never leave concurrent `go` commands on one worker.
- Keep training SF candidate count small; correctness of mate is handled before SF.
