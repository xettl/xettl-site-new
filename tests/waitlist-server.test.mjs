import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../netlify/functions/waitlist.mjs';
import contract from '../lib/waitlist-contract.cjs';
const payload = () => ({ version: 4, requestId: crypto.randomUUID(), fullName: '李', email: 'TEST@example.com', countryFrom: '', featureWish: 'An account before arrival.', adultConfirmed: true, termsAccepted: true, privacyAcknowledged: true, emailPreferences: { newsletter: false, marketing: true }, ...contract.versions });
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test', RATE_LIMIT_SECRET: 'x'.repeat(32), XETTL_ALLOWED_ORIGINS: 'https://getxettl.com' };
const ack = { version: 4, acknowledged: true, receipt: { id: crypto.randomUUID(), saved: true, preferencesSaved: true, emailStatus: 'pending' } };
const request = (data = payload(), headers = {}) => new Request('https://getxettl.com/api/waitlist', { method: 'POST', headers: { origin: 'https://getxettl.com', 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) });
test('server normalizes and saves without forwarding raw IP or browser credentials', async () => {
  let captured;
  const handler = createHandler(env, async (url, options) => { captured = { url: String(url), ...options }; return Response.json(ack); });
  const res = await handler(request(), { ip: '192.0.2.1' });
  assert.equal(res.status, 200);
  const saved = JSON.parse(captured.body);
  assert.equal(saved.p_payload.email, 'test@example.com');
  assert.equal(saved.p_payload.fullName, '李');
  assert.match(saved.p_rate_key, /^[a-f0-9]{64}$/);
  assert.ok(!captured.body.includes('192.0.2.1'));
  assert.equal(captured.headers.Authorization, undefined);
  assert.equal(captured.headers.apikey, 'sb_secret_test');
  assert.deepEqual(await res.json(), ack);
});
test('server rejects cross-origin, wrong content type, oversized and malformed requests before database access', async () => {
  const handler = createHandler(env, () => { throw new Error('must not call'); });
  assert.equal((await handler(request(payload(), { origin: 'https://evil.example' }), { ip: '192.0.2.1' })).status, 403);
  assert.equal((await handler(request(payload(), { 'content-type': 'text/plain' }), { ip: '192.0.2.1' })).status, 415);
  assert.equal((await handler(request({ padding: 'x'.repeat(9000) }), { ip: '192.0.2.1' })).status, 413);
  assert.equal((await handler(new Request('https://getxettl.com/api/waitlist', { method: 'POST', headers: { origin: 'https://getxettl.com', 'content-type': 'application/json' }, body: '{' }), { ip: '192.0.2.1' })).status, 400);
  assert.equal((await handler(new Request('https://getxettl.com/api/waitlist'))).status, 405);
});
test('age, legal evidence and versions must match; errors contain only field flags', async () => {
  const handler = createHandler(env, () => { throw new Error('must not call'); });
  for (const key of ['adultConfirmed', 'termsAccepted', 'privacyAcknowledged']) {
    const res = await handler(request({ ...payload(), [key]: false }), { ip: '192.0.2.1' });
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { fieldErrors: { [key === 'privacyAcknowledged' ? 'termsAccepted' : key]: true } });
  }
  assert.equal((await handler(request({ ...payload(), privacyVersion: '2026-10-17' }), { ip: '192.0.2.1' })).status, 400);
  assert.equal((await handler(request({ ...payload(), emailPreferences: { newsletter: 'yes', marketing: false } }), { ip: '192.0.2.1' })).status, 400);
});
test('database failures never become saved receipts and do not leak error text', async () => {
  for (const fetcher of [async () => new Response('private error', { status: 500 }), async () => Response.json({ success: true }), async () => { throw new Error('secret'); }]) {
    const res = await createHandler(env, fetcher)(request(), { ip: '192.0.2.1' });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'save_unconfirmed' });
  }
});
test('rate limits and reused requests have distinct retry statuses', async () => {
  for (const [error, status] of [['rate_limit', 429], ['request_conflict', 409]]) {
    const res = await createHandler(env, async () => Response.json({ error }))(request(), { ip: '192.0.2.1' });
    assert.equal(res.status, status);
  }
});
test('missing trusted IP, secret or rate secret fails closed', async () => {
  assert.equal((await createHandler(env)(request())).status, 503);
  for (const key of ['SUPABASE_SECRET_KEY', 'RATE_LIMIT_SECRET', 'SUPABASE_URL']) assert.equal((await createHandler({ ...env, [key]: '' })(request(), { ip: '192.0.2.1' })).status, 503);
});
