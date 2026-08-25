/** Makes public-page account actions reflect the current Supabase session. */
import { supabase } from "./lib/auth";

const accountLink = document.querySelector<HTMLAnchorElement>("#account-link");

function renderAccount(signedIn: boolean) {
  if (!accountLink) return;
  accountLink.textContent = signedIn ? "Dashboard" : "Sign in";
  accountLink.href = "/app";
}

if (supabase) {
  void supabase.auth.getSession().then(({ data }) => renderAccount(Boolean(data.session)));
  supabase.auth.onAuthStateChange((_event, session) => renderAccount(Boolean(session)));
} else {
  renderAccount(false);
}
