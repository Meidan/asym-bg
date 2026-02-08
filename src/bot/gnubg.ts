import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { GameState, Player } from '../engine/types';
import { getOpponent } from '../engine/board';

export type GnuBgEquityType = 'cubeless' | 'cubeful';

export interface GnuBgEvalOptions {
  state: GameState;
  perspective: Player;
  equity: GnuBgEquityType;
  timeoutMs?: number;
}

const GNUBG_PATH = process.env.GNUBG_PATH || 'gnubg';
const DEFAULT_TIMEOUT_MS = 30_000;
const CACHE_LIMIT = 2_000;
const PROMPT_TOKEN = `__GNUBG_PROMPT_${Math.random().toString(36).slice(2)}__`;
const PROMPT_SENTINELS = [
  `The prompt is set to \`${PROMPT_TOKEN}'.`,
  `The prompt is set to \`${PROMPT_TOKEN}\`.`
];

type EvalCacheEntry = { cubeless: number; cubeful: number };

type PendingRequest = {
  commands: string;
  timeoutMs: number;
  resolve: (output: string) => void;
  reject: (error: Error) => void;
  timeoutHandle?: NodeJS.Timeout;
};

const evalCache = new Map<string, EvalCacheEntry>();

class GnubgRunner {
  private child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private queue: PendingRequest[] = [];
  private active: PendingRequest | null = null;
  private ready: Promise<void>;
  private closed = false;

  constructor() {
    this.child = spawn(GNUBG_PATH, ['-t', '-q', '-r'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        LANG: 'C',
        LC_ALL: 'C'
      }
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.handleData(String(chunk)));
    this.child.stderr.on('data', (chunk) => this.handleData(String(chunk)));
    this.child.on('close', (code, signal) => this.handleExit(code, signal));
    this.ready = this.enqueueInternal(`set prompt ${PROMPT_TOKEN}`, DEFAULT_TIMEOUT_MS)
      .then(() => undefined);
  }

  isClosed(): boolean {
    return this.closed;
  }

