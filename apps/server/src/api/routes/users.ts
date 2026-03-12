import { Router } from 'express'
import { z } from 'zod'
import { ethers } from 'ethers'
import { createHash } from 'crypto'
import { config } from '../../config'
import { upsertUser, getUserByWallet, updateBalance } from '../../db/queries/users'
import { createTransaction, getUserTransactions } from '../../db/queries/transactions'
import { getAgentsByOwner } from '../../db/queries/agents'
import { db } from '../../db/client'
import { rateLimit } from '../middleware/rateLimit'

export const usersRouter = Router()

const MAX_WITHDRAW_USDC = 10_000

// ── Signature replay protection ───────────────────────────────────────────────
const usedSignatures = new Map<string, number>()

function consumeSignature(sig: string): boolean {
  const key = createHash('sha256').update(sig).digest('hex')
  const now = Date.now()
  for (const [k, exp] of usedSignatures) {
    if (exp < now) usedSignatures.delete(k)
  }
  if (usedSignatures.has(key)) return false
  usedSignatures.set(key, now + 5 * 60 * 1000)
  return true
}
// ─────────────────────────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL)

const USDC_IFACE = new ethers.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

function getPlatformWallet(): string {
  if (config.PLATFORM_WALLET_ADDRESS) return config.PLATFORM_WALLET_ADDRESS
  if (config.PLATFORM_WALLET_PRIVATE_KEY) {
    return new ethers.Wallet(config.PLATFORM_WALLET_PRIVATE_KEY).address
  }
  return ''
}

// GET /api/users?wallet=0x...  — read-only, no auto-create
usersRouter.get('/', async (req, res, next) => {
  try {
    const wallet = z.string().regex(/^0x[a-fA-F0-9]{40}$/).parse(req.query.wallet)
    const user = await getUserByWallet(wallet)
    if (!user) {
      res.json({ balance_usdc: 0, total_deposited: 0, total_withdrawn: 0, agents: [], transactions: [] })
      return
    }
    const agents = await getAgentsByOwner(user.id)
    const transactions = await getUserTransactions(user.id, 20)
    res.json({ ...user, agents, transactions })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid wallet address' })
      return
    }
    next(err)
  }
})

// PATCH /api/users/display-name — set display name (signature-authenticated)
usersRouter.patch('/display-name', rateLimit(10), async (req, res, next) => {
  try {
    const body = z.object({
      wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
      display_name: z.string().min(1).max(32).trim(),
      signature: z.string(),
      timestamp: z.number().int(),
    }).parse(req.body)

    const age = Math.floor(Date.now() / 1000) - body.timestamp
    if (age < 0 || age > 300) {
      res.status(400).json({ error: 'Signature expired' }); return
    }
    if (!consumeSignature(body.signature)) {
      res.status(400).json({ error: 'Signature already used' }); return
    }

    const message = `Set display name: ${body.display_name}\nWallet: ${body.wallet_address}\nTimestamp: ${body.timestamp}`
    const recovered = ethers.verifyMessage(message, body.signature)
    if (recovered.toLowerCase() !== body.wallet_address.toLowerCase()) {
      res.status(401).json({ error: 'Invalid signature' }); return
    }

    const { error } = await db.from('users')
      .update({ display_name: body.display_name })
      .eq('wallet_address', body.wallet_address.toLowerCase())
    if (error) throw error

    res.json({ display_name: body.display_name })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.flatten().fieldErrors }); return }
    next(err)
  }
})

// GET /api/config — public platform info for frontend
usersRouter.get('/config', (_req, res) => {
  res.json({
    platform_wallet: getPlatformWallet(),
    usdc_contract: config.USDC_CONTRACT_BASE,
    chain_id: 8453, // Base mainnet
    rake_percent: 10,
  })
})

