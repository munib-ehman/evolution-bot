import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Mirror Vercel's `cleanUrls` locally: production serves /pricing for
 * pricing.html (and /app for app.html), so internal links are extensionless.
 * This rewrites those URLs to their .html files in `vite dev` and
 * `vite preview` so the site navigates the same way everywhere.
 */
function cleanUrls(): Plugin {
  const rewrite =
    (dirs: string[]) =>
    (req: { url?: string }, _res: unknown, next: () => void) => {
      const [pathname, query] = (req.url ?? "").split("?");
      if (/^\/[\w-]+$/.test(pathname)) {
        const file = `${pathname.slice(1)}.html`;
        if (dirs.some((dir) => fs.existsSync(path.join(dir, file)))) {
          req.url = `/${file}${query ? `?${query}` : ""}`;
        }
      }
      next();
    };
  return {
    name: "clean-urls",
    configureServer(server) {
      server.middlewares.use(rewrite([root, path.join(root, "public")]));
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite([path.join(root, "dist")]));
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built static site works on GitHub Pages project subpaths
  // (e.g. https://user.github.io/shop-avatar/) as well as Netlify / Cloudflare root.
  base: "./",
  plugins: [react(), cleanUrls()],
  build: {
    rollupOptions: {
      // Two HTML entries: the public marketing site at / and the
      // login-gated operator app at /app.
      input: {
        index: path.join(root, "index.html"),
        app: path.join(root, "app.html"),
      },
    },
  },
  optimizeDeps: {
    // These packages ship WASM/ONNX assets and their own workers; letting Vite
    // pre-bundle them tends to break the onnxruntime-web loader. Excluding them
    // makes the dev server serve them as-is (same behaviour as the production build).
    exclude: ["@huggingface/transformers", "kokoro-js"],
  },
  worker: { format: "es" },
});
