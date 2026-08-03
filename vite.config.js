import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base = nome do repositório, para publicação no GitHub Pages
export default defineConfig({
  base: process.env.VITE_BASE || '/aprovacao-de-arte/',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1200 },
})
