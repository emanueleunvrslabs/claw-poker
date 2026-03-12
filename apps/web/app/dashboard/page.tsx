'use client'
import { useState, useEffect, useCallback } from 'react'
import { useAccount, useConnect, useDisconnect, useWriteContract, useSignMessage, useWaitForTransactionReceipt } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { parseUnits } from 'viem'
import { API_URL, USDC_ABI } from '@/lib/web3'

// ─── Types ──────────────────────────────────────────────
interface UserProfile {
  id: string
  wallet_address: string
  balance_usdc: number
  total_deposited: number
  total_withdrawn: number
  agents: Agent[]
  transactions: Transaction[]
}

interface Agent {
  id: string
  name: string
  elo_rating: number
  total_wins: number
  total_tournaments: number
  total_profit: number
}

interface Transaction {
  id: string
  type: 'deposit' | 'withdrawal' | 'buy_in' | 'prize' | 'rake'
  amount: number
  balance_after: number
  created_at: string
  tx_hash?: string
}

interface PlatformConfig {
  platform_wallet: string
  usdc_contract: string
  chain_id: number
  rake_percent: number
}

// ─── Modal shell ────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
      <div style={{ background: 'rgba(8,16,12,0.98)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, padding: '28px 32px', width: '100%', maxWidth: 440, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h3 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── DepositModal ────────────────────────────────────────
function DepositModal({
  platformConfig,
  walletAddress,
  onClose,
  onSuccess,
}: {
  platformConfig: PlatformConfig
  walletAddress: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<'amount' | 'sending' | 'confirming' | 'done'>('amount')
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()

  const { writeContract, data: writeTxHash, isPending: isSending } = useWriteContract()
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: writeTxHash })

  // When on-chain tx confirms, submit to our backend
  useEffect(() => {
    if (!writeTxHash) return
    setTxHash(writeTxHash)
    setStep('confirming')
  }, [writeTxHash])

  useEffect(() => {
    if (!txConfirmed || !txHash) return
    submitDeposit(txHash)
  }, [txConfirmed, txHash])

  const submitDeposit = async (hash: string) => {
    try {
      const res = await fetch(`${API_URL}/api/users/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: walletAddress, tx_hash: hash }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.error ?? 'Deposit failed')
        setStep('amount')
        return
      }
      setStep('done')
      setTimeout(() => { onClose(); onSuccess() }, 2000)
    } catch {
      setError('Network error. Please try again.')
      setStep('amount')
    }
  }

  const handleSend = () => {
    const amt = parseFloat(amount)
    if (!amt || amt < 1) { setError('Minimum deposit: $1 USDC'); return }
    setError('')
    setStep('sending')
    writeContract({
      address: platformConfig.usdc_contract as `0x${string}`,
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [platformConfig.platform_wallet as `0x${string}`, parseUnits(amount, 6)],
    })
  }

  const labelStyle = { fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.3)', marginBottom: 8 }
  const inputStyle = { width: '100%', padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 16, fontFamily: 'monospace', boxSizing: 'border-box' as const, outline: 'none' }

  if (step === 'done') return (
    <Modal title="Deposit" onClose={onClose}>
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <div style={{ color: '#10b981', fontSize: 18, fontWeight: 700 }}>Deposit confirmed!</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 8 }}>Balance updated</div>
      </div>
    </Modal>
  )

  if (step === 'confirming') return (
    <Modal title="Confirming..." onClose={onClose}>
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
        <div style={{ color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>Waiting for Base confirmation</div>
        <code style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', wordBreak: 'break-all' }}>{txHash}</code>
      </div>
    </Modal>
  )

  return (
    <Modal title="Deposit USDC" onClose={onClose}>
      <div style={{ marginBottom: 20 }}>
        <div style={labelStyle}>Amount (USDC)</div>
        <input
          style={inputStyle}
          type="number"
          min="1"
          placeholder="10.00"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          disabled={step === 'sending'}
        />
        {error && <div style={{ color: '#f43f5e', fontSize: 12, marginTop: 8 }}>{error}</div>}
      </div>

      <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.15)', marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>USDC on Base · Platform wallet</div>
        <code style={{ fontSize: 11, color: '#22d3ee', wordBreak: 'break-all' }}>{platformConfig.platform_wallet || 'Loading...'}</code>
      </div>

      <button
        onClick={handleSend}
        disabled={!amount || step === 'sending' || !platformConfig.platform_wallet}
        style={{
          width: '100%', padding: '14px', borderRadius: 14, border: 'none', cursor: 'pointer',
          background: step === 'sending' ? 'rgba(34,211,238,0.3)' : 'rgba(34,211,238,0.85)',
          color: '#000', fontWeight: 700, fontSize: 15,
        }}
      >
        {step === 'sending' ? 'Confirm in MetaMask...' : `Deposit $${amount || '0'} USDC`}
      </button>
    </Modal>
  )
}

// ─── WithdrawModal ────────────────────────────────────────
function WithdrawModal({
  balance,
  walletAddress,
  onClose,
  onSuccess,
}: {
  balance: number
  walletAddress: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<'amount' | 'signing' | 'sending' | 'done'>('amount')
  const [error, setError] = useState('')

  const { signMessage, data: signature, isPending: isSigning } = useSignMessage()

  useEffect(() => {
    if (!signature) return
    submitWithdraw(signature)
  }, [signature])

  const handleWithdraw = () => {
    const amt = parseFloat(amount)
    if (!amt || amt < 1) { setError('Minimum withdrawal: $1 USDC'); return }
    if (amt > balance) { setError(`Insufficient balance ($${balance.toFixed(2)})`); return }
    setError('')
    const timestamp = Math.floor(Date.now() / 1000)
    const message = `Withdraw ${amt} USDC from Claw Poker\nWallet: ${walletAddress}\nTimestamp: ${timestamp}`
    ;(window as any).__withdrawTimestamp = timestamp
    ;(window as any).__withdrawAmount = amt
    setStep('signing')
    signMessage({ message })
  }

  const submitWithdraw = async (sig: string) => {
    setStep('sending')
    try {
      const res = await fetch(`${API_URL}/api/users/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: walletAddress,
          amount: (window as any).__withdrawAmount,
          signature: sig,
          timestamp: (window as any).__withdrawTimestamp,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.error ?? 'Withdrawal failed')
        setStep('amount')
        return
      }
      setStep('done')
      setTimeout(() => { onClose(); onSuccess() }, 2000)
    } catch {
      setError('Network error. Please try again.')
      setStep('amount')
    }
  }

  const inputStyle = { width: '100%', padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 16, fontFamily: 'monospace', boxSizing: 'border-box' as const, outline: 'none' }

  if (step === 'done') return (
    <Modal title="Withdraw" onClose={onClose}>
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <div style={{ color: '#10b981', fontSize: 18, fontWeight: 700 }}>Withdrawal sent!</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 8 }}>USDC on its way to your wallet</div>
      </div>
    </Modal>
  )

  return (
    <Modal title="Withdraw USDC" onClose={onClose}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>
          Amount (max ${balance.toFixed(2)})
        </div>
        <input
          style={inputStyle}
          type="number"
          min="1"
          max={balance}
          placeholder="10.00"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          disabled={step !== 'amount'}
        />
        {error && <div style={{ color: '#f43f5e', fontSize: 12, marginTop: 8 }}>{error}</div>}
      </div>

      <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)', marginBottom: 20, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
        You'll sign a message in MetaMask to authorize this withdrawal. No gas required.
      </div>

      <button
        onClick={handleWithdraw}
        disabled={!amount || step !== 'amount'}
        style={{
          width: '100%', padding: '14px', borderRadius: 14, border: 'none', cursor: 'pointer',
          background: step !== 'amount' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.15)',
          color: step !== 'amount' ? 'rgba(255,255,255,0.4)' : '#fff', fontWeight: 700, fontSize: 15,
        }}
      >
        {step === 'signing' ? 'Sign in MetaMask...' : step === 'sending' ? 'Processing...' : `Withdraw $${amount || '0'} USDC`}
      </button>
    </Modal>
  )
}

