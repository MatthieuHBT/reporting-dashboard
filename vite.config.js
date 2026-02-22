import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3005,
    strictPort: true,
    // Proxy /api vers le serveur du dashboard (port 3001) pour avoir toutes les routes SaaS (workspace/members, etc.)
    // Si tu utilises reporting-api sur 3003, définis VITE_API_URL=http://localhost:3003/api dans .env
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
