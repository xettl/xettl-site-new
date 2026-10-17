import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import contract from '../lib/waitlist-contract.cjs';
test('Postgres migration enforces private storage, atomic evidence, retries, duplicates and rate limits', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    const directory = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, directory), 'utf8'));
    const payload = (email = 'owner@example.test') => ({ version: 4, requestId: crypto.randomUUID(), fullName: 'Test', email, countryFrom: '', featureWish: 'An account before I land.', adultConfirmed: true, termsAccepted: true, privacyAcknowledged: true, emailPreferences: { newsletter: false, marketing: false }, ...contract.versions });
    const save = async (data, rate = 'a'.repeat(64)) => (await db.query('select public.submit_waitlist($1::jsonb,$2::text) as receipt', [JSON.stringify(data), rate])).rows[0].receipt;
    const data = payload();
    const first = await save(data);
    assert.equal(first.receipt.saved, true);
    assert.equal(first.receipt.preferencesSaved, true);
    assert.deepEqual(await save(data), first);
    assert.equal((await save({ ...data, featureWish: 'Different wish' })).error, 'request_conflict');
    const duplicate = await save({ ...payload(), emailPreferences: { newsletter: true, marketing: true } });
    assert.equal(duplicate.receipt.saved, true);
    assert.notEqual(duplicate.receipt.id, first.receipt.id);
    const records = (await db.query('select * from private.waitlist_signups')).rows;
    assert.equal(records.length, 1);
    assert.equal(records[0].newsletter_status, 'not_requested');
    assert.equal(records[0].marketing_requested, false);
    assert.equal((await db.query('select * from private.waitlist_requests')).rows.length, 2);
    await assert.rejects(save({ ...payload('invalid@example.test'), adultConfirmed: false }));
    await assert.rejects(save({ ...payload('old-policy@example.test'), privacyVersion: '2026-10-17-analytics' }));
    assert.equal((await db.query('select count(*) from private.waitlist_signups')).rows[0].count, 1);
    for (let i = 0; i < 10; i++) assert.equal((await save(payload('rate' + i + '@example.test'), 'b'.repeat(64))).receipt.saved, true);
    assert.equal((await save(payload('blocked@example.test'), 'b'.repeat(64))).error, 'rate_limit');
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      await assert.rejects(db.query('select * from private.waitlist_signups'));
      await assert.rejects(save(payload()));
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.equal((await save(payload('service@example.test'), 'c'.repeat(64))).receipt.saved, true);
    await db.exec('reset role');
  } finally { await db.close(); }
});
test('privacy upgrade preserves existing signup evidence and accepts new wording afterward', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(await readFile(new URL('../supabase/migrations/202610170001_private_waitlist.sql', import.meta.url), 'utf8'));
    const original = { version: 4, requestId: crypto.randomUUID(), fullName: 'Original', email: 'existing@example.test', countryFrom: '', featureWish: 'Original wish', adultConfirmed: true, termsAccepted: true, privacyAcknowledged: true, emailPreferences: { newsletter: false, marketing: true }, ...contract.versions, privacyVersion: '2026-10-17-analytics' };
    const save = async payload => db.query('select public.submit_waitlist($1::jsonb,$2::text) as result', [JSON.stringify(payload), 'e'.repeat(64)]);
    await save(original);
    const before = (await db.query('select * from private.waitlist_signups')).rows;
    const evidence = (await db.query('select * from private.waitlist_requests')).rows;
    await db.exec(await readFile(new URL('../supabase/migrations/202610170002_dual_analytics_privacy.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await db.query('select * from private.waitlist_signups')).rows, before);
    assert.deepEqual((await db.query('select * from private.waitlist_requests')).rows, evidence);
    const updated = { ...original, requestId: crypto.randomUUID(), ...contract.versions };
    assert.equal((await save(updated)).rows[0].result.receipt.saved, true);
    assert.equal((await db.query('select count(*) from private.waitlist_signups')).rows[0].count, 1);
    assert.equal((await db.query('select privacy_version from private.waitlist_signups')).rows[0].privacy_version, '2026-10-17-analytics');
    await assert.rejects(save({ ...original, requestId: crypto.randomUUID() }));
  } finally { await db.close(); }
});
