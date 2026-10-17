(function(){
  'use strict';
  // Fragments never reach the server. Remove the secret before any interaction.
  const fragment=new URLSearchParams(location.hash.slice(1));
  const purpose=fragment.has('confirm') ? 'confirm' : fragment.has('unsubscribe') ? 'unsubscribe' : '';
  const token=fragment.get(purpose) || '';
  history.replaceState(null,'',location.pathname);
  const status=document.getElementById('status');
  const choices=document.getElementById('choices');
  const unsubscribe=document.getElementById('unsubscribe');
  const retry=document.getElementById('retry');
  const messages={confirmation_removed:'No email confirmation is needed. Your signup is saved. Use the email-preferences link in your email if you want to unsubscribe.',expired_link:'This confirmation link has expired. Your signup is still saved. Contact us below for help.',invalid_link:'This link is invalid or no longer available. Open the complete link from your email, or contact us below.',email_stopped:'Email delivery to this address has been stopped. Contact us below for help.'};
  let busy=false;
  async function act(action){
    if(busy)return;
    busy=true;
    choices.querySelectorAll('button').forEach(b=>{b.disabled=true;});
    retry.hidden=true;
    try{
      const scope=document.querySelector('input[name="scope"]:checked')?.value || 'all';
      const response=await fetch('/api/email-preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose,token,action,scope}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(12000)});
      const data=await response.json();
      if(!response.ok){
        if(messages[data.error]){choices.hidden=true;status.textContent=messages[data.error];return;}
        throw new Error('unavailable');
      }
      if(action==='unsubscribe'){
        choices.hidden=true;document.getElementById('heading').textContent='Preferences saved';
        status.textContent='You have been unsubscribed from ' + (scope==='all' ? 'all optional emails' : scope==='newsletter' ? 'the newsletter' : 'product updates and offers') + '. Your waitlist position is unchanged.';
      }else{
        choices.hidden=false;
        document.getElementById('unsubscribe-options').hidden=false;
        const labels={not_requested:'not subscribed',pending:'awaiting processing',verified:'subscribed',subscribed:'subscribed',unsubscribed:'unsubscribed'};
        status.textContent='You can stop optional emails without leaving the waitlist.';
        document.getElementById('summary').textContent='Newsletter: ' + (labels[data.newsletterStatus] || 'unavailable') + '. Product updates: ' + (labels[data.marketingStatus] || 'unavailable') + '.';
        unsubscribe.textContent='Unsubscribe';
      }
    }catch{
      status.textContent='We could not save or check your preferences. Please try again, or contact us below.';
      retry.hidden=false;retry.onclick=()=>act(action);
    }finally{busy=false;choices.querySelectorAll('button').forEach(b=>{b.disabled=false;});}
  }
  unsubscribe.addEventListener('click',()=>act('unsubscribe'));
  if(purpose==='confirm'){status.textContent=messages.confirmation_removed;return;}
  if(!purpose || !token){status.textContent=messages.invalid_link;return;}
  act('preview');
})();
