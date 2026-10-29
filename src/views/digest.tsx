import type { DigestRow, Night } from '../digest/types.js';

const DASH = '—';

function mark(row: DigestRow): string {
  const parts: string[] = [];
  if (row.retries >= 3) parts.push('retries ≥ 3');
  if (row.lastStatus === 'fail') parts.push('fail');
  return parts.length > 0 ? parts.join(', ') : DASH;
}

export function Digest({ night }: { night: Night }) {
  return (
    <>
      <h1>digest · {night.night}</h1>
      <p>lines that didn't parse: {night.badLines}</p>
      {night.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
              <th>mark</th>
            </tr>
          </thead>
          <tbody>
            {night.rows.map((row) => {
              const m = mark(row);
              return (
                <tr class={m === DASH ? undefined : 'warn'}>
                  <td>{row.job}</td>
                  <td>{row.owner ?? DASH}</td>
                  <td>{row.runs}</td>
                  <td>{row.retries}</td>
                  <td>{row.lastStatus}</td>
                  <td>{row.lastError ?? DASH}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                  <td>{m}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

export function NoNight({ night }: { night: string }) {
  return <p>no run log for {night}</p>;
}
