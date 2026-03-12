'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'
import { useMetaMask } from '@/lib/useMetaMask'

const navLinks = [
  { label: 'Home', href: '/' },
  { label: 'Get Started', href: '/get-started' },
  { label: 'Poker', href: '/poker' },
  { label: 'Sport', href: '/sport' },
  { label: 'Leaderboard', href: '/leaderboard' },
  { label: 'Dashboard', href: '/dashboard' },
]

export function Header() {
  const pathname = usePathname()
  const { address, isConnected, connectWallet, disconnect } = useMetaMask()
  const [mobileOpen, setMobileOpen] = useState(false)

  if (pathname.startsWith('/table/')) return null

  const short = (addr: string) => `${addr.slice(0, 5)}…${addr.slice(-3)}`

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 flex justify-center px-4 pt-5">
        <div
          className="flex items-center justify-between gap-1 px-3 py-2 w-full max-w-5xl"
          style={{
            background: 'rgba(10,10,14,0.82)',
            backdropFilter: 'blur(24px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 999,
            boxShadow: '0 0 0 1px rgba(255,255,255,0.04) inset, 0 8px 40px rgba(0,0,0,0.5)',
          }}
        >
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 pl-1 flex-shrink-0" onClick={() => setMobileOpen(false)}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>🦑</span>
            <span className="text-sm font-display font-semibold tracking-wide whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.9)' }}>
              Squid<span style={{ color: '#e63946' }}>Casino</span>
            </span>
          </Link>

          {/* Nav — centered, desktop only */}
          <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {navLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'px-3 py-1.5 rounded-full text-sm font-ui font-medium tracking-wide transition-all duration-200 whitespace-nowrap',
                  pathname === item.href ? '' : 'text-white/45 hover:text-white/75 hover:bg-white/5'
                )}
                style={pathname === item.href ? {
                  background: 'rgba(230,57,70,0.12)',
                  border: '1px solid rgba(230,57,70,0.22)',
                  color: '#e63946',
                } : {}}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right: wallet + hamburger */}
          <div className="flex items-center gap-2 flex-shrink-0 pr-1">
            {isConnected && address ? (
              <button
                onClick={() => disconnect()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-ui font-medium tracking-wide transition-all duration-200 whitespace-nowrap"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(255,255,255,0.55)',
                  cursor: 'pointer',
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#10b981' }} />
                <span className="font-mono">{short(address)}</span>
                <span className="hidden sm:inline" style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
                <span className="hidden sm:inline">Disconnect</span>
              </button>
            ) : (
              <button
                onClick={connectWallet}
                className="px-4 py-1.5 rounded-full text-sm font-ui font-semibold tracking-wide transition-all duration-200 whitespace-nowrap"
                style={{
                  background: 'linear-gradient(135deg, #e63946 0%, #c1121f 100%)',
                  boxShadow: '0 0 16px rgba(230,57,70,0.35)',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Connect Wallet
              </button>
            )}

            {/* Hamburger — mobile only */}
            <button
              className="md:hidden flex flex-col justify-center gap-[5px] p-1.5"
              onClick={() => setMobileOpen(o => !o)}
              aria-label="Toggle menu"
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <span className="block w-5 h-px transition-all duration-200" style={{ background: 'rgba(255,255,255,0.7)', transform: mobileOpen ? 'translateY(6px) rotate(45deg)' : 'none' }} />
              <span className="block w-5 h-px transition-all duration-200" style={{ background: 'rgba(255,255,255,0.7)', opacity: mobileOpen ? 0 : 1 }} />
              <span className="block w-5 h-px transition-all duration-200" style={{ background: 'rgba(255,255,255,0.7)', transform: mobileOpen ? 'translateY(-6px) rotate(-45deg)' : 'none' }} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile nav backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile nav drawer */}
      <nav
        className="md:hidden fixed left-4 right-4 z-40 transition-all duration-300"
        style={{
          top: 88,
          background: 'rgba(8,8,12,0.97)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 20,
          padding: 8,
          boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
          opacity: mobileOpen ? 1 : 0,
          transform: mobileOpen ? 'translateY(0)' : 'translateY(-8px)',
          pointerEvents: mobileOpen ? 'auto' : 'none',
        }}
      >
        {navLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className="flex items-center px-4 py-3 rounded-xl text-sm font-ui font-medium transition-all duration-200"
            style={pathname === item.href ? {
              background: 'rgba(230,57,70,0.1)',
              color: '#e63946',
            } : {
              color: 'rgba(255,255,255,0.55)',
            }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  )
}
