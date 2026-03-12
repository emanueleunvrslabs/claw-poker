import { db } from '../client'

export interface UserRow {
  id: string
  wallet_address: string
  display_name: string | null
  balance_usdc: number
  total_deposited: number
  total_withdrawn: number
  created_at: string
}

export async function upsertUser(walletAddress: string): Promise<UserRow> {
  const { data, error } = await db
    .from('users')
    .upsert({ wallet_address: walletAddress.toLowerCase() }, { onConflict: 'wallet_address' })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getUserByWallet(walletAddress: string): Promise<UserRow | null> {
  const { data, error } = await db
    .from('users')
    .select('*')
    .eq('wallet_address', walletAddress.toLowerCase())
    .single()

  if (error) return null
  return data
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const { data, error } = await db.from('users').select('*').eq('id', id).single()
  if (error) return null
  return data
}

export async function updateBalance(
  userId: string,
  delta: number,
  type: 'deposit' | 'withdrawal' | 'buy_in' | 'prize'
): Promise<number> {
  // Use RPC for atomic balance update
  const { data, error } = await db.rpc('update_user_balance', {
    p_user_id: userId,
    p_delta: delta,
  })

  if (error) throw new Error(`Balance update failed: ${error.message}`)
  return data
}
