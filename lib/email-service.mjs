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
  const unsubscribe = 'https://getxettl.com/email-preferences/#unsubscribe=' + signEmailToken(row.signupId,'unsubscribe',env.EMAIL_TOKEN_SECRET);
  const text = "Thank you for signing up to the waitlist!\n\nWe are excited to have you onboard and look forward to designing the banking experience you deserve.\n\nThe Xettl team\nBank before you board.\n\nQuestions? Reply to this email.\nManage your email preferences or unsubscribe:\n" + unsubscribe + "\n\nXettl, Inc.\n101 North First Avenue, Suite 2325 1335\nPhoenix, AZ 85003, United States";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank you for joining Xettl</title></head>
<body style="margin:0;padding:0;background-color:#f3f2ee;color:#152539">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">We're excited to have you onboard. Thank you for joining the Xettl waitlist.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f2ee"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #e3e4df;border-radius:18px;overflow:hidden">
<tr><td height="6" bgcolor="#2856e8" style="height:6px;background-color:#2856e8;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:38px 36px 34px"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td width="38" style="width:38px;vertical-align:middle"><img src="cid:xettl-logo" width="30" height="31" alt="" style="display:block;border:0;width:30px;height:31px"></td><td style="font-family:Helvetica,Arial,sans-serif;font-size:27px;line-height:32px;letter-spacing:-1px;font-weight:700;color:#152539">Xettl</td></tr></table></td></tr>
<tr><td style="padding:0 36px 40px"><p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:18px;font-weight:700;letter-spacing:2px;color:#2856e8">YOU'RE ON THE LIST</p>
<h1 style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:44px;font-weight:400;letter-spacing:-1px;color:#152539">Thank you for signing up to the waitlist!</h1>
<p style="margin:0 0 28px;font-family:Helvetica,Arial,sans-serif;font-size:17px;line-height:28px;color:#536073">We are excited to have you onboard and look forward to designing the banking experience you deserve.</p>
<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#152539">The Xettl team</p></td></tr>
<tr><td style="padding:22px 36px;background-color:#edf2ff;border-top:1px solid #e2e9fc;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#2856e8">Bank before you board.</td></tr>
</table>
<table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px"><tr><td style="padding:24px 20px 0;text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:20px;color:#6b7480">
<p style="margin:0 0 10px">Questions? Just reply to this email.</p>
<p style="margin:0 0 12px"><a href="${unsubscribe}" style="color:#536073;text-decoration:underline">Email preferences &amp; unsubscribe</a></p>
<p style="margin:0">Xettl, Inc.<br>101 North First Avenue, Suite 2325 1335<br>Phoenix, AZ 85003, United States</p>
</td></tr></table>
</td></tr></table></body></html>`;
  return {from:env.XETTL_EMAIL_FROM,to:[row.email],reply_to:env.XETTL_EMAIL_REPLY_TO || 'privacy@getxettl.com',subject:'Thank you for joining the Xettl waitlist!',html,text,
    attachments:[{path:'https://getxettl.com/assets/images/brand/mark-blue-64.png',filename:'xettl-logo.png',content_id:'xettl-logo'}],
    tags:[{name:'purpose',value:'waitlist_thank_you'}]};
}
