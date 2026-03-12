import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  SUPABASE_URL: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
  JWT_SECRET: z.string(),
  PLATFORM_WALLET_PRIVATE_KEY: z.string().optional(),
  PLATFORM_WALLET_ADDRESS: z.string().optional(),
  USDC_CONTRACT_BASE: z.string().default('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
  BASE_RPC_URL: z.string().default('https://mainnet.base.org'),
})

function loadEnv() {
  // Load .env manually if not in production
  if (process.env.NODE_ENV !== 'production') {
    try {
      const fs = require('fs')
      const path = require('path')
      const envPath = path.resolve(process.cwd(), '../../.env')
      if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf8').split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const eq = trimmed.indexOf('=')
          if (eq === -1) continue
          const key = trimmed.slice(0, eq).trim()
          const val = trimmed.slice(eq + 1).trim()
          if (!process.env[key]) process.env[key] = val
        }
      }
    } catch {}
  }

  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors)
    process.exit(1)
  }
  return result.data
}

export const config = loadEnv()
