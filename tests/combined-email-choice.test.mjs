import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import contract from '../lib/waitlist-contract.cjs';
const payload=(email,selected=false)=>({version:4,requestId:crypto.randomUUID(),fullName:'Choice test',email,countryFrom:'',featureWish:'Clear account setup.',adultConfirmed:true,termsAccepted:true,privacyAcknowledged:true,emailPreferences:{newsletter:selected,marketing:selected},...contract.combinedVersions});

test('combined email choice accepts both on or both off, rejects inconsistent wording and preserves old forms',()=>{
  for(const selected of [false,true]) {
    const data=payload('choice@example.test',selected),checked=contract.validate(data);
    assert.deepEqual(checked.errors,{});
    assert.equal(checked.data.emailPreferencesVersion,contract.combinedVersions.emailPreferencesVersion);
    assert.deepEqual(checked.data.emailPreferences,{newsletter:selected,marketing:selected});
  }
  assert.equal(contract.validate({...payload('invalid@example.test'),emailPreferences:{newsletter:true,marketing:false}}).invalidContract,true);
  assert.equal(contract.validate({...payload('invalid@example.test'),privacyVersion:contract.versions.privacyVersion}).invalidContract,true);
  assert.equal(contract.validate({...payload('old@example.test'),...contract.versions,emailPreferences:{newsletter:true,marketing:false}}).invalidContract,undefined);
});

test('combined email choice saves consent accurately, queues thank-you and preserves existing unsubscribes',async()=>{
  const db=new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    const directory=new URL('../supabase/migrations/',import.meta.url);
    for(const name of (await readdir(directory)).filter(n=>n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name,directory),'utf8'));
    const save=async data=>(await db.query('select public.submit_waitlist($1::jsonb,$2) result',[JSON.stringify(data),'c'.repeat(64)])).rows[0].result;
    const get=async email=>(await db.query('select * from private.waitlist_signups where email=$1',[email])).rows[0];
    const unchecked=payload('unchecked@example.com');
    const receipt=await save(unchecked);assert.deepEqual(await save(unchecked),receipt);
    let row=await get(unchecked.email);
    assert.equal(row.newsletter_status,'not_requested');assert.equal(row.marketing_status,'not_requested');assert.equal(row.email_verified_at,null);
    assert.equal(row.preferences_version,contract.combinedVersions.emailPreferencesVersion);
    const queued=(await db.query('select public.claim_waitlist_thank_you_emails() result')).rows[0].result;
    assert.equal(queued.length,1);assert.equal(queued[0].signupId,row.id);assert.equal(queued[0].kind,'thank_you');
    await save(payload('enabled@example.test',true));
    row=await get('enabled@example.test');
    assert.equal(row.newsletter_status,'subscribed');assert.equal(row.marketing_status,'subscribed');
    await db.query('select public.waitlist_email_action($1,$2,$3,$4)',[row.id,'unsubscribe','unsubscribe','all']);
    await save(payload(row.email,true));row=await get(row.email);
    assert.equal(row.newsletter_status,'unsubscribed');assert.equal(row.marketing_status,'unsubscribed');
    await save({...payload('old@example.test'),...contract.versions,emailPreferences:{newsletter:true,marketing:false}});
    row=await get('old@example.test');assert.equal(row.newsletter_status,'subscribed');assert.equal(row.marketing_status,'not_requested');
    await assert.rejects(save({...payload('invalid@example.test'),emailPreferences:{newsletter:true,marketing:false}}));
    await assert.rejects(save({...payload('wrong-notice@example.test'),privacyVersion:contract.versions.privacyVersion}));
  } finally {await db.close();}
});
