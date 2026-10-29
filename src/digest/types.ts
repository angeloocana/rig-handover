// YYYY-MM-DD shape; routes return 404 for anything else.
export const NIGHT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type RunStatus = 'ok' | 'retry' | 'fail';

export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number; // Log lines for this job.
  retries: number; // Lines with status retry.
  lastStatus: RunStatus;
  lastError: string | null; // Most recent error seen, even after a later success.
  // ISO strings exactly as logged, with their offsets kept.
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string;
  rows: DigestRow[]; // Sorted by job; an empty file gives [].
  badLines: number; // Lines that could not be parsed.
  // Log lines by status, not jobs by their last status.
  counts: { ok: number; retry: number; fail: number };
};

// null means no file for this night; an empty file still returns a Night.
export type ReadNight = (runsDir: string, night: string) => Night | null;
