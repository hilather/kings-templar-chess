/**
 * Browser Stockfish (lite single-threaded WASM) via Web Worker + UCI.
 * All UCI commands are serialized so AI + analysis never race.
 */

type Listener = (line: string) => void;

export type AnalysisResult = {
  /** Centipawns from white's perspective. Positive = white better. */
  scoreCp: number;
  /** Mate in N for white-positive convention (null if not mate). */
  mate: number | null;
  /** Best move in UCI, if any. */
  bestMove: string | null;
};

export class StockfishEngine {
  private worker: Worker | null = null;
  private listeners = new Set<Listener>();
  private ready = false;
  private starting: Promise<void> | null = null;
  /** Serialize all search commands. */
  private chain: Promise<unknown> = Promise.resolve();

  async init(): Promise<void> {
    if (this.ready && this.worker) return;
    if (this.starting) return this.starting;

    this.starting = new Promise<void>((resolve, reject) => {
      try {
        this.worker = new Worker("/stockfish/stockfish-18-lite-single.js");
        this.worker.onmessage = (e: MessageEvent) => {
          const line = typeof e.data === "string" ? e.data : String(e.data);
          for (const l of this.listeners) l(line);
        };
        this.worker.onerror = (err) => {
          reject(new Error(`Stockfish worker error: ${err.message}`));
        };

        const onReady = (line: string) => {
          if (line === "uciok") {
            this.send("isready");
            return;
          }
          if (line === "readyok") {
            this.listeners.delete(onReady);
            this.ready = true;
            resolve();
          }
        };
        this.listeners.add(onReady);
        this.send("uci");
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });

    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  private waitFor(
    match: (line: string) => boolean,
    timeoutMs = 30_000,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(onLine);
        reject(new Error("Stockfish timeout"));
      }, timeoutMs);

      const onLine = (line: string) => {
        if (!match(line)) return;
        clearTimeout(timer);
        this.listeners.delete(onLine);
        resolve(line);
      };
      this.listeners.add(onLine);
    });
  }

  /** Run exclusive work on the engine (prevents overlapping `go`). */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async setSkill(level: number): Promise<void> {
    await this.init();
    const skill = Math.max(0, Math.min(20, Math.round(level)));
    this.send(`setoption name Skill Level value ${skill}`);
    if (skill < 20) {
      this.send("setoption name UCI_LimitStrength value true");
      const elo = 800 + skill * 100;
      this.send(`setoption name UCI_Elo value ${elo}`);
    } else {
      this.send("setoption name UCI_LimitStrength value false");
    }
  }

  async setFullStrength(): Promise<void> {
    await this.init();
    this.send("setoption name UCI_LimitStrength value false");
    this.send("setoption name Skill Level value 20");
  }

  async evaluateFen(fen: string, depth: number): Promise<number> {
    const r = await this.analyzePosition(fen, depth);
    return r.scoreCp;
  }

  /**
   * Analyze a position: score (white POV) + best move (standard chess).
   */
  async analyzePosition(
    fen: string,
    depth: number,
    movetimeMs?: number,
  ): Promise<AnalysisResult> {
    return this.enqueue(async () => {
      await this.init();
      // Stop any previous search
      this.send("stop");
      await new Promise((r) => setTimeout(r, 10));

      this.send("ucinewgame");
      this.send(`position fen ${fen}`);

      let lastScoreStm = 0;
      let mateStm: number | null = null;
      let sawScore = false;

      const onLine = (line: string) => {
        if (!line.startsWith("info ")) return;
        // Prefer multipv 1 / main line scores
        const mate = line.match(/\bscore mate (-?\d+)/);
        if (mate) {
          mateStm = parseInt(mate[1]!, 10);
          lastScoreStm =
            mateStm > 0 ? 100_000 - mateStm * 100 : -100_000 - Math.abs(mateStm) * 100;
          sawScore = true;
          return;
        }
        // Stockfish: "score cp 34" or "score cp -12"
        const cp = line.match(/\bscore cp (-?\d+)/);
        if (cp) {
          mateStm = null;
          lastScoreStm = parseInt(cp[1]!, 10);
          sawScore = true;
        }
      };

      this.listeners.add(onLine);
      try {
        if (movetimeMs) {
          this.send(`go movetime ${movetimeMs}`);
        } else {
          this.send(`go depth ${Math.max(1, depth)}`);
        }
        const bestLine = await this.waitFor(
          (l) => l.startsWith("bestmove"),
          Math.max(15_000, (movetimeMs ?? depth * 800) + 10_000),
        );

        const turn = fen.split(" ")[1];
        // If no score line arrived, treat as 0
        const stmScore = sawScore ? lastScoreStm : 0;
        const whitePov = turn === "b" ? -stmScore : stmScore;
        let mate: number | null = null;
        if (mateStm !== null) {
          mate = turn === "b" ? -mateStm : mateStm;
        }
        const parts = bestLine.split(/\s+/);
        const mv = parts[1];
        const bestMove = !mv || mv === "(none)" ? null : mv;

        return { scoreCp: whitePov, mate, bestMove };
      } finally {
        this.listeners.delete(onLine);
      }
    });
  }

  async bestMove(
    fen: string,
    opts: { depth?: number; movetime?: number; skill?: number },
  ): Promise<string | null> {
    return this.enqueue(async () => {
      await this.init();
      if (opts.skill !== undefined) await this.setSkill(opts.skill);
      this.send("stop");
      await new Promise((r) => setTimeout(r, 10));
      this.send("ucinewgame");
      this.send(`position fen ${fen}`);
      if (opts.movetime) {
        this.send(`go movetime ${opts.movetime}`);
      } else {
        this.send(`go depth ${opts.depth ?? 12}`);
      }
      const line = await this.waitFor(
        (l) => l.startsWith("bestmove"),
        Math.max(20_000, (opts.movetime ?? 5000) + 15_000),
      );
      const parts = line.split(/\s+/);
      const mv = parts[1];
      if (!mv || mv === "(none)") return null;
      return mv;
    });
  }

  dispose() {
    try {
      this.send("quit");
    } catch {
      /* ignore */
    }
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.listeners.clear();
    this.chain = Promise.resolve();
  }
}

let singleton: StockfishEngine | null = null;

export function getStockfish(): StockfishEngine {
  if (!singleton) singleton = new StockfishEngine();
  return singleton;
}
