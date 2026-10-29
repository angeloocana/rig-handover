import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const night = '2026-10-28';
const at = '2026-10-28T23:00:06+01:00';
const validLine = { at, job: 'lane/sync', status: 'ok', owner: 'rook' };
const tempDirs: string[] = [];

const makeRunsDir = (contents?: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-read-'));
  tempDirs.push(dir);
  if (contents !== undefined) writeFileSync(join(dir, `${night}.jsonl`), contents);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNight', () => {
  it('reads the real night, retaining retries, errors, null owners and log offsets', () => {
    const result = readNight('runs', night);
    expect(result).not.toBeNull();
    expect(result?.night).toBe(night);
    expect(result?.rows.map(row => row.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(result?.badLines).toBe(1);
    expect(result?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(result?.rows.find(row => row.job === 'fixtures/refresh')).toMatchObject({
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
    });
    expect(result?.rows.find(row => row.job === 'notes/backup')?.lastStatus).toBe('fail');
    expect(result?.rows.find(row => row.job === 'digest/render')?.owner).toBeNull();
    expect(result?.rows.find(row => row.job === 'lane/sync')).toMatchObject({
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });

  it('reads the other real night without bad lines or retries', () => {
    const result = readNight('runs', '2026-10-27');
    expect(result?.rows).toHaveLength(4);
    expect(result?.badLines).toBe(0);
    expect(result?.counts).toEqual({ ok: 7, retry: 0, fail: 0 });
    expect(result?.rows.every(row => row.lastStatus === 'ok' && row.lastError === null)).toBe(true);
  });

  it('returns null for a missing file', () => {
    expect(readNight(makeRunsDir(), night)).toBeNull();
  });

  it.each(['../2026-10-28', '2026-10-28/../2026-10-28', '2026-1-28', '2026-10-28.jsonl', ''])(
    'returns null for an invalid night: %j',
    invalidNight => {
      expect(readNight(makeRunsDir(JSON.stringify(validLine)), invalidNight)).toBeNull();
    },
  );

  it.each(['', '\n \t\r\n\n'])('returns an empty night for an empty or blank file: %j', contents => {
    expect(readNight(makeRunsDir(contents), night)).toEqual({
      night,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts invalid JSON and invalid shapes, then continues with good lines', () => {
    const badLines = [
      '{broken',
      'null',
      '[]',
      '42',
      '"text"',
      'true',
      '{}',
      JSON.stringify({ ...validLine, at: null }),
      JSON.stringify({ ...validLine, job: 42 }),
      JSON.stringify({ ...validLine, status: 'pending' }),
      JSON.stringify({ ...validLine, status: { toString: null } }),
      JSON.stringify({ ...validLine, owner: 42 }),
      JSON.stringify({ job: 'missing/at', status: 'ok', owner: null }),
      JSON.stringify({ at, status: 'ok', owner: null }),
      JSON.stringify({ at, job: 'missing/status', owner: null }),
    ];
    const contents = [JSON.stringify(validLine), ...badLines, '', JSON.stringify(validLine)].join('\r\n');
    const result = readNight(makeRunsDir(contents), night);
    expect(result?.badLines).toBe(badLines.length);
    expect(result?.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].runs).toBe(2);
  });

  it('uses file order for history and owner, and keeps the most recent string error', () => {
    const lines = [
      { ...validLine, status: 'retry', error: 'first error' },
      { ...validLine, at: '2026-10-29T01:00:00+03:00', status: 'fail', owner: 'new owner', error: 'last error' },
      { ...validLine, at: '2026-10-27T22:00:00-04:00', owner: null, error: 503 },
    ];
    const result = readNight(makeRunsDir(lines.map(line => JSON.stringify(line)).join('\n')), night);
    expect(result).toEqual({
      night,
      rows: [{
        job: validLine.job,
        owner: null,
        runs: 3,
        retries: 1,
        lastStatus: 'ok',
        lastError: 'last error',
        firstAt: at,
        lastAt: '2026-10-27T22:00:00-04:00',
      }],
      badLines: 0,
      counts: { ok: 1, retry: 1, fail: 1 },
    });
  });

  it('treats missing owner as null and ignores non-string errors', () => {
    const lines = [
      { ...validLine, owner: 'first owner', error: false },
      { at, job: validLine.job, status: 'ok', error: { message: 'not a string' } },
    ];
    const result = readNight(makeRunsDir(lines.map(line => JSON.stringify(line)).join('\n')), night);
    expect(result?.badLines).toBe(0);
    expect(result?.rows[0]).toMatchObject({ owner: null, runs: 2, lastError: null });
  });

  it('keeps an empty string error as the latest error', () => {
    const lines = [
      { ...validLine, error: 'previous error' },
      { ...validLine, error: '' },
      validLine,
    ];
    const result = readNight(makeRunsDir(lines.map(line => JSON.stringify(line)).join('\n')), night);
    expect(result?.rows[0].lastError).toBe('');
  });

  it('sorts jobs with plain string comparison', () => {
    const lines = ['z', 'a', 'Z', '__proto__'].map(job => JSON.stringify({ ...validLine, job }));
    const result = readNight(makeRunsDir(lines.join('\n')), night);
    expect(result?.rows.map(row => row.job)).toEqual(['Z', '__proto__', 'a', 'z']);
  });

  it('throws read errors other than a missing file', () => {
    const dir = makeRunsDir();
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
  });
});
