/** Dependency-free probe: verifies Vercel function plumbing works. */

import type { ServerResponse } from 'node:http';

export default function handler(_req: unknown, res: ServerResponse): void {
  const text = JSON.stringify({ ok: true, fn: 'ping', ts: new Date().toISOString() });
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'X-Quantora-Fn': 'ping-v2',
  });
  res.end(text);
}
