import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built static site works on GitHub Pages project subpaths
  // (e.g. https://user.github.io/shop-avatar/) as well as Netlify / Cloudflare root.
  base: "./",
  plugins: [react()],
  optimizeDeps: {
    // These packages ship WASM/ONNX assets and their own workers; letting Vite
    // pre-bundle them tends to break the onnxruntime-web loader. Excluding them
    // makes the dev server serve them as-is (same behaviour as the production build).
    exclude: ["@huggingface/transformers", "kokoro-js"],
  },
  worker: { format: "es" },
});
