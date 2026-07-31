import { cn } from "@/lib/utils";
import type { PositionEval } from "@/lib/chess/analysis";
import { evalBarPercent, formatEval } from "@/lib/chess/analysis";

interface EvalBarProps {
  evaluation: PositionEval | null;
  loading?: boolean;
  className?: string;
}

/** Vertical eval bar — white advantage grows from the bottom (chess.com style). */
export function EvalBar({ evaluation, loading, className }: EvalBarProps) {
  const pct = evalBarPercent(evaluation);
  const label = evaluation ? formatEval(evaluation) : "…";
  // Put the number on the larger side so it stays readable
  const labelOnWhite = pct >= 50;

  return (
    <div
      className={cn(
        "relative w-8 sm:w-9 shrink-0 rounded-[var(--radius-sm)] overflow-hidden border border-border select-none",
        className,
      )}
      title={
        evaluation
          ? `Eval ${label}${evaluation.templarImproved ? " · Templar-adjusted" : ""} (${evaluation.source})`
          : "Evaluating…"
      }
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Evaluation ${label}`}
    >
      {/* Black half (top) */}
      <div className="absolute inset-0 bg-[#111312]" />
      {/* White half grows from bottom */}
      <div
        className="absolute inset-x-0 bottom-0 bg-[#f3f1e7] transition-[height] duration-300 ease-out"
        style={{ height: `${Math.max(4, Math.min(96, pct))}%` }}
      />
      {/* Center hairline at equal */}
      <div className="absolute inset-x-0 top-1/2 h-px bg-black/25 z-[1]" />

      <div
        className={cn(
          "absolute inset-x-0 flex justify-center pointer-events-none z-[2] px-0.5",
          labelOnWhite ? "bottom-1.5" : "top-1.5",
        )}
      >
        <span
          className={cn(
            "text-[10px] sm:text-[11px] font-mono font-bold tabular leading-none tracking-tight",
            labelOnWhite ? "text-[#111312]" : "text-[#f3f1e7]",
            loading && "opacity-70",
          )}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
