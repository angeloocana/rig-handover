import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NIGHT_PATTERN, type DigestRow, type ReadNight, type RunLine } from './types.js';

const parseLine = (text: string): RunLine | null => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('at' in value) || typeof value.at !== 'string') return null;
  if (!('job' in value) || typeof value.job !== 'string') return null;
  if (!('status' in value)) return null;
  const status = value.status;
  if (status !== 'ok' && status !== 'retry' && status !== 'fail') return null;

  const owner = 'owner' in value ? value.owner : null;
  if (owner !== null && typeof owner !== 'string') return null;

  return {
    at: value.at,
    job: value.job,
    status,
    owner,
    ...('error' in value && typeof value.error === 'string' ? { error: value.error } : {}),
  };
};

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT_PATTERN.test(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const jobs = new Map<string, DigestRow>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const text of contents.split('\n')) {
    if (text.trim() === '') continue;
    const line = parseLine(text);
    if (line === null) {
      badLines += 1;
      continue;
    }

    counts[line.status] += 1;
    const row = jobs.get(line.job);
    if (row) {
      row.owner = line.owner;
      row.runs += 1;
      row.retries += line.status === 'retry' ? 1 : 0;
      row.lastStatus = line.status;
      row.lastAt = line.at;
      if (line.error !== undefined) row.lastError = line.error;
    } else {
      jobs.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: line.status === 'retry' ? 1 : 0,
        lastStatus: line.status,
        lastError: line.error ?? null,
        firstAt: line.at,
        lastAt: line.at,
      });
    }
  }

  const rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { night, rows, badLines, counts };
};
