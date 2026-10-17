import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {Webhook} from 'svix';
import {signEmailToken,verifyEmailToken,emailMessage} from '../lib/email-service.mjs';
import {createWorker} from '../netlify/functions/email-worker.mjs';
import {createPreferencesHandler} from '../netlify/functions/email-preferences.mjs';
import {createWebhookHandler} from '../netlify/functions/resend-webhook.mjs';
import contract from '../lib/waitlist-contract.cjs';

const secret='email-test-only-'.repeat(4);
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',EMAIL_TOKEN_SECRET:secret,
  XETTL_ALLOWED_ORIGINS:'https://getxettl.com',XETTL_EMAIL_ENABLED:'true',XETTL_EMAIL_FROM:'Xettl <updates@mail.getxettl.com>',RESEND_API_KEY:'re_test'};
const row={id:crypto.randomUUID(),signupId:crypto.randomUUID(),email:'owner@example.com',newsletter:true,marketing:false};

test('signed email links cannot be forged or switched between confirmation and unsubscribe',()=>{
  const token=signEmailToken(row.id,'confirm',secret);
  assert.equal(verifyEmailToken(token,'confirm',secret),row.id);
  assert.equal(verifyEmailToken(token,'unsubscribe',secret),null);
  assert.equal(verifyEmailToken(token,'confirm','different-secret'.repeat(4)),null);
  assert.equal(verifyEmailToken(token.slice(0,-2)+'xx','confirm',secret),null);
  assert.equal(verifyEmailToken(token+'.extra','confirm',secret),null);
  const message=emailMessage(row,env);
  assert.ok(!message.html.includes('#confirm=') && !message.text.includes('Confirm your email'));
  assert.match(message.html,/Thank you for signing up to the waitlist!/);
  assert.equal(message.attachments[0].content_id,'xettl-logo');
  assert.match(message.html,/cid:xettl-logo/);
  assert.match(message.text,/#unsubscribe=/);
  assert.ok(!message.html.includes('product news, launch announcements and offers'));
  assert.equal(message.reply_to,'privacy@getxettl.com');
});

test('worker uses stable send keys, marks saved sends, and leaves transient failures retryable',async()=>{
  const calls=[]; const provider=crypto.randomUUID();
  const transport=async(url,options)=>{
    calls.push({url:String(url),...options});
    if(String(url).endsWith('/claim_waitlist_thank_you_emails'))return Response.json([row]);
    if(String(url)==='https://api.resend.com/emails')return Response.json({id:provider});
    return Response.json(true);
  };
  assert.equal((await createWorker(env,transport)()).status,204);
  assert.equal(calls[1].headers['Idempotency-Key'],'waitlist-thank-you/'+row.id);
  assert.deepEqual(JSON.parse(calls[2].body),{p_id:row.id,p_provider_id:provider,p_permanent_failure:false});
  calls.length=0;
  assert.equal((await createWorker(env,async(url,options)=>String(url)==='https://api.resend.com/emails' ? new Response('',{status:429}) : transport(url,options))()).status,503);
  assert.equal(JSON.parse(calls.at(-1).body).p_permanent_failure,false);
  assert.equal((await createWorker({...env,XETTL_EMAIL_ENABLED:'false'},()=>{throw Error('must not send');})()).status,204);
});

test('preference endpoint rejects GET, forged tokens, cross-origin and oversized input without database access',async()=>{
  const handler=createPreferencesHandler(env,()=>{throw Error('must not call');});
  const request=(data,origin='https://getxettl.com')=>new Request('https://getxettl.com/api/email-preferences',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)});
  assert.equal((await handler(new Request('https://getxettl.com/api/email-preferences'))).status,405);
  const input={purpose:'unsubscribe',action:'unsubscribe',token:signEmailToken(row.signupId,'unsubscribe',secret)};
  assert.equal((await handler(request(input,'https://evil.example'))).status,403);
  assert.equal((await handler(request({...input,token:'forged'}))).status,400);
  assert.equal((await handler(request(null))).status,400);
  assert.equal((await handler(request({...input,padding:'x'.repeat(5000)}))).status,400);
  const preview=createPreferencesHandler(env,async(url,options)=>{
    assert.equal(JSON.parse(options.body).p_action,'preview');
    return Response.json({newsletter:true,marketing:false});
  });
  assert.equal((await preview(request({...input,action:'preview'}))).status,200);
});

