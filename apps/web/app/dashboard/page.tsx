'use client'
import { useState, useEffect, useCallback } from 'react'
import { useMetaMask } from '@/lib/useMetaMask'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3010'

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
  const [txHash, setTxHash] = useState<string | undefined>()

  const submitDeposit = async (hash: string) => {
    // Retry up to 10 times with 4s delay — Base RPC may lag behind MetaMask
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await fetch(`${API_URL}/api/users/deposit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet_address: walletAddress, tx_hash: hash }),
        })
        if (res.ok) {
          setStep('done')
          setTimeout(() => { onClose(); onSuccess() }, 2000)
          return
        }
        const err = await res.json()
        // If tx not found yet on server RPC, wait and retry
        if (res.status === 400 && (err.error ?? '').includes('not found')) {
          await new Promise(r => setTimeout(r, 4000))
          continue
        }
        // Already processed = success for UX purposes
        if (res.status === 409) {
          setStep('done')
          setTimeout(() => { onClose(); onSuccess() }, 2000)
          return
        }
        setError(err.error ?? 'Deposit failed')
        setStep('amount')
        return
      } catch {
        setError('Network error. Please try again.')
        setStep('amount')
        return
      }
    }
    setError('Server could not verify tx. Contact support with tx hash.')
    setStep('amount')
  }

  const waitForReceipt = async (eth: any, hash: string): Promise<void> => {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000))
      const receipt = await eth.request({ method: 'eth_getTransactionReceipt', params: [hash] })
      if (receipt?.status === '0x1') return
      if (receipt && receipt.status !== '0x1') throw new Error('Transaction failed on-chain')
    }
    throw new Error('Transaction not confirmed after 3 minutes')
  }

  const handleSend = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt < 1) { setError('Minimum deposit: $1 USDC'); return }
    const eth = (window as any).ethereum
    if (!eth) { setError('MetaMask not found'); return }
    setError('')
    setStep('sending')

    // Switch to Base mainnet (chain 8453 = 0x2105)
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] })
    } catch (switchErr: any) {
      // Chain not added yet — add it
      if (switchErr.code === 4902) {
        try {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0x2105',
              chainName: 'Base',
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://mainnet.base.org'],
              blockExplorerUrls: ['https://basescan.org'],
            }],
          })
        } catch {
          setError('Could not switch to Base network. Please switch manually in MetaMask.')
          setStep('amount')
          return
        }
      } else if (switchErr.code !== 4001) {
        // Ignore non-user-rejection errors (some wallets don't support wallet_switchEthereumChain)
      } else {
        setError('Please switch to Base network in MetaMask.')
        setStep('amount')
        return
      }
    }

    // Encode ERC20 transfer(address,uint256) — selector 0xa9059cbb
    const amountHex = BigInt(Math.round(amt * 1_000_000)).toString(16).padStart(64, '0')
    const toHex = platformConfig.platform_wallet.replace(/^0x/i, '').toLowerCase().padStart(64, '0')
    const data = `0xa9059cbb${toHex}${amountHex}`

    try {
      const hash: string = await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from: walletAddress, to: platformConfig.usdc_contract, data }],
      })
      setTxHash(hash)
      setStep('confirming')
      await waitForReceipt(eth, hash)
      await submitDeposit(hash)
    } catch (e: any) {
      setError(e.code === 4001 ? 'Transaction rejected' : (e.message ?? 'Transaction failed'))
      setStep('amount')
    }
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

      <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(230,57,70,0.05)', border: '1px solid rgba(230,57,70,0.15)', marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>USDC on Base · Platform wallet</div>
        <code style={{ fontSize: 11, color: '#e63946', wordBreak: 'break-all' }}>{platformConfig.platform_wallet || 'Loading...'}</code>
      </div>

      <button
        onClick={handleSend}
        disabled={!amount || step === 'sending' || !platformConfig.platform_wallet}
        style={{
          width: '100%', padding: '14px', borderRadius: 14, border: 'none', cursor: 'pointer',
          background: step === 'sending' ? 'rgba(230,57,70,0.3)' : 'rgba(230,57,70,0.85)',
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

  const handleWithdraw = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt < 1) { setError('Minimum withdrawal: $1 USDC'); return }
    if (amt > balance) { setError(`Insufficient balance ($${balance.toFixed(2)})`); return }
    const eth = (window as any).ethereum
    if (!eth) { setError('MetaMask not found'); return }
    setError('')

    const timestamp = Math.floor(Date.now() / 1000)
    const message = `Withdraw ${amt} USDC from Claw Poker\nWallet: ${walletAddress}\nTimestamp: ${timestamp}`
    setStep('signing')

    let signature: string
    try {
      signature = await eth.request({ method: 'personal_sign', params: [message, walletAddress] })
    } catch (e: any) {
      setError(e.code === 4001 ? 'Signature rejected' : 'Sign failed')
      setStep('amount')
      return
    }

    setStep('sending')
    try {
      const res = await fetch(`${API_URL}/api/users/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: walletAddress, amount: amt, signature, timestamp }),
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
  const { address, isConnected, connectWallet: connect } = useMetaMask()

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
          onClick={connect}
          style={{ padding: '14px 32px', borderRadius: 16, border: 'none', cursor: 'pointer', background: '#e63946', color: '#000', fontWeight: 700, fontSize: 16 }}
        >
          Connect MetaMask
        </button>
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
        <div style={{ marginBottom: 32 }}>
          <h1 className="font-display text-3xl font-bold" style={{ color: 'rgba(255,255,255,0.95)', margin: 0, marginBottom: 6 }}>
            My <span style={{ color: '#e63946' }}>Dashboard</span>
          </h1>
        </div>

        {/* Top cards */}
        <div className="dashboard-top-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
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
                style={{ flex: 1, padding: '10px', borderRadius: 12, border: 'none', cursor: 'pointer', background: 'rgba(230,57,70,0.85)', color: '#000', fontWeight: 700, fontSize: 13 }}
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
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>My Agents</h2>
          </div>

          {!profile?.agents.length ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'rgba(255,255,255,0.2)', fontSize: 14 }}>
              No agents yet. Use the API to register your first agent.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {profile.agents.map(agent => (
                <div key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(230,57,70,0.08)', border: '1px solid rgba(230,57,70,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🤖</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#fff', marginBottom: 2 }}>{agent.name}</div>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#e63946' }}>ELO {agent.elo_rating}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: agent.total_profit >= 0 ? '#10b981' : '#f43f5e' }}>
                      {agent.total_profit >= 0 ? '+' : ''}${fmt(agent.total_profit)}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>profit</div>
                  </div>
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
