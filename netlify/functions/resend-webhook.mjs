import { Webhook } from 'svix';
import { json, limitedBody, rpc } from '../../lib/email-service.mjs';

const supported=new Set(['email.sent','email.delivered','email.delivery_delayed','email.failed','email.bounced','email.complained','email.suppressed']);
export function createWebhookHandler(env = process.env, fetcher = fetch) {
  return async function handler(request) {
    if (request.method !== 'POST') return json(405,{error:'method_not_allowed'});
    if (!env.RESEND_WEBHOOK_SECRET) return json(503,{error:'unavailable'});
    let event;
    const id=request.headers.get('svix-id');
    try {
      const body=await limitedBody(request,65536);
      new Webhook(env.RESEND_WEBHOOK_SECRET).verify(body,{
        'svix-id':id,'svix-timestamp':request.headers.get('svix-timestamp'),'svix-signature':request.headers.get('svix-signature')
      });
      event=JSON.parse(body);
    } catch { return json(400,{error:'invalid_webhook'}); }
    if (!event || typeof event !== 'object') return json(400,{error:'invalid_webhook'});
    if (!supported.has(event.type)) return json(200,{received:true});
    if (!/^[0-9a-f-]{36}$/i.test(event.data?.email_id || '') || !id || id.length > 200) return json(400,{error:'invalid_webhook'});
    try {
      const saved=await rpc(env,'record_waitlist_email_event',{p_event_id:id,p_provider_id:event.data.email_id,p_kind:event.type},fetcher);
      return json(saved ? 200 : 503,{received:saved === true});
    } catch { return json(503,{error:'unavailable'}); }
  };
}
export default createWebhookHandler();
export const config={path:'/api/resend-webhook'};
