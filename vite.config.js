import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173
  },
  build: {
    rollupOptions: {
      // Two HTML entry points, not just one. The customer app (index.html)
      // and the admin panel (admin.html) each need their own real HTML file
      // with the correct manifest/icon/title already baked in - see the
      // comment in admin.html for why this matters for iOS "Add to Home
      // Screen". vercel.json routes every /admin URL to admin.html and
      // everything else to index.html.
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html')
      }
    }
  }
})
