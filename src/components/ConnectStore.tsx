/** Required Shopify OAuth onboarding for paid accounts without a store. */
import { ShopifyConnect } from "./ShopifyConnect";
import { signOut } from "../lib/auth";

export function ConnectStore() {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Connect your Shopify store">
      <div className="overlay-card card">
        <h2>Connect your Shopify store</h2>
        <p className="overlay-lede">Enter your Shopify store address to continue.</p>
        <ShopifyConnect storeUrl={null} />
        <p className="overlay-fineprint">
          Find it in Shopify under Settings → Domains. Not ready?{" "}
          <button type="button" className="link" onClick={() => void signOut()}>
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}
