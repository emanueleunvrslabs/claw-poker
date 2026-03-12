import { db } from '../client'
import type { TournamentStatus, TournamentType } from '@claw-poker/shared'

export interface TournamentRow {
  id: string
  name: string
  type: TournamentType
  buy_in: number
  rake_percent: number
  prize_pool: number
  max_players: number
  min_players: number
  current_players: number
  status: TournamentStatus
  blind_structure: unknown
  prize_structure: unknown
  starting_chips: number
  is_free: boolean
  scheduled_at: string | null
  started_at: string | null
  finished_at: string | null
  winner_id: string | null
  results: unknown
  created_at: string
}

export async function listTournaments(filters: {
  status?: TournamentStatus
  type?: TournamentType
  is_free?: boolean
  limit?: number
}): Promise<TournamentRow[]> {
  let query = db.from('tournaments').select('*')

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.type) query = query.eq('type', filters.type)
  if (filters.is_free !== undefined) query = query.eq('is_free', filters.is_free)

  query = query.order('created_at', { ascending: false }).limit(filters.limit ?? 50)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function getTournamentById(id: string): Promise<TournamentRow | null> {
  const { data, error } = await db.from('tournaments').select('*').eq('id', id).single()
  if (error) return null
  return data
}

export async function createTournament(t: Omit<TournamentRow, 'id' | 'created_at' | 'current_players' | 'prize_pool' | 'status' | 'started_at' | 'finished_at' | 'winner_id' | 'results'>): Promise<TournamentRow> {
  const { data, error } = await db.from('tournaments').insert(t).select().single()
  if (error) throw error
  return data
}

export async function updateTournamentStatus(
  id: string,
  status: TournamentStatus,
  extra?: Partial<TournamentRow>
): Promise<void> {
  const { error } = await db
    .from('tournaments')
    .update({ status, ...extra })
    .eq('id', id)
  if (error) throw error
}

export async function getTournamentEntries(tournamentId: string) {
  const { data, error } = await db
    .from('tournament_entries')
    .select('*, agents(name, elo_rating, agent_type), users(display_name, wallet_address)')
    .eq('tournament_id', tournamentId)

  if (error) throw error
  return data ?? []
}

export async function addTournamentEntry(entry: {
  tournament_id: string
  agent_id: string
  user_id: string
  buy_in_paid: number
  registered_by: 'human' | 'agent'
}) {
  const { data, error } = await db
    .from('tournament_entries')
    .insert(entry)
    .select()
    .single()
  if (error) throw error

  // Sync current_players from actual entry count
  await syncTournamentPlayerCount(entry.tournament_id)

  return data
}

export async function removeTournamentEntry(tournamentId: string, agentId: string): Promise<void> {
  const { error } = await db
    .from('tournament_entries')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('agent_id', agentId)
  if (error) throw error

  await syncTournamentPlayerCount(tournamentId)
}

export async function syncTournamentPlayerCount(tournamentId: string): Promise<void> {
  const { count } = await db
    .from('tournament_entries')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
  await db.from('tournaments').update({ current_players: count ?? 0 }).eq('id', tournamentId)
}
