import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = appDirectory

export default defineConfig(({ mode }) => {
  const repositoryEnv = loadEnv(mode, repositoryDirectory, '')
  const supabaseUrl = process.env.SUPABASE_URL || repositoryEnv.SUPABASE_URL || ''
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    repositoryEnv.SUPABASE_PUBLISHABLE_KEY ||
    repositoryEnv.SUPABASE_ANON_KEY ||
    ''
  const allowedRedirectOrigins =
    process.env.AUTH_ALLOWED_REDIRECT_ORIGINS ||
    repositoryEnv.AUTH_ALLOWED_REDIRECT_ORIGINS ||
    'http://127.0.0.1:5173,http://localhost:5173'
  const apiUrl =
    process.env.AIBIBU_API_URL ||
    repositoryEnv.AIBIBU_API_URL ||
    'http://127.0.0.1:12350'

  return {
    plugins: [react()],
    define: {
      __SUPABASE_URL__: JSON.stringify(supabaseUrl),
      __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(publishableKey),
      __AUTH_ALLOWED_REDIRECT_ORIGINS__: JSON.stringify(allowedRedirectOrigins),
    },
    server: {
      proxy: {
        '/v1/auth': { target: apiUrl },
        '/v1/payments': { target: apiUrl },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test-setup.ts',
    },
  }
})
