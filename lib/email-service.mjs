import { createHmac, timingSafeEqual } from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function signEmailToken(id, purpose, secret) {
  if (!uuid.test(id) || !['confirm','unsubscribe'].includes(purpose) || (secret || '').length < 32) throw new Error('Email token unavailable');
  return id + '.' + createHmac('sha256', secret).update('xettl-email-v1:' + purpose + ':' + id).digest('base64url');
}
export function verifyEmailToken(token, purpose, secret) {
  if (typeof token !== 'string' || token.length > 100) return null;
  const [id, signature, extra] = token.split('.');
  if (!uuid.test(id || '') || !/^[A-Za-z0-9_-]{43}$/.test(signature || '') || extra !== undefined) return null;
  try {
    const expected = signEmailToken(id, purpose, secret).split('.')[1];
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? id : null;
  } catch { return null; }
}
export async function rpc(env, name, args, fetcher = fetch) {
  const base = new URL(env.SUPABASE_URL);
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !key) throw new Error('Database unavailable');
  const headers = { apikey: key, 'Content-Type':'application/json' };
  if (!key.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + key;
  const result = await fetcher(new URL('/rest/v1/rpc/' + name,base), {
    method:'POST', headers, body:JSON.stringify(args), redirect:'error', signal:AbortSignal.timeout(4000)
  });
  if (!result.ok) throw new Error('Database unavailable');
  return result.json();
}
export function json(status, body) {
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
export async function limitedBody(request, limit = 4096) {
  const reader = request.body?.getReader();
  if (!reader || Number(request.headers.get('content-length')) > limit) throw new Error('Invalid body');
  let size = 0; const chunks = [];
  while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('Invalid body'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function emailMessage(row, env) {
  const root = 'https://getxettl.com/email-preferences/';
  const confirm = root + '#confirm=' + signEmailToken(row.id,'confirm',env.EMAIL_TOKEN_SECRET);
  const unsubscribe = root + '#unsubscribe=' + signEmailToken(row.signupId,'unsubscribe',env.EMAIL_TOKEN_SECRET);
  const categories = [row.newsletter && 'the Xettl newsletter',row.marketing && 'product news, launch announcements and offers'].filter(Boolean);
  const choice = categories.length ? 'You requested ' + categories.join(' and ') + '. Confirm below to activate only those choices. Until then, they remain pending.' : 'You did not request our newsletter or product-marketing emails. Confirming your address will not subscribe you to either.';
  const text = 'Your Xettl waitlist signup is saved.\n\n' + choice + '\n\nConfirm your email address:\n' + confirm + '\n\nThe confirmation link expires 48 hours after signup. Joining the waitlist is not a bank account application or a promise of availability.\n\nIf you did not sign up, ignore this message or stop optional emails:\n' + unsubscribe + '\n\nQuestions? Reply to this email. To leave the waitlist or request deletion, contact privacy@getxettl.com.\n\nXettl, Inc.\n101 North First Avenue, Suite 2325 1335\nPhoenix, AZ 85003, United States';
  // Only fixed copy and validated signed URLs enter HTML; no form answers are forwarded.
  const html = '<!doctype html><html lang="en"><body style="margin:0;background:#f5f6fa;color:#182234;font:16px/1.6 Arial,sans-serif"><main style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border-radius:16px"><p style="font-weight:700;font-size:24px">Xettl</p><h1 style="font-size:26px">Your signup is saved.</h1><p>' + choice + '</p><p style="margin:28px 0"><a style="display:inline-block;background:#2856e8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none" href="' + confirm + '">Confirm email address</a></p><p>The confirmation link expires 48 hours after signup.</p><p>Joining the waitlist is not a bank account application or a promise of availability.</p><p>If you did not sign up, ignore this message or <a href="' + unsubscribe + '">stop optional emails</a>.</p><p>Questions? Reply to this email. To leave the waitlist or request deletion, contact privacy@getxettl.com.</p><hr style="border:0;border-top:1px solid #ddd"><p style="font-size:12px">Xettl, Inc.<br>101 North First Avenue, Suite 2325 1335<br>Phoenix, AZ 85003, United States</p></main></body></html>';
  return {from:env.XETTL_EMAIL_FROM,to:[row.email],reply_to:env.XETTL_EMAIL_REPLY_TO || 'privacy@getxettl.com',subject:'Confirm your Xettl email address',html,text,
    tags:[{name:'purpose',value:'waitlist_confirmation'}]};
}
