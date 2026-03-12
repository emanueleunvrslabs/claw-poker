import { db } from '../client'
import type { TransactionType } from '@claw-poker/shared'

export async function createTransaction(t: {
  user_id: string
  type: TransactionType
  amount: number
  balance_after: number
  tournament_id?: string
  tx_hash?: string
  status?: 'pending' | 'confirmed' | 'failed'
}) {
  const { data, error } = await db
    .from('transactions')
    .insert({ ...t, status: t.status ?? 'confirmed' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getUserTransactions(userId: string, limit = 50) {
  const { data, error } = await db
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export async function updateTransactionStatus(
  id: string,
  status: 'confirmed' | 'failed',
  txHash?: string
): Promise<void> {
  const { error } = await db
    .from('transactions')
    .update({ status, tx_hash: txHash })
    .eq('id', id)
  if (error) throw error
}
