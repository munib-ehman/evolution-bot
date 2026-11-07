"""One signup screen. Business onboarding continues in the WhatsApp conversation."""


def page(path):
    if path == '/signup/complete':
        content = '<h1>Thanks. We’re checking your payment.</h1><p>Nova will welcome you on WhatsApp after payment is verified. If verification is still pending, the welcome will wait for confirmation.</p>'
    elif path == '/signup/cancel':
        content = '<h1>Checkout cancelled</h1><p>You can return when ready.</p><a href="/signup">Back to Nova</a>'
    else:
        content = '''<p class="label">NOVA BY EVOLUTION</p><h1>Your business operator.<br>On WhatsApp.</h1>
<p>Tell Nova about your business. Choose the first workflow, approve a trial, and get updates where you already work.</p>
<h2>$200/month</h2><p>Includes a defined usage allowance. Extra usage requires your approval.</p>
<form id="signup"><label for="phone">Your WhatsApp number</label><input id="phone" name="phone" type="tel" autocomplete="tel" placeholder="+1 555 555 0101" required maxlength="24">
<label class="consent"><input id="consent" type="checkbox" required>I agree to receive Nova’s WhatsApp onboarding and service messages at this number. I confirm that I control it.</label>
<button type="submit">Continue to secure checkout</button><p id="status" role="status"></p></form>
<p>After payment, Nova asks about your work, helps connect supported tools and prepares a sample for approval. You control which actions it can perform.</p>
<script>
document.getElementById('signup').addEventListener('submit', async event => {
 event.preventDefault(); const button = event.target.querySelector('button'); const status = document.getElementById('status');
 button.disabled = true; status.textContent = 'Opening checkout…';
 try {
  const response = await fetch('/signup/checkout', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:document.getElementById('phone').value,consent:document.getElementById('consent').checked})});
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Checkout is unavailable. Please try later.');
  const target = new URL(result.url); if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com') throw new Error('Checkout could not be verified.');
  location.assign(target.href);
 } catch (error) {status.textContent = error.message; button.disabled = false;}
});
</script>'''
    return '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Nova by Evolution</title>
<style>*{box-sizing:border-box}body{margin:0;background:#111116;color:#f3f1f5;font:17px system-ui,sans-serif;line-height:1.6}main{max-width:600px;padding:48px 24px;margin:auto}h1{font-size:clamp(32px,7vw,48px);line-height:1.15}p{color:#c5c1cd}.label{color:#ffaa7b;font-size:12px;letter-spacing:2px}form{display:grid;gap:16px;margin:32px 0}input[type=tel]{width:100%;padding:16px;background:#202029;border:1px solid #55515f;border-radius:10px;color:inherit;font:inherit}.consent{font-size:14px;display:flex;gap:10px;align-items:start}.consent input{margin-top:6px}button{padding:16px;border:0;border-radius:10px;background:linear-gradient(100deg,#ffc83d,#ff5470);color:#21140d;font:600 16px system-ui;cursor:pointer}button:disabled{opacity:.6}a{color:#ffaa7b}</style></head><body><main>''' + content + '</main></body></html>'
