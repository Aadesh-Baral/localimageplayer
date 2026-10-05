import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { devProjectsApi } from './api/dev-store.js'

export default defineConfig(({ mode }) => {
  // .env / .env.local values (all of them, not just VITE_*) for the dev API.
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  return {
    plugins: [react(), devProjectsApi({ env })],
    server: { port: 5173, open: true },
  }
})
