import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: "public/manifest.json",
          dest: ".",
        },
      ],
    }),
    nodePolyfills({
      include: ["buffer", "crypto", "stream", "util"],
      globals: {
        Buffer: true,
        process: true,
        global: true,
      },
    }),
  ],
  resolve: {
    alias: {
      // warthog-js TransactionContext uses node crypto.createHash
      crypto: "crypto-browserify",
    },
  },
  optimizeDeps: {
    include: [
      "warthog-ts",
      "warthog-js",
      "buffer",
      "elliptic",
      "crypto-browserify",
    ],
  },
  build: {
    outDir: "build",
    rollupOptions: {
      input: {
        main: "./index.html",
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