test('webhooks verify raw-body signature and reject tampering or replay outside time tolerance',async()=>{
  const whSecret='whsec_'+Buffer.from('webhook-test-secret-32-characters!').toString('base64');
  const wh=new Webhook(whSecret); const id='msg_test'; const date=new Date();
  const body=JSON.stringify({type:'email.complained',data:{email_id:crypto.randomUUID()}});
  let stored;
  const handler=createWebhookHandler({...env,RESEND_WEBHOOK_SECRET:whSecret},async(url,options)=>{stored=JSON.parse(options.body);return Response.json(true);});
  const req=(payload=body,at=date)=>new Request('https://getxettl.com/api/resend-webhook',{method:'POST',headers:{'svix-id':id,'svix-timestamp':String(Math.floor(at.getTime()/1000)),'svix-signature':wh.sign(id,at,body)},body:payload});
  assert.equal((await handler(req())).status,200);
  assert.equal(stored.p_kind,'email.complained');
  assert.equal((await handler(req(body+' '))).status,400);
  assert.equal((await handler(req(body,new Date(Date.now()-600000)))).status,400);
});

test('single opt-in subscribes selected categories without claiming ownership; thank-you and unsubscribe preserve suppression',async()=>{
  const db=new PGlite();
  try{
    await db.exec('create role anon; create role authenticated; create role service_role;');
    const directory=new URL('../supabase/migrations/',import.meta.url);
    for(const name of (await readdir(directory)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,directory),'utf8'));
    const save=async(email,preferences={newsletter:true,marketing:false},privacy=contract.versions.privacyVersion)=>{
      const data={version:4,requestId:crypto.randomUUID(),fullName:'Email test',email,countryFrom:'',featureWish:'A useful account.',adultConfirmed:true,termsAccepted:true,privacyAcknowledged:true,emailPreferences:preferences,...contract.versions,privacyVersion:privacy};
      return db.query('select public.submit_waitlist($1::jsonb,$2) result',[JSON.stringify(data),'a'.repeat(64)]);
    };
    await save('synthetic@example.test');
    await save('legacy@example.com',{newsletter:true,marketing:false},'2026-10-17-dual-analytics');
    assert.equal((await db.query('select count(*) from private.waitlist_email_outbox')).rows[0].count,0);
    await save('owner@example.com');
    await save('owner@example.com',{newsletter:true,marketing:true});
    assert.equal((await db.query('select public.claim_waitlist_emails() result')).rows[0].result.length,0,'old worker cannot send confirmations');
    const claim=async()=>(await db.query('select public.claim_waitlist_thank_you_emails() result')).rows[0].result;
    const queue=await claim(); assert.equal(queue.length,1); assert.equal(queue[0].kind,'thank_you');
    const current=queue[0]; const providerId=crypto.randomUUID();
    let profile=(await db.query('select * from private.waitlist_signups where id=$1',[current.signupId])).rows[0];
    assert.equal(profile.newsletter_status,'subscribed'); assert.equal(profile.marketing_status,'not_requested');
    assert.equal(profile.email_verified_at,null,'form choice must not be labelled as verified ownership');
    await db.query('select public.finish_waitlist_email($1,$2,false)',[current.id,providerId]);
    const action=async(act,purpose='unsubscribe',scope='all',id=current.signupId)=>(await db.query('select public.waitlist_email_action($1,$2,$3,$4) result',[id,purpose,act,scope])).rows[0].result;
    await action('preview');
    assert.equal((await action('confirm','confirm','all',current.id)).error,'confirmation_removed');
    await action('unsubscribe','unsubscribe','newsletter');
    await save('owner@example.com',{newsletter:true,marketing:true});
    profile=(await db.query('select * from private.waitlist_signups where id=$1',[current.signupId])).rows[0];
    assert.equal(profile.newsletter_status,'unsubscribed');assert.equal(profile.marketing_status,'not_requested');
    assert.equal((await db.query('select count(*) from private.waitlist_email_outbox')).rows[0].count,1);
    await db.query('select public.record_waitlist_email_event($1,$2,$3)',['msg_bounce',providerId,'email.bounced']);
    assert.ok((await db.query('select email_suppressed_at from private.waitlist_signups where id=$1',[current.signupId])).rows[0].email_suppressed_at);
    await db.query('select public.record_waitlist_email_event($1,$2,$3)',['msg_delivered',providerId,'email.delivered']);
    assert.equal((await db.query('select delivery_status from private.waitlist_email_outbox where id=$1',[current.id])).rows[0].delivery_status,'bounced');
    await save('uncertain@example.com'); const uncertain=(await claim())[0];
    await db.query("update private.waitlist_email_outbox set first_attempt_at=now()-interval '21 hours',lease_until=now()-interval '3 minutes' where id=$1",[uncertain.id]);
    assert.equal((await claim()).length,0);
    for(const role of ['anon','authenticated']){
      await db.exec('set role '+role);
      await assert.rejects(db.query('select public.claim_waitlist_thank_you_emails()'));
      await assert.rejects(db.query('select * from private.waitlist_email_outbox'));
      await assert.rejects(action('preview')); await db.exec('reset role');
    }
  }finally{await db.close();}
});
