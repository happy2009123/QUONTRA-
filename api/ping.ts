/** Dependency-free probe: verifies Vercel function plumbing works. */

export default function handler(): Response {
  return new Response(JSON.stringify({ ok: true, fn: 'ping', ts: new Date().toISOString() }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Quantora-Fn': 'ping-v1',
    },
  });
}
