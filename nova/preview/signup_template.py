"""One signup screen. Business onboarding continues in the WhatsApp conversation."""


def page(path):
    if path == '/signup/complete':
        content = '<h1>Thanks. We’re checking your payment.</h1><p>Once we verify payment, look for a WhatsApp message from Nova. Reply there to start setup.</p><p>Have one current package, a past quote with personal details removed, and the person who can authorize your business inbox ready.</p>'
    elif path == '/signup/cancel':
        content = '<h1>Checkout cancelled</h1><p>You can return when ready.</p><a href="/signup">Back to Nova</a>'
    else:
        content = '''<a class="label" href="/">NOVA BY EVOLUTION</a><h1>Your business.<br>Handled on WhatsApp.</h1>
<p>Tell Nova what to handle. It follows up with customers and reports back in the same chat.</p>
<h2>$200/month</h2>
<form id="signup"><label for="phone">Your WhatsApp number</label><input id="phone" name="phone" type="tel" autocomplete="tel" placeholder="+1 555 555 0101" required maxlength="24">
<label class="consent"><input id="consent" type="checkbox" required>I control this number and agree to receive Nova’s WhatsApp service messages.</label>
<button type="submit" disabled>Continue to payment</button><p id="status" role="status">Checking availability…</p></form>
<p class="fine">Monthly subscription. Usage allowance agreed before activation. No extra usage charges without approval.</p>
<section aria-labelledby="journey"><h2 id="journey">What happens after payment</h2>
<ol class="journey">
<li><strong>Open Nova’s WhatsApp welcome.</strong> Reply by text or voice note with the first task you want handled.</li>
<li><strong>Share how you work.</strong> Send current packages or FAQs and a past quote. Choose what Nova can share with customers.</li>
<li><strong>Connect your business inbox.</strong> Authorize it through Meta. Evolution links it, and you check the connection in chat.</li>
<li><strong>Set the rules.</strong> Choose when Nova can reply on its own and what your team should review. Test a sample before activation.</li>
<li><strong>Run and review the work.</strong> Set a follow-up delay. Ask for a report or pause work in the same chat.</li>
</ol></section>
<script>
const form=document.getElementById('signup'),button=form.querySelector('button'),status=document.getElementById('status');
let ready=false;
async function availability(){
 try {const response=await fetch('/public/status');const data=await response.json();ready=response.ok && data.checkout_ready===true;button.disabled=!ready;status.textContent=data.message || 'Setup is in progress.';}
 catch(error){status.textContent='Setup is in progress. Please try again later.';button.disabled=true;}
}
form.addEventListener('submit', async event => {
 event.preventDefault();if(!ready)return;
 button.disabled=true;status.textContent='Opening secure payment…';
 try {
  const response=await fetch('/signup/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:document.getElementById('phone').value,consent:document.getElementById('consent').checked})});
  const result=await response.json();if(!response.ok)throw new Error(result.error || 'Payment is unavailable. Please try later.');
  const target=new URL(result.url);if(target.protocol!=='https:' || target.hostname!=='checkout.stripe.com')throw new Error('Payment could not be verified.');
  location.assign(target.href);
 }catch(error){status.textContent=error.message;button.disabled=false;}
});availability();
</script>''' 
    return '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Nova by Evolution</title>
<style>*{box-sizing:border-box}body{margin:0;background:#111116;color:#f3f1f5;font:17px system-ui,sans-serif;line-height:1.6}main{max-width:600px;padding:48px 24px;margin:auto}h1{font-size:clamp(32px,7vw,48px);line-height:1.15}p{color:#c5c1cd}.fine{font-size:12px}h2{margin:26px 0 0}.label{text-decoration:none}.label{color:#ffaa7b;font-size:12px;letter-spacing:2px}form{display:grid;gap:16px;margin:32px 0}input[type=tel]{width:100%;padding:16px;background:#202029;border:1px solid #55515f;border-radius:10px;color:inherit;font:inherit}.consent{font-size:14px;display:flex;gap:10px;align-items:start}.consent input{margin-top:6px}button{padding:16px;border:0;border-radius:10px;background:linear-gradient(100deg,#ffc83d,#ff5470);color:#21140d;font:600 16px system-ui;cursor:pointer}button:disabled{opacity:.6}.journey{padding-left:1.4rem;color:#c5c1cd}.journey li{padding-left:.4rem;margin-bottom:1rem}.journey strong{color:#f3f1f5}a{color:#ffaa7b}</style></head><body><main>''' + content + '</main></body></html>'
