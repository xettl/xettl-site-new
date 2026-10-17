import { createHmac } from 'node:crypto';
import contract from '../../lib/waitlist-contract.cjs';

const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export function createHandler(env = process.env, fetcher = fetch) {
  return async function handler(request, context = {}) {
    if (request.method !== 'POST') return response(405, { error: 'method_not_allowed' });
    const allowed = (env.XETTL_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    if (!allowed.includes(request.headers.get('origin'))) return response(403, { error: 'origin_not_allowed' });
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return response(415, { error: 'json_required' });
    const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    let base;
    try { base = new URL(env.SUPABASE_URL); } catch { return response(503, { error: 'unavailable' }); }
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/' || !secret || (env.RATE_LIMIT_SECRET || '').length < 32) return response(503, { error: 'unavailable' });
    // Netlify supplies this trusted value; never use a caller-provided forwarded-IP header.
    if (!context.ip) return response(503, { error: 'unavailable' });
    let input;
    try {
      if (Number(request.headers.get('content-length')) > 8192) return response(413, { error: 'too_large' });
      const reader = request.body?.getReader();
      if (!reader) return response(400, { error: 'invalid_json' });
      let size = 0; const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) { await reader.cancel(); return response(413, { error: 'too_large' }); }
        chunks.push(value);
      }
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return response(400, { error: 'invalid_json' }); }
    const checked = contract.validate(input);
    if (checked.invalidContract) return response(400, { error: 'invalid_contract' });
    if (Object.keys(checked.errors).length) return response(422, { fieldErrors: checked.errors });
    const rateKey = createHmac('sha256', env.RATE_LIMIT_SECRET).update(new Date().toISOString().slice(0, 10) + ':' + context.ip).digest('hex');
    try {
      const headers = { apikey: secret, 'Content-Type': 'application/json' };
      // Legacy service-role JWTs use Bearer auth; new sb_secret keys use apikey only.
      if (!secret.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + secret;
      const saved = await fetcher(new URL('/rest/v1/rpc/submit_waitlist', base), { method: 'POST', headers, body: JSON.stringify({ p_payload: checked.data, p_rate_key: rateKey }), signal: AbortSignal.timeout(9000), redirect: 'error' });
      if (!saved.ok) return response(503, { error: 'save_unconfirmed' });
      const result = await saved.json();
      if (result?.error === 'rate_limit') return response(429, { error: 'rate_limit' });
      if (result?.error === 'request_conflict') return response(409, { error: 'request_conflict' });
      if (result?.version !== 4 || result.acknowledged !== true || result.receipt?.saved !== true || result.receipt.preferencesSaved !== true || typeof result.receipt.id !== 'string' || result.receipt.emailStatus !== 'pending') return response(503, { error: 'save_unconfirmed' });
      return response(200, result);
    } catch { return response(503, { error: 'save_unconfirmed' }); }
  };
}
export default createHandler();
export const config = { path: '/api/waitlist', rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