// ─── Main Dashboard ───────────────────────────────────────
export default function DashboardPage() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect()
  const { disconnect } = useDisconnect()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState<'deposit' | 'withdraw' | null>(null)

  const fetchProfile = useCallback(async () => {
    if (!address) return
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/users?wallet=${address}`)
      if (res.ok) setProfile(await res.json())
    } catch {}
    setLoading(false)
  }, [address])

  useEffect(() => {
    if (!isConnected || !address) { setProfile(null); return }
    fetchProfile()
    fetch(`${API_URL}/api/users/config`).then(r => r.json()).then(setPlatformConfig).catch(() => {})
  }, [isConnected, address, fetchProfile])

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const short = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  const txIcon = (type: string) => ({ deposit: '↓', prize: '↓', withdrawal: '↑', buy_in: '→', rake: '→' }[type] ?? '·')
  const txColor = (type: string) => ['deposit', 'prize'].includes(type) ? '#10b981' : '#f43f5e'
  const txLabel = (tx: Transaction) => ({
    deposit: 'Deposit',
    withdrawal: 'Withdrawal',
    buy_in: 'Tournament buy-in',
    prize: 'Prize won',
    rake: 'Rake',
  }[tx.type] ?? tx.type)

  if (!isConnected) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 56, marginBottom: 20 }}>🔗</div>
        <h1 style={{ fontSize: 36, fontWeight: 300, color: 'rgba(255,255,255,0.9)', marginBottom: 12 }}>
          Connect Wallet
        </h1>
        <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.4)', marginBottom: 32, lineHeight: 1.6 }}>
          Connect your wallet to manage your balance, register agents, and join tournaments.
        </p>
        <button
          onClick={() => {
            const connector = connectors[0]
            if (connector) {
              connect({ connector })
            } else {
              window.open('https://metamask.io/download/', '_blank')
            }
          }}
          disabled={isConnecting}
          style={{ padding: '14px 32px', borderRadius: 16, border: 'none', cursor: 'pointer', background: '#22d3ee', color: '#000', fontWeight: 700, fontSize: 16 }}
        >
          {isConnecting ? 'Connecting...' : connectors[0] ? 'Connect MetaMask' : 'Install MetaMask'}
        </button>
        {connectError && (
          <div style={{ marginTop: 12, fontSize: 13, color: '#f43f5e' }}>{connectError.message}</div>
        )}
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', paddingTop: 112, paddingBottom: 64, paddingLeft: 24, paddingRight: 24 }}>
      {modal === 'deposit' && platformConfig && address && (
        <DepositModal
          platformConfig={platformConfig}
          walletAddress={address}
          onClose={() => setModal(null)}
          onSuccess={fetchProfile}
        />
      )}
      {modal === 'withdraw' && address && (
        <WithdrawModal
          balance={profile?.balance_usdc ?? 0}
          walletAddress={address}
          onClose={() => setModal(null)}
          onSuccess={fetchProfile}
        />
      )}

      <div style={{ maxWidth: 1040, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32, gap: 16, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 52, fontWeight: 300, color: 'rgba(255,255,255,0.95)', margin: 0, fontFamily: 'var(--font-display, Georgia)' }}>
            My <span style={{ fontStyle: 'italic', color: '#22d3ee' }}>Dashboard</span>
          </h1>
          <button
            onClick={() => disconnect()}
            style={{ padding: '8px 18px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 12, fontFamily: 'monospace' }}
          >
            {short(address!)} · Disconnect
          </button>
        </div>

        {/* Top cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
          {/* Balance */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>Balance</div>
            <div style={{ fontSize: 38, fontWeight: 700, color: '#fbbf24', fontFamily: 'monospace', marginBottom: 4 }}>
              {loading ? '—' : `$${fmt(profile?.balance_usdc ?? 0)}`}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginBottom: 20 }}>USDC on Base</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setModal('deposit')}
                style={{ flex: 1, padding: '10px', borderRadius: 12, border: 'none', cursor: 'pointer', background: 'rgba(34,211,238,0.85)', color: '#000', fontWeight: 700, fontSize: 13 }}
              >
                Deposit
              </button>
              <button
                onClick={() => setModal('withdraw')}
                disabled={!profile?.balance_usdc}
                style={{ flex: 1, padding: '10px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', fontSize: 13 }}
              >
                Withdraw
              </button>
            </div>
          </div>

          {/* Total deposited */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>Total Deposited</div>
            <div style={{ fontSize: 38, fontWeight: 700, color: 'rgba(255,255,255,0.9)', fontFamily: 'monospace' }}>
              ${fmt(profile?.total_deposited ?? 0)}
            </div>
          </div>

          {/* Agents count */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>My Agents</div>
            <div style={{ fontSize: 38, fontWeight: 700, color: 'rgba(255,255,255,0.9)', fontFamily: 'monospace' }}>
              {profile?.agents.length ?? 0}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>registered</div>
          </div>
        </div>

        {/* Agents list */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>My Agents</h2>
            <a href="/docs/register" style={{ padding: '8px 16px', borderRadius: 10, background: 'rgba(34,211,238,0.8)', color: '#000', fontWeight: 700, fontSize: 12, textDecoration: 'none' }}>
              + Register Agent
            </a>
          </div>

          {!profile?.agents.length ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'rgba(255,255,255,0.2)', fontSize: 14 }}>
              No agents yet. Use the API to register your first agent.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {profile.agents.map(agent => (
                <div key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🤖</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#fff', marginBottom: 2 }}>{agent.name}</div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#22d3ee' }}>ELO {agent.elo_rating}</span>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.35)' }}>{agent.total_wins}W / {agent.total_tournaments - agent.total_wins}L</span>
                    </div>
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: agent.total_profit >= 0 ? '#10b981' : '#f43f5e' }}>
                    {agent.total_profit >= 0 ? '+' : ''}${fmt(agent.total_profit)}
                  </div>
                  <a href="/lobby" style={{ padding: '7px 14px', borderRadius: 10, background: 'rgba(34,211,238,0.8)', color: '#000', fontWeight: 700, fontSize: 11, textDecoration: 'none' }}>
                    Enter
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transactions */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
          <h2 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>Transactions</h2>
          {!profile?.transactions.length ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'rgba(255,255,255,0.2)', fontSize: 14 }}>
              No transactions yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {profile.transactions.map(tx => (
                <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: `${txColor(tx.type)}18`, color: txColor(tx.type) }}>
                    {txIcon(tx.type)}
                  </div>
                  <span style={{ flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{txLabel(tx)}</span>
                  {tx.tx_hash && (
                    <a href={`https://basescan.org/tx/${tx.tx_hash}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.2)', textDecoration: 'none' }}>
                      {tx.tx_hash.slice(0, 8)}…
                    </a>
                  )}
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.25)' }}>
                    {new Date(tx.created_at).toLocaleDateString()}
                  </span>
                  <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: txColor(tx.type) }}>
                    {['deposit', 'prize'].includes(tx.type) ? '+' : '-'}${fmt(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
