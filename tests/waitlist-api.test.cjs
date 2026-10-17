'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/waitlist-api.js'), 'utf8');
function client(endpoint, response, status = 200) {
  const calls = [];
  const context = {
    window: { location: { origin: 'http://127.0.0.1:8790' }, XETTL_SITE_CONFIG: { waitlistEndpoint: endpoint } },
    URL, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (response instanceof Error) throw response;
      return { ok: status >= 200 && status < 300, status, json: async () => {
        if (response === 'bad-json') throw new Error('Invalid JSON');
        return response;
      } };
    }
  };
  vm.runInNewContext(source, context);
  return { api: context.window.XettlWaitlistAPI, calls };
}
const ack = emailStatus => ({ version: 4, acknowledged: true, receipt: { id: 'test-receipt', saved: true, preferencesSaved: true, emailStatus } });
test('unconfigured signup does not send any data', async () => {
  const { api, calls } = client('', ack('accepted'));
  await assert.rejects(api.submit({}), e => e.code === 'unconfigured');
  assert.equal(calls.length, 0);
});
for (const url of ['http://example.com/api', 'https://user:pass@example.com/api', 'javascript:alert(1)', '/api?token=secret', '/api#fragment']) {
  test('reject unsafe endpoint: ' + url, () => assert.equal(client(url).api.endpoint(), ''));
}
for (const emailStatus of ['accepted', 'pending', 'failed']) {
  test('durable save acknowledged even when email is ' + emailStatus, async () => {
    const { api, calls } = client('/api/waitlist', ack(emailStatus));
    const payload = { version: 4, fullName: 'Test Person', requestId: 'test-id', adultConfirmed: true, termsAccepted: true, privacyAcknowledged: true, emailPreferences: { newsletter: false, marketing: false } };
    assert.equal((await api.submit(payload)).emailStatus, emailStatus);
    assert.equal(calls[0].options.credentials, 'omit');
    assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
    assert.equal(calls[0].options.redirect, 'error');
    assert.equal(calls[0].options.cache, 'no-store');
    assert.deepEqual(JSON.parse(calls[0].options.body), payload);
  });
}
for (const response of [{ success: true }, { version: 1, acknowledged: true }, { ...ack('accepted'), version: 2 }, { ...ack('accepted'), version: 3 }, ack('delivered'), { ...ack('accepted'), receipt: { saved: false } }, { ...ack('accepted'), receipt: { ...ack('accepted').receipt, preferencesSaved: false } }, 'bad-json', null, new Error('Network unavailable')]) {
  test('does not invent success from incomplete receipt: ' + JSON.stringify(response), async () => {
    const { api } = client('/api/waitlist', response);
    await assert.rejects(api.submit({}), e => e.code === 'unconfirmed');
  });
}
test('server field errors are allowlisted and raw strings are never exposed', async () => {
  const { api } = client('/api/waitlist', { fieldErrors: { email: '<img onerror=alert(1)>', secretField: 'bad' } }, 422);
  await assert.rejects(api.submit({}), e => e.code === 'validation' && e.fields.email === true && Object.keys(e.fields).length === 1);
});
test('rate limit has a distinct retry state', async () => {
  const { api } = client('/api/waitlist', {}, 429);
  await assert.rejects(api.submit({}), e => e.code === 'rate_limit');
});
test('legal acceptance errors are safely allowlisted', async () => {
  const { api } = client('/api/waitlist', { fieldErrors: { termsAccepted: '<script>bad</script>', internal: 'secret' } }, 422);
  await assert.rejects(api.submit({}), e => e.code === 'validation' && e.fields.termsAccepted === true && Object.keys(e.fields).length === 1);
});
test('email choices remain independent booleans in the request', async () => {
  const { api, calls } = client('/api/waitlist', ack('accepted'));
  await api.submit({ version: 4, emailPreferences: { newsletter: true, marketing: false }, adultConfirmed: true, termsAccepted: true, privacyAcknowledged: true });
  assert.deepEqual(JSON.parse(calls[0].options.body).emailPreferences, { newsletter: true, marketing: false });
});

test('adult confirmation errors are safely allowlisted', async () => {
  const { api } = client('/api/waitlist', { fieldErrors: { adultConfirmed: '<script>bad</script>', internal: 'secret' } }, 422);
  await assert.rejects(api.submit({}), e => e.code === 'validation' && e.fields.adultConfirmed === true && Object.keys(e.fields).length === 1);
});
