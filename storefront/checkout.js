const form = document.getElementById('checkout');
const button = form.querySelector('button');
const status = document.getElementById('payment-status');
const unavailable = 'Checkout is currently unavailable. Please try again later.';

async function checkAvailability() {
  try {
    const response = await fetch('/public/status', { cache: 'no-store' });
    const data = await response.json();
    button.disabled = !response.ok || data.checkout_ready !== true;
    status.textContent = button.disabled ? unavailable : '';
  } catch {
    status.textContent = unavailable;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  status.textContent = 'Opening secure payment…';
  try {
    const response = await fetch('/signup/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: form.elements.phone.value, consent: form.elements.consent.checked }),
    });
    if (!response.ok) throw new Error(unavailable);
    const result = await response.json();
    const target = new URL(result.url);
    if (target.origin !== 'https://checkout.stripe.com' || target.username || target.password) {
      throw new Error('Unable to open secure payment.');
    }
    location.assign(target.href);
  } catch {
    status.textContent = unavailable;
    button.disabled = false;
  }
});

checkAvailability();
