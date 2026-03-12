import { Router } from 'express'
import { z } from 'zod'
import { ethers } from 'ethers'
import { config } from '../../config'
import { upsertUser, getUserByWallet, updateBalance } from '../../db/queries/users'
import { createTransaction, getUserTransactions } from '../../db/queries/transactions'
import { getAgentsByOwner } from '../../db/queries/agents'
import { db } from '../../db/client'

export const usersRouter = Router()

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

// GET /api/users?wallet=0x...
usersRouter.get('/', async (req, res, next) => {
  try {
    const wallet = z.string().regex(/^0x[a-fA-F0-9]{40}$/).parse(req.query.wallet)
    const user = await upsertUser(wallet)
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

// GET /api/config — public platform info for frontend
usersRouter.get('/config', (_req, res) => {
  res.json({
    platform_wallet: getPlatformWallet(),
    usdc_contract: config.USDC_CONTRACT_BASE,
    chain_id: 8453, // Base mainnet
    rake_percent: 10,
  })
})

// POST /api/users/deposit
// Body: { wallet_address, tx_hash }
// Verifies USDC Transfer on Base, credits balance
usersRouter.post('/deposit', async (req, res, next) => {
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

// POST /api/users/withdraw
// Body: { wallet_address, amount, signature, timestamp }
// signature = sign("Withdraw {amount} USDC from Claw Poker\nWallet: {wallet}\nTimestamp: {ts}")
usersRouter.post('/withdraw', async (req, res, next) => {
  try {
    const body = z.object({
      wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      amount: z.number().positive().min(1),
      signature: z.string(),
      timestamp: z.number().int(),
    }).parse(req.body)

    // Verify timestamp within 5 minutes
    const age = Math.floor(Date.now() / 1000) - body.timestamp
    if (age < 0 || age > 300) {
      res.status(400).json({ error: 'Signature expired. Please sign again.' })
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

    // Send USDC on-chain from platform wallet
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
    const txReceipt = await tx.wait()

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
