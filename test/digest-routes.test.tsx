import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const good = '2026-10-20';
const empty = '2026-10-21';
const bad = '2026-10-22';
const missing = '2026-10-23';

const line = (at: string, job: string, status: string, owner: string | null, error?: string): string =>
  JSON.stringify({ at, job, status, owner, ...(error ? { error } : {}) });

let dir = '';
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  process.env.LANE_MARKER = 'TEST-MARKER';
  dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  // Written out of job order on purpose.
  const goodLines = [
    line('2026-10-20T23:00:01+01:00', 'zeta/ownerless', 'ok', null),
    line('2026-10-20T23:00:02+01:00', 'mid/flaky', 'retry', 'rook', 'timeout'),
    line('2026-10-20T23:00:03+01:00', 'mid/flaky', 'retry', 'rook', 'timeout'),
    line('2026-10-20T23:00:04+01:00', 'mid/flaky', 'retry', 'rook', 'timeout'),
    line('2026-10-20T23:00:05+01:00', 'mid/flaky', 'ok', 'rook'),
    line('2026-10-20T23:00:06+01:00', 'alpha/broken', 'fail', 'lane-07', 'boom'),
  ];
  writeFileSync(join(dir, `${good}.jsonl`), goodLines.join('\n') + '\n');
  writeFileSync(join(dir, `${empty}.jsonl`), '');
  writeFileSync(
    join(dir, `${bad}.jsonl`),
    [
      line('2026-10-22T23:00:01+01:00', 'alpha/one', 'ok', 'rook'),
      '{"at":"2026-10-22T23:00:02+01:00","job":"trunc',
      line('2026-10-22T23:00:03+01:00', 'beta/two', 'ok', 'rook'),
    ].join('\n') + '\n',
  );
  app = createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir: dir,
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const jobs = ['alpha/broken', 'mid/flaky', 'zeta/ownerless'];

describe('GET /digest/:night', () => {
  it('renders the good night', async () => {
    const res = await app.request(`/digest/${good}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain(`digest · ${good}`);
    expect(html).toContain('<table');
    const at = jobs.map((job) => html.indexOf(job));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(html).toContain('retries ≥ 3');
    expect(html).toMatch(/<tr class="warn"><td>alpha\/broken<\/td>.*<td>fail<\/td><\/tr>/);
    expect(html).toMatch(/<tr class="warn"><td>mid\/flaky<\/td>.*<td>retries ≥ 3<\/td><\/tr>/);
    expect(html).toMatch(/<tr><td>zeta\/ownerless<\/td>.*<td>—<\/td><\/tr>/);
    expect(html).toContain('—');
    expect(html).toContain('lines that didn&#39;t parse: 0');
    expect(html).not.toContain('nothing ran');
  });

  it('shows nothing ran for an empty night', async () => {
    const res = await app.request(`/digest/${empty}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
  });

  it('counts the bad line', async () => {
    const res = await app.request(`/digest/${bad}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('lines that didn&#39;t parse: 1');
    expect(html).toContain('alpha/one');
    expect(html).toContain('beta/two');
  });

  it('404s for a night with no file and for a bad night', async () => {
    for (const night of [missing, 'nope', '2026-1-2']) {
      const res = await app.request(`/digest/${night}`);
      expect(res.status).toBe(404);
      expect(await res.text()).toContain(`no run log for ${night}`);
    }
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the good night, in the same order as the page', async () => {
    const res = await app.request(`/api/digest/${good}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.night).toBe(good);
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual(jobs);
    const flaky = body.rows.find((r) => r.job === 'mid/flaky');
    expect(flaky?.retries).toBe(3);
    expect(body.rows.find((r) => r.job === 'alpha/broken')?.lastStatus).toBe('fail');
    expect(body.rows.find((r) => r.job === 'zeta/ownerless')?.owner).toBeNull();

    const html = await (await app.request(`/digest/${good}`)).text();
    const at = body.rows.map((r) => html.indexOf(r.job));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('returns no rows for an empty night', async () => {
    const res = await app.request(`/api/digest/${empty}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('reports bad lines', async () => {
    const res = await app.request(`/api/digest/${bad}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.badLines).toBe(1);
    expect(body.rows).toHaveLength(2);
  });

  it('404s with a JSON error', async () => {
    for (const night of [missing, 'nope']) {
      const res = await app.request(`/api/digest/${night}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'no run log', night });
    }
  });
});
