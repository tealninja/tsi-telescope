/* ============================================================
   Cloudflare Worker — shared-state API + static-asset host.

   Routes:
     GET  /api/state  → the shared plan blob from KV (or the literal
                        JSON `null` when nothing has been saved yet)
     PUT  /api/state  → overwrite the shared plan blob in KV

   Everything else is handed to the static-assets binding (the SPA).
   wrangler.jsonc routes only /api/* here via assets.run_worker_first.

   The whole plan is a single KV key (PLAN_KEY). Concurrency is
   last-write-wins; the client stamps `updatedAt` on the blob so peers
   can tell whether the server copy is newer than their own.
   ============================================================ */

const PLAN_KEY = 'plan:default';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/state') {
      if (request.method === 'GET') {
        const blob = await env.STATE_KV.get(PLAN_KEY);
        return new Response(blob ?? 'null', {
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store'
          }
        });
      }

      if (request.method === 'PUT') {
        const body = await request.text();
        // Refuse anything that isn't valid JSON so a bad client can't
        // poison the shared key.
        try { JSON.parse(body); }
        catch { return json({ error: 'invalid JSON' }, 400); }
        await env.STATE_KV.put(PLAN_KEY, body);
        return json({ ok: true });
      }

      return json({ error: 'method not allowed' }, 405);
    }

    // Not an API route — serve the static SPA.
    return env.ASSETS.fetch(request);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
