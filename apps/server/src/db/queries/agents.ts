import { db } from '../client'
import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'

export interface AgentRow {
  id: string
  name: string
  api_key_hash: string
  owner_id: string
  agent_type: string
  total_tournaments: number
  total_wins: number
  total_profit: number
  elo_rating: number
  hands_played: number
  vpip: number
  pfr: number
  aggression_factor: number
  is_active: boolean
  created_at: string
}

export async function createAgent(data: {
  name: string
  owner_id: string
  agent_type?: string
}): Promise<{ agent: AgentRow; api_key: string }> {
  const api_key = `cp_${nanoid(32)}`
  const api_key_hash = await bcrypt.hash(api_key, 10)

  const { data: agent, error } = await db
    .from('agents')
    .insert({ name: data.name, owner_id: data.owner_id, agent_type: data.agent_type ?? 'openclaw', api_key_hash })
    .select()
    .single()

  if (error) throw error
  return { agent, api_key }
}

export async function getAgentById(id: string): Promise<AgentRow | null> {
  const { data, error } = await db.from('agents').select('*').eq('id', id).single()
  if (error) return null
  return data
}

export async function getAgentByName(name: string): Promise<AgentRow | null> {
  const { data, error } = await db.from('agents').select('*').eq('name', name).single()
  if (error) return null
  return data
}

export async function verifyApiKey(apiKey: string): Promise<AgentRow | null> {
  // Extract agent name prefix or scan active agents
  // API keys are cp_<nanoid> — we need to find by hash
  // For perf, we store a fast lookup prefix in a separate index
  // Simple approach: try all active agents (small dataset)
  const { data: agents, error } = await db
    .from('agents')
    .select('*')
    .eq('is_active', true)
    .limit(1000)

  if (error || !agents) return null

  for (const agent of agents) {
    const match = await bcrypt.compare(apiKey, agent.api_key_hash)
    if (match) return agent
  }
  return null
}

export async function updateAgentStats(
  agentId: string,
  stats: Partial<Pick<AgentRow, 'total_tournaments' | 'total_wins' | 'total_profit' | 'elo_rating' | 'hands_played' | 'vpip' | 'pfr' | 'aggression_factor'>>
): Promise<void> {
  const { error } = await db.from('agents').update(stats).eq('id', agentId)
  if (error) throw error
}

export async function getAgentsByOwner(ownerId: string): Promise<AgentRow[]> {
  const { data, error } = await db
    .from('agents')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  if (error) return []
  return data ?? []
}

export async function getLeaderboard(limit = 50): Promise<AgentRow[]> {
  const { data, error } = await db
    .from('agents')
    .select('*')
    .eq('is_active', true)
    .order('elo_rating', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}