  async evaluate(commands: string, timeoutMs?: number): Promise<string> {
    await this.ready;
    return this.enqueueInternal(commands, timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  shutdown(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    if (error) {
      this.failAll(error);
    }
    try {
      this.child.stdin.end();
    } catch (err) {
      // ignore
    }
    try {
      this.child.kill();
    } catch (err) {
      // ignore
    }
  }

  private enqueueInternal(commands: string, timeoutMs: number): Promise<string> {
    if (this.closed) {
      return Promise.reject(new Error('gnubg process is not running'));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ commands, timeoutMs, resolve, reject });
      this.flushNext();
    });
  }

  private flushNext(): void {
    if (this.active || this.closed) return;
    const next = this.queue.shift();
    if (!next) return;
    this.active = next;
    const payload = `${next.commands}\nshow prompt\n`;
    try {
      this.child.stdin.write(payload);
    } catch (error) {
      this.handleFatal(new Error(`Failed to write to gnubg stdin: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }

    if (next.timeoutMs > 0) {
      next.timeoutHandle = setTimeout(() => {
        this.handleFatal(new Error(`gnubg eval timed out after ${next.timeoutMs}ms`));
      }, next.timeoutMs);
    }
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    this.processBuffer();
  }

  private processBuffer(): void {
    while (this.active) {
      let idx = -1;
      let matchedLength = 0;
      for (const sentinel of PROMPT_SENTINELS) {
        const found = this.buffer.indexOf(sentinel);
        if (found !== -1 && (idx === -1 || found < idx)) {
          idx = found;
          matchedLength = sentinel.length;
        }
      }
      if (idx === -1) return;
      const output = this.buffer.slice(0, idx);
      const afterIdx = this.buffer.indexOf('\n', idx + matchedLength);
      this.buffer = afterIdx === -1 ? '' : this.buffer.slice(afterIdx + 1);

      const request = this.active;
      this.active = null;
      if (request.timeoutHandle) {
        clearTimeout(request.timeoutHandle);
      }
      request.resolve(output);
      this.flushNext();
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.closed) return;
    this.closed = true;
    const error = new Error(`gnubg exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`);
    this.failAll(error);
  }

  private handleFatal(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll(error);
    try {
      this.child.kill();
    } catch (err) {
      // ignore
    }
  }

  private failAll(error: Error): void {
    if (this.active) {
      if (this.active.timeoutHandle) {
        clearTimeout(this.active.timeoutHandle);
      }
      this.active.reject(error);
      this.active = null;
    }

    while (this.queue.length > 0) {
      const req = this.queue.shift();
      if (!req) continue;
      if (req.timeoutHandle) {
        clearTimeout(req.timeoutHandle);
      }
      req.reject(error);
    }
  }
}

let runner: GnubgRunner | null = null;

function getRunner(): GnubgRunner {
  if (!runner || runner.isClosed()) {
    runner = new GnubgRunner();
  }
  return runner;
}

export function shutdownGnubg(): void {
  if (runner) {
    runner.shutdown();
    runner = null;
  }
}

function getPlayerIndex(player: Player): 0 | 1 {
  return player === 'white' ? 1 : 0;
}

function pointOrder(player: Player): number[] {
  if (player === 'white') {
    return Array.from({ length: 24 }, (_, idx) => idx + 1);
  }
  return Array.from({ length: 24 }, (_, idx) => 24 - idx);
}

function appendBitsForPlayer(state: GameState, player: Player, bits: number[]): void {
  const board = state.board;
  const points = pointOrder(player);
  for (const point of points) {
    const stack = board[point];
    const count = stack && stack.player === player ? stack.count : 0;
    for (let i = 0; i < count; i += 1) bits.push(1);
    bits.push(0);
  }

  const barPoint = player === 'white' ? 0 : 25;
  const barStack = board[barPoint];
  const barCount = barStack && barStack.player === player ? barStack.count : 0;
  for (let i = 0; i < barCount; i += 1) bits.push(1);
  bits.push(0);
}

function buildPositionId(state: GameState): string {
  const bits: number[] = [];
  const onRoll = state.currentPlayer;
  const offRoll = getOpponent(onRoll);

  appendBitsForPlayer(state, offRoll, bits);
  appendBitsForPlayer(state, onRoll, bits);

  while (bits.length < 80) bits.push(0);

  const bytes = new Uint8Array(10);
  for (let i = 0; i < 80; i += 1) {
    if (bits[i]) {
      bytes[i >> 3] |= 1 << (i & 7);
    }
  }

  return Buffer.from(bytes).toString('base64').replace(/=+$/, '');
}

function parseEvalOutput(output: string): EvalCacheEntry | null {
  const lines = output.split(/\r?\n/);
  const rowRegex = /^\s*(static|\d+\s*ply|\d+\-ply)\s*:/i;
  let lastRow: EvalCacheEntry | null = null;

  for (const line of lines) {
    if (!rowRegex.test(line)) continue;
    const numbers = line.match(/[+-]?\d+(?:\.\d+)?/g);
    if (!numbers || numbers.length < 2) continue;
    const cubeful = Number(numbers[numbers.length - 1]);
    const cubeless = Number(numbers[numbers.length - 2]);
    if (Number.isFinite(cubeless) && Number.isFinite(cubeful)) {
      lastRow = { cubeless, cubeful };
    }
  }

  if (lastRow) return lastRow;

  const cubelessMatch = output.match(/cubeless equity\s+([+-]?\d+(?:\.\d+)?)/i);
  const cubefulMatch = output.match(/No double\s+([+-]?\d+(?:\.\d+)?)/i);
  const cubeless = cubelessMatch ? Number(cubelessMatch[1]) : null;
  const cubeful = cubefulMatch ? Number(cubefulMatch[1]) : null;
  if (cubeless === null || cubeful === null || !Number.isFinite(cubeless) || !Number.isFinite(cubeful)) {
    return null;
  }
  return { cubeless, cubeful };
}

function cacheKey(state: GameState): string {
  const positionId = buildPositionId(state);
  const cubeValue = Math.max(1, state.doublingCube.value);
  const owner = state.doublingCube.owner;
  const ownerKey = owner === null ? 'C' : owner === 'white' ? 'W' : 'B';
  const turnKey = state.currentPlayer === 'white' ? 'W' : 'B';
  return `${positionId}|${turnKey}|${cubeValue}|${ownerKey}`;
}

function setCache(key: string, entry: EvalCacheEntry): void {
  if (evalCache.size >= CACHE_LIMIT) {
    const firstKey = evalCache.keys().next().value;
    if (firstKey) evalCache.delete(firstKey);
  }
  evalCache.set(key, entry);
}

async function runGnubgEval(state: GameState, timeoutMs?: number): Promise<EvalCacheEntry> {
  const positionId = buildPositionId(state);
  const turnIndex = getPlayerIndex(state.currentPlayer);
  const cubeValue = Math.max(1, state.doublingCube.value);
  const owner = state.doublingCube.owner;
  const cubeOwnerCommand = owner === null
    ? 'set cube centre'
    : `set cube owner ${getPlayerIndex(owner)}`;

  const commands = [
    'new game',
    `set turn ${turnIndex}`,
    `set board ${positionId}`,
    `set cube value ${cubeValue}`,
    cubeOwnerCommand,
    'eval'
  ].join('\n');

  const output = await getRunner().evaluate(commands, timeoutMs);

  const parsed = parseEvalOutput(output);
  if (!parsed) {
    throw new Error(`Unable to parse gnubg eval output. output=${JSON.stringify(output)}`);
  }
  return parsed;
}

export async function evaluateStateWithGnubg(options: GnuBgEvalOptions): Promise<number> {
  const { state, perspective, equity, timeoutMs } = options;
  const key = cacheKey(state);
  let cached = evalCache.get(key);
  if (!cached) {
    const startMs = Date.now();
    cached = await runGnubgEval(state, timeoutMs);
    const durationMs = Date.now() - startMs;
    setCache(key, cached);
    const onRollEquity = equity === 'cubeless' ? cached.cubeless : cached.cubeful;
    const returned = perspective === state.currentPlayer ? onRollEquity : -onRollEquity;
  }

  const onRollEquity = equity === 'cubeless' ? cached.cubeless : cached.cubeful;
  return perspective === state.currentPlayer ? onRollEquity : -onRollEquity;
}
