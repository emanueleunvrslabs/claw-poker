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
  _type: 'deposit' | 'withdrawal' | 'buy_in' | 'prize'
): Promise<number> {
  // Read current balance, then write new value (Supabase JS doesn't support atomic increment natively)
  const { data: user, error: readError } = await db
    .from('users')
    .select('balance_usdc')
    .eq('id', userId)
    .single()

  if (readError || !user) throw new Error(`User not found: ${readError?.message}`)

  const newBalance = Number((user.balance_usdc + delta).toFixed(6))
  if (newBalance < 0) throw new Error('Insufficient balance')

  const { error: writeError } = await db
    .from('users')
    .update({ balance_usdc: newBalance })
    .eq('id', userId)

  if (writeError) throw new Error(`Balance update failed: ${writeError.message}`)
  return newBalance
}
