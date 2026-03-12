import { Router } from 'express'
import { z } from 'zod'
import { ethers } from 'ethers'
import {
  listTournaments,
  getTournamentById,
  getTournamentEntries,
  addTournamentEntry,
  removeTournamentEntry,
} from '../../db/queries/tournaments'
import { getUserByWallet, getUserById, updateBalance } from '../../db/queries/users'
import { getAgentsByOwner } from '../../db/queries/agents'
import { createTransaction } from '../../db/queries/transactions'
import { authMiddleware } from '../middleware/auth'
import { getTournamentRegistry } from '../../ws/tournamentRegistry'

export const tournamentsRouter = Router()

// GET /api/tournaments
tournamentsRouter.get('/', async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined
    const type = req.query.type as string | undefined
    const is_free = req.query.is_free !== undefined ? req.query.is_free === 'true' : undefined

    const tournaments = await listTournaments({
      status: status as Parameters<typeof listTournaments>[0]['status'],
      type: type as Parameters<typeof listTournaments>[0]['type'],
      is_free,
      limit: 50,
    })
    res.json(tournaments)
  } catch (err) {
    next(err)
  }
})

// GET /api/tournaments/:id
tournamentsRouter.get('/:id', async (req, res, next) => {
  try {
    const tournament = await getTournamentById(req.params.id)
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' })
      return
    }
    const entries = await getTournamentEntries(req.params.id)
    res.json({ ...tournament, entries })
  } catch (err) {
    next(err)
  }
})

// POST /api/tournaments/:id/join
tournamentsRouter.post('/:id/join', authMiddleware, async (req, res, next) => {
  try {
    const tournament = await getTournamentById(req.params.id)
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' })
      return
    }
    if (tournament.status !== 'registering') {
      res.status(400).json({ error: 'Tournament is not open for registration' })
      return
    }
    if (tournament.current_players >= tournament.max_players) {
      res.status(400).json({ error: 'Tournament is full' })
      return
    }

    const agent = req.agent!

    // Deduct buy-in from user balance (unless free tournament)
    if (!tournament.is_free && tournament.buy_in > 0) {
      const user = await getUserById(agent.owner_id)
      if (!user) {
        res.status(404).json({ error: 'User account not found' })
        return
      }
      if (user.balance_usdc < tournament.buy_in) {
        res.status(402).json({ error: `Insufficient balance. Need $${tournament.buy_in} USDC, have $${user.balance_usdc}` })
        return
      }
      const rake = Number((tournament.buy_in * tournament.rake_percent / 100).toFixed(6))
      const prize = Number((tournament.buy_in - rake).toFixed(6))

      const newBalance = await updateBalance(agent.owner_id, -tournament.buy_in, 'buy_in')
      await createTransaction({
        user_id: agent.owner_id,
        type: 'buy_in',
        amount: tournament.buy_in,
        balance_after: newBalance,
        tournament_id: tournament.id,
        status: 'confirmed',
      })
      // Add net amount to prize pool
      await import('../../db/client').then(({ db }) =>
        db.from('tournaments').update({ prize_pool: tournament.prize_pool + prize }).eq('id', tournament.id)
      )
    }

    const entry = await addTournamentEntry({
      tournament_id: tournament.id,
      agent_id: agent.id,
      user_id: agent.owner_id,
      buy_in_paid: tournament.buy_in,
      registered_by: 'agent',
    })

    // If tournament is now full, auto-start
    const updatedTournament = await getTournamentById(tournament.id)
    if (updatedTournament && updatedTournament.current_players >= updatedTournament.min_players) {
      // Trigger tournament start via registry
      const registry = getTournamentRegistry()
      if (registry) {
        registry.tryStartTournament(tournament.id).catch(console.error)
      }
    }

    res.status(201).json({ message: 'Joined tournament', entry })
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('unique')) {
      res.status(409).json({ error: 'Already registered in this tournament' })
      return
    }
    next(err)
  }
})

// POST /api/tournaments/:id/join-as-owner
// Authenticates via wallet signature — the human joins on behalf of their bot
tournamentsRouter.post('/:id/join-as-owner', async (req, res, next) => {
  try {
    const body = z.object({
      wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
      signature: z.string(),
      timestamp: z.number().int(),
    }).parse(req.body)

    // Verify timestamp (5 min window)
    const age = Math.floor(Date.now() / 1000) - body.timestamp
    if (age < 0 || age > 300) {
      res.status(400).json({ error: 'Signature expired. Please try again.' })
      return
    }

    // Verify signature
    const message = `Join tournament ${req.params.id}\nWallet: ${body.wallet_address}\nTimestamp: ${body.timestamp}`
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

    const tournament = await getTournamentById(req.params.id)
    if (!tournament) { res.status(404).json({ error: 'Tournament not found' }); return }
    if (tournament.status !== 'registering') { res.status(400).json({ error: 'Tournament is not open for registration' }); return }
    if (tournament.current_players >= tournament.max_players) { res.status(400).json({ error: 'Tournament is full' }); return }

    const user = await getUserByWallet(body.wallet_address.toLowerCase())
    if (!user) { res.status(404).json({ error: 'User not found. Please connect your wallet first.' }); return }

    const agents = await getAgentsByOwner(user.id)
    if (!agents.length) { res.status(404).json({ error: 'No registered agent found for this wallet. Register a bot first.' }); return }
    const agent = agents[0]

    // Deduct buy-in if paid tournament
    if (!tournament.is_free && tournament.buy_in > 0) {
      if (user.balance_usdc < tournament.buy_in) {
        res.status(402).json({ error: `Insufficient balance. Need $${tournament.buy_in} USDC, have $${user.balance_usdc.toFixed(2)}` })
        return
      }
      const rake = Number((tournament.buy_in * tournament.rake_percent / 100).toFixed(6))
      const prize = Number((tournament.buy_in - rake).toFixed(6))
      const newBalance = await updateBalance(user.id, -tournament.buy_in, 'buy_in')
      await createTransaction({
        user_id: user.id,
        type: 'buy_in',
        amount: tournament.buy_in,
        balance_after: newBalance,
        tournament_id: tournament.id,
        status: 'confirmed',
      })
      const { db } = await import('../../db/client')
      await db.from('tournaments').update({ prize_pool: tournament.prize_pool + prize }).eq('id', tournament.id)
    }

    const entry = await addTournamentEntry({
      tournament_id: tournament.id,
      agent_id: agent.id,
      user_id: user.id,
      buy_in_paid: tournament.buy_in,
      registered_by: 'human',
    })

    const updatedTournament = await getTournamentById(tournament.id)
    if (updatedTournament && updatedTournament.current_players >= updatedTournament.min_players) {
      const registry = getTournamentRegistry()
      if (registry) registry.tryStartTournament(tournament.id).catch(console.error)
    }

    res.status(201).json({ message: 'Joined tournament', entry, agent_name: agent.name })
  } catch (err: unknown) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.flatten().fieldErrors }); return }
    if (err instanceof Error && err.message.includes('unique')) { res.status(409).json({ error: 'Already registered in this tournament' }); return }
    next(err)
  }
})

// POST /api/tournaments/:id/leave
tournamentsRouter.post('/:id/leave', authMiddleware, async (req, res, next) => {
  try {
    const tournament = await getTournamentById(req.params.id)
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' })
      return
    }
    if (tournament.status !== 'registering') {
      res.status(400).json({ error: 'Cannot leave a running tournament' })
      return
    }

    await removeTournamentEntry(tournament.id, req.agent!.id)
    res.json({ message: 'Left tournament' })
  } catch (err) {
    next(err)
  }
})
