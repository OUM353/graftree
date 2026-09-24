export interface WorkerTask {
  prompt: string;
  /** Working directory: always an isolated worktree for anything that edits code. */
  cwd: string;
  timeoutSec?: number;
}

export interface WorkerResult {
  worker: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  /** Final answer text extracted from the worker's output. */
  text: string;
  stdout: string;
  stderr: string;
  usage?: unknown;
  durationMs: number;
}
