import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
    proxy: {
      '/turso': {
        target: 'https://libsql-server-custom.fly.dev',
        changeOrigin: true,
        secure: false,
        headers: {
          'Origin': 'https://libsql-server-custom.fly.dev',
        },
        rewrite: (path) => path.replace(/^\/turso/, ''),
      },
    },
  },
  optimizeDeps: {
    exclude: ["@tursodatabase/sync-wasm"],
  },
})
