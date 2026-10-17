import { json, limitedBody, rpc, verifyEmailToken } from '../../lib/email-service.mjs';

export function createPreferencesHandler(env = process.env, fetcher = fetch) {
  return async function handler(request) {
    if (request.method !== 'POST') return json(405,{error:'method_not_allowed'});
    const origins=(env.XETTL_ALLOWED_ORIGINS || '').split(',').map(s=>s.trim());
    if (!origins.includes(request.headers.get('origin'))) return json(403,{error:'origin_not_allowed'});
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return json(415,{error:'json_required'});
    if ((env.EMAIL_TOKEN_SECRET || '').length < 32) return json(503,{error:'unavailable'});
    let data;
    try { data=JSON.parse(await limitedBody(request)); } catch { return json(400,{error:'invalid_request'}); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || !['preview','confirm','unsubscribe'].includes(data.action) || !['confirm','unsubscribe'].includes(data.purpose) || (data.scope !== undefined && !['all','newsletter','marketing'].includes(data.scope))) return json(400,{error:'invalid_request'});
    const id=verifyEmailToken(data.token,data.purpose,env.EMAIL_TOKEN_SECRET);
    if (!id || (data.action==='confirm' && data.purpose!=='confirm')) return json(400,{error:'invalid_link'});
    try {
      const result=await rpc(env,'waitlist_email_action',{p_id:id,p_purpose:data.purpose,p_action:data.action,p_scope:data.scope || 'all'},fetcher);
      return json(result?.error ? 400 : 200,result);
    } catch { return json(503,{error:'unavailable'}); }
  };
}
export default createPreferencesHandler();
export const config={path:'/api/email-preferences',rateLimit:{windowLimit:30,windowSize:60,aggregateBy:['ip','domain']}};
