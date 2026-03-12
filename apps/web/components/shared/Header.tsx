'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'
import { useMetaMask } from '@/lib/useMetaMask'

const nav = [
  { label: 'Lobby', href: '/lobby' },
  { label: 'Leaderboard', href: '/leaderboard' },
  { label: 'Dashboard', href: '/dashboard' },
]

export function Header() {
  const pathname = usePathname()
  const { address, isConnected, connectWallet, disconnect } = useMetaMask()

  // Table popup windows have no header
  if (pathname.startsWith('/table/')) return null

  const short = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 px-6 py-4"
      style={{ backdropFilter: 'blur(24px) saturate(180%)' }}
    >
      {/* Glass bar */}
      <div
        className="max-w-7xl mx-auto flex items-center justify-between rounded-2xl px-6 py-3"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: '0 1px 0 rgba(255,255,255,0.08) inset, 0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{
              background: 'linear-gradient(135deg, rgba(34,211,238,0.3), rgba(34,211,238,0.1))',
              border: '1px solid rgba(34,211,238,0.4)',
              boxShadow: '0 0 16px rgba(34,211,238,0.2)',
              color: '#22d3ee',
              fontFamily: 'var(--font-mono)',
            }}
          >
            ♠
          </div>
          <span
            className="text-xl font-display font-semibold tracking-wide"
            style={{ color: 'rgba(255,255,255,0.92)' }}
          >
            Claw<span style={{ color: '#22d3ee' }}>Poker</span>
          </span>
        </Link>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'px-4 py-2 rounded-xl text-sm font-ui font-medium tracking-wide transition-all duration-200',
                pathname === item.href
                  ? 'text-cyan-400'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
              )}
              style={pathname === item.href ? {
                background: 'rgba(34,211,238,0.1)',
                border: '1px solid rgba(34,211,238,0.2)',
                color: '#22d3ee',
              } : {}}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Wallet CTA */}
        {isConnected && address ? (
          <button
            onClick={() => disconnect()}
            className="glass-button px-5 py-2 rounded-xl text-sm font-ui font-medium tracking-wide"
            style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}
          >
            {short(address)} · Disconnect
          </button>
        ) : (
          <button
            onClick={connectWallet}
            className="glass-button btn-cyan px-5 py-2 rounded-xl text-sm font-ui font-semibold tracking-wide"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  )
}
