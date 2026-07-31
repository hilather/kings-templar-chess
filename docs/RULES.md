# Templar King — official house rules

These rules extend FIDE chess. Where they are silent, classical chess applies.

## Core rule

**Templar take-back**

1. Opponent captures one of your pieces (including a promoted piece, or a pawn via en passant).
2. On **your immediate next move**, your **king** may move to the square of that capturer and capture it, **regardless of distance and path**, provided:
   - the capturer is still on that square,
   - the destination is not occupied by a friendly piece,
   - after the recapture, **your king is not in check**.
3. The opportunity lasts **one half-move only**. If you play any other legal move, the take-back expires.
4. You may always ignore the take-back and play a normal king move, castle, etc., if legal.

## What is *not* allowed

- Sniping arbitrary enemy pieces (“king captures anything anywhere”).
- Taking back after two or more moves have passed.
- Recapturing a piece that is no longer the capturer (wrong square / piece moved on).
- A take-back that walks into check or fails to resolve check when you are already in check (same as any illegal king move).

## Interaction with other rules

| Situation | Behavior |
| --- | --- |
| Check | Take-back is legal only if it resolves check (or you were not in check). |
| Castling | Normal castling rights/rules. Templar recapture is a separate king move and clears castling rights for that side. |
| En passant | If a pawn captures en passant, the king may take back on the capturer’s landing square. |
| Promotion | Capturing a just-promoted piece still grants the take-back on that square. |
| Stalemate / mate | Standard detection on the legal move list (including Templar options). |

## Notation

Templar recaptures are marked in the move list with a distinctive style and typically use a form like `K@x e5` / custom SAN with a Templar flag (`isTemplar: true` in the engine).

## Design intent

The king becomes a **one-tempo insurance policy** against hanging pieces: material can be restored instantly, but only at the cost of king safety and tempo. Strong play anticipates both *your* take-backs and *theirs*.
