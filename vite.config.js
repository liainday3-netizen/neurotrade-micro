import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/neurotrade-micro/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})
