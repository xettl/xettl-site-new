import { rpc, emailMessage } from '../../lib/email-service.mjs';

export function createWorker(env = process.env, fetcher = fetch) {
  return async function worker() {
    if (env.XETTL_EMAIL_ENABLED !== 'true') return new Response(null,{status:204});
    if (!env.RESEND_API_KEY || (env.EMAIL_TOKEN_SECRET || '').length < 32 || !/^Xettl <updates@mail\.getxettl\.com>$/.test(env.XETTL_EMAIL_FROM || '')) return new Response(null,{status:503});
    try {
      const rows = await rpc(env,'claim_waitlist_emails',{},fetcher);
      for (const row of rows) {
        // Reserved synthetic domains must never be delivered, even if queued manually.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) || /@[^@]*\.test$/i.test(row.email)) {
          await rpc(env,'finish_waitlist_email',{p_id:row.id,p_provider_id:null,p_permanent_failure:true},fetcher);
          continue;
        }
        const sent = await fetcher('https://api.resend.com/emails',{
          method:'POST',redirect:'error',signal:AbortSignal.timeout(6000),
          headers:{Authorization:'Bearer ' + env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'waitlist-confirmation/' + row.id},
          body:JSON.stringify(emailMessage(row,env))
        });
        if (!sent.ok) {
          // Transient failures retry; uncertain sends keep the same idempotency key.
          const permanent = sent.status >= 400 && sent.status < 500 && ![401,403,408,409,429].includes(sent.status);
          await rpc(env,'finish_waitlist_email',{p_id:row.id,p_provider_id:null,p_permanent_failure:permanent},fetcher);
          return new Response(null,{status:503});
        }
        const result = await sent.json();
        if (!result.id || !await rpc(env,'finish_waitlist_email',{p_id:row.id,p_provider_id:result.id,p_permanent_failure:false},fetcher)) throw new Error('Unconfirmed delivery request');
      }
      return new Response(null,{status:204});
    } catch {
      // Do not log recipients, message bodies, tokens, credentials or provider errors.
      console.error('Waitlist email queue needs attention.');
      return new Response(null,{status:503});
    }
  };
}
export default createWorker();
export const config = { schedule:'* * * * *' };