// POST /api/users/deposit — 5/min per IP
usersRouter.post('/deposit', rateLimit(5), async (req, res, next) => {
  try {
    const body = z.object({
      wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    }).parse(req.body)

    const platformWallet = getPlatformWallet()
    if (!platformWallet) {
      res.status(503).json({ error: 'Deposits temporarily unavailable' })
      return
    }

    const user = await upsertUser(body.wallet_address)

    // Check tx_hash not already processed
    const { data: existing } = await db
      .from('transactions')
      .select('id')
      .eq('tx_hash', body.tx_hash)
      .maybeSingle()

    if (existing) {
      res.status(409).json({ error: 'Transaction already processed' })
      return
    }

    // Fetch receipt from Base
    const receipt = await provider.getTransactionReceipt(body.tx_hash)
    if (!receipt) {
      res.status(400).json({ error: 'Transaction not found. Wait for on-chain confirmation.' })
      return
    }
    if (receipt.status !== 1) {
      res.status(400).json({ error: 'Transaction failed on-chain' })
      return
    }

    // Parse USDC Transfer events: from=user, to=platform
    let amount = 0n
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== config.USDC_CONTRACT_BASE.toLowerCase()) continue
      if (log.topics[0] !== TRANSFER_TOPIC) continue
      try {
        const parsed = USDC_IFACE.parseLog({ topics: [...log.topics], data: log.data })
        if (
          parsed &&
          parsed.args.to.toLowerCase() === platformWallet.toLowerCase() &&
          parsed.args.from.toLowerCase() === body.wallet_address.toLowerCase()
        ) {
          amount += BigInt(parsed.args.value)
        }
      } catch {}
    }

    if (amount === 0n) {
      res.status(400).json({ error: 'No USDC transfer to platform found in this transaction' })
      return
    }

    const amountUsdc = Number(amount) / 1_000_000 // USDC = 6 decimals

    const newBalance = await updateBalance(user.id, amountUsdc, 'deposit')
    await createTransaction({
      user_id: user.id,
      type: 'deposit',
      amount: amountUsdc,
      balance_after: newBalance,
      tx_hash: body.tx_hash,
      status: 'confirmed',
    })
    await db
      .from('users')
      .update({ total_deposited: (user.total_deposited ?? 0) + amountUsdc })
      .eq('id', user.id)

    res.json({ success: true, amount: amountUsdc, balance: newBalance })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.flatten().fieldErrors })
      return
    }
    next(err)
  }
})

// POST /api/users/withdraw — 3/min per IP, max $10k per tx
usersRouter.post('/withdraw', rateLimit(3), async (req, res, next) => {
  try {
    const body = z.object({
      wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      amount: z.number().positive().min(1).max(MAX_WITHDRAW_USDC),
      signature: z.string(),
      timestamp: z.number().int(),
    }).parse(req.body)

    // Verify timestamp within 5 minutes
    const age = Math.floor(Date.now() / 1000) - body.timestamp
    if (age < 0 || age > 300) {
      res.status(400).json({ error: 'Signature expired. Please sign again.' })
      return
    }

    // Replay protection — each signature can only be used once
    if (!consumeSignature(body.signature)) {
      res.status(400).json({ error: 'Signature already used. Please sign a new withdrawal request.' })
      return
    }

    // Verify wallet signature
    const message = `Withdraw ${body.amount} USDC from Claw Poker\nWallet: ${body.wallet_address}\nTimestamp: ${body.timestamp}`
    let recovered: string
    try {
      recovered = ethers.verifyMessage(message, body.signature)
    } catch {
      res.status(400).json({ error: 'Invalid signature' })
      return
    }
    if (recovered.toLowerCase() !== body.wallet_address.toLowerCase()) {
      res.status(401).json({ error: 'Signature does not match wallet' })
      return
    }

    const user = await getUserByWallet(body.wallet_address)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    if (user.balance_usdc < body.amount) {
      res.status(400).json({ error: 'Insufficient balance' })
      return
    }
    if (!config.PLATFORM_WALLET_PRIVATE_KEY) {
      res.status(503).json({ error: 'Withdrawals temporarily unavailable' })
      return
    }

    // Deduct first (prevent double-spend)
    const newBalance = await updateBalance(user.id, -body.amount, 'withdrawal')

    // Send USDC on-chain from platform wallet — rollback balance if tx fails
    let txReceipt: { hash: string; status: number } | null = null
    try {
      const signer = new ethers.Wallet(config.PLATFORM_WALLET_PRIVATE_KEY, provider)
      const usdc = new ethers.Contract(
        config.USDC_CONTRACT_BASE,
        ['function transfer(address to, uint256 amount) returns (bool)'],
        signer
      )
      const tx = await (usdc.transfer as Function)(
        body.wallet_address,
        BigInt(Math.floor(body.amount * 1_000_000))
      )
      txReceipt = await tx.wait()
      if (!txReceipt || txReceipt.status !== 1) {
        throw new Error('On-chain transfer failed')
      }
    } catch (txErr) {
      // Restore balance — user keeps their funds
      await updateBalance(user.id, body.amount, 'prize').catch(() => {})
      throw new Error(`Withdrawal failed: on-chain transfer error. Funds restored. (${(txErr as Error).message})`)
    }

    await createTransaction({
      user_id: user.id,
      type: 'withdrawal',
      amount: body.amount,
      balance_after: newBalance,
      tx_hash: txReceipt.hash,
      status: 'confirmed',
    })
    await db
      .from('users')
      .update({ total_withdrawn: (user.total_withdrawn ?? 0) + body.amount })
      .eq('id', user.id)

    res.json({ success: true, tx_hash: txReceipt.hash, balance: newBalance })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.flatten().fieldErrors })
      return
    }
    next(err)
  }
})
