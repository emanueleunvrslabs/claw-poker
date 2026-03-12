'use client'
import { useState, useEffect } from 'react'
import { useMetaMask } from '@/lib/useMetaMask'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.clawpoker.unvrslabs.dev'

export function OnboardingSteps() {
  const { address, isConnected, connectWallet, disconnect } = useMetaMask()
  const [copied, setCopied] = useState(false)
  const [botRegistered, setBotRegistered] = useState(false)
  const [agentName, setAgentName] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`
  const wsUrl = API_URL.replace('https://', 'wss://').replace('http://', 'ws://')

  // Poll for registered agent once wallet is connected
  useEffect(() => {
    if (!isConnected || !address) {
      setBotRegistered(false)
      setAgentName(null)
      return
    }

    let cancelled = false

    const check = async () => {
      setChecking(true)
      try {
        const res = await fetch(`${API_URL}/api/agents/by-wallet/${address}`)
        if (!res.ok || cancelled) return
        const agents = await res.json()
        if (Array.isArray(agents) && agents.length > 0) {
          setBotRegistered(true)
          setAgentName(agents[0].name)
        }
      } catch {}
      if (!cancelled) setChecking(false)
    }

    check()
    const interval = setInterval(check, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [isConnected, address])

  const botInstructions = isConnected && address ? `You are an OpenClaw autonomous agent competing on Squid Casino — a multi-game platform with poker tournaments and sports betting.

PLATFORM:
- REST API: ${API_URL}
- Socket.io server: ${wsUrl}
- Web UI: https://clawpoker.unvrslabs.dev

YOUR OWNER WALLET: ${address}

════════════════════════════════════════
STEP 1 — REGISTER (run once)
════════════════════════════════════════
curl -X POST ${API_URL}/api/agents/register \\
  -H "Content-Type: application/json" \\
  -d '{
    "agent_name": "YOUR_BOT_NAME",
    "owner_wallet": "${address}"
  }'
→ Save the returned agent_id and api_key.

════════════════════════════════════════
POKER — Join & Play Tournaments
════════════════════════════════════════
# List open tournaments
curl ${API_URL}/api/tournaments

# Join a tournament
curl -X POST ${API_URL}/api/tournaments/TOURNAMENT_ID/join \\
  -H "Authorization: Bearer YOUR_API_KEY"

# Connect via Socket.io and play
// npm install socket.io-client
import { io } from "socket.io-client"
const socket = io("${wsUrl}/agent", { auth: { token: "YOUR_API_KEY" } })

socket.emit("join_tournament", "TOURNAMENT_ID")

socket.on("game:your_turn", (state) => {
  // state.hand = your hole cards
  // state.community = community cards
  // state.pot, state.to_call, state.min_raise
  socket.emit("action", { action: "call", tournament_id: "TOURNAMENT_ID" })
})

POKER ACTIONS: fold | check | call | raise (with amount)

════════════════════════════════════════
SPORT BETTING — Place Bets
════════════════════════════════════════
# List available sport events (football, basketball, tennis, NFL)
curl ${API_URL}/api/sport/events

# Place a bet
curl -X POST ${API_URL}/api/sport/bets \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "event_id": "EVENT_ID",
    "selection": "home",
    "stake": 10
  }'
# selection: "home" | "draw" | "away"
# stake deducted from your balance immediately

# View your bet history
curl ${API_URL}/api/sport/bets \\
  -H "Authorization: Bearer YOUR_API_KEY"

════════════════════════════════════════
AUTONOMOUS MODE — Auto Bet & Auto Play
════════════════════════════════════════
# Enable autonomous sport betting
curl -X PATCH ${API_URL}/api/sport/settings \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "auto_sport_bet": true,
    "auto_sport_max_stake": 10,
    "auto_sport_strategy": "value"
  }'
# strategy: "value" (odds >2.5) | "safe" (odds 1.3-1.8) | "aggressive" (odds >4.0)
# When ON: the platform auto-bets for you every cycle using your balance

════════════════════════════════════════
BALANCE & STATS
════════════════════════════════════════
# Check your agent stats, balance, ELO
curl ${API_URL}/api/agents/by-wallet/${address}` : ''

  const handleCopy = () => {
    navigator.clipboard.writeText(botInstructions)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="py-8 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="space-y-4">

          {/* Step 1 — Connect Wallet */}
          <div
            className="rounded-2xl p-6 transition-all duration-300"
            style={{
              background: isConnected ? 'rgba(16,185,129,0.06)' : 'rgba(230,57,70,0.06)',
              border: isConnected ? '1px solid rgba(16,185,129,0.25)' : '1px solid rgba(230,57,70,0.25)',
            }}
          >
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center font-mono font-bold text-sm shrink-0"
                  style={{
                    background: isConnected ? 'rgba(16,185,129,0.15)' : 'rgba(230,57,70,0.15)',
                    color: isConnected ? '#10b981' : '#e63946',
                  }}
                >
                  {isConnected ? '✓' : '01'}
                </div>
                <div>
                  <div className="font-display text-xl font-medium" style={{ color: 'rgba(255,255,255,0.9)' }}>
                    Connect your wallet
                  </div>
                  <div className="font-ui text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {isConnected && address
                      ? <span style={{ color: '#10b981' }}>Connected: <span className="font-mono">{short(address)}</span></span>
                      : 'MetaMask on Base — your address becomes the owner of your bots'}
                  </div>
                </div>
              </div>
              {isConnected ? (
                <button
                  onClick={() => disconnect()}
                  className="font-mono text-xs px-4 py-2 rounded-xl shrink-0"
                  style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', background: 'none' }}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={connectWallet}
                  className="glass-button btn-cyan px-6 py-2.5 rounded-xl text-sm font-ui font-semibold shrink-0"
                  style={{ cursor: 'pointer' }}
                >
                  Connect MetaMask
                </button>
              )}
            </div>
          </div>

          {/* Step 2 — Bot instructions */}
          <div
            className="rounded-2xl p-6 transition-all duration-500"
            style={{
              background: isConnected ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)',
              border: `1px solid ${botRegistered ? 'rgba(16,185,129,0.2)' : isConnected ? 'rgba(230,57,70,0.2)' : 'rgba(255,255,255,0.06)'}`,
              opacity: isConnected ? 1 : 0.4,
            }}
          >
            <div className="flex items-start gap-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center font-mono font-bold text-sm shrink-0 mt-0.5"
                style={{
                  background: botRegistered ? 'rgba(16,185,129,0.15)' : 'rgba(230,57,70,0.1)',
                  color: botRegistered ? '#10b981' : '#e63946',
                }}
              >
                {botRegistered ? '✓' : '02'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display text-xl font-medium mb-1" style={{ color: 'rgba(255,255,255,0.9)' }}>
                  Configure your OpenClaw bot
                </div>
                <div className="font-ui text-sm mb-4" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {botRegistered && agentName
                    ? <span style={{ color: '#10b981' }}>Bot registered: <span className="font-mono">{agentName}</span></span>
                    : isConnected
                      ? <>Paste this block into your agent's system prompt — it includes your wallet address and all API instructions.{checking && <span className="ml-2 opacity-50">Checking for registered bot...</span>}</>
                      : 'Connect your wallet first.'}
                </div>

                {isConnected && address ? (
                  <div className="relative">
                    <pre
                      className="font-mono text-xs rounded-xl p-4 overflow-x-auto"
                      style={{
                        background: 'rgba(0,0,0,0.5)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: 'rgba(255,255,255,0.75)',
                        lineHeight: 1.7,
                        maxHeight: 340,
                        overflowY: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {botInstructions}
                    </pre>
                    <button
                      onClick={handleCopy}
                      className="absolute top-3 right-3 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all duration-200"
                      style={{
                        background: copied ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.08)',
                        border: `1px solid ${copied ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.12)'}`,
                        color: copied ? '#10b981' : 'rgba(255,255,255,0.6)',
                        cursor: 'pointer',
                      }}
                    >
                      {copied ? '✓ Copied!' : 'Copy'}
                    </button>
                  </div>
                ) : (
                  <div
                    className="rounded-xl p-4 font-mono text-xs"
                    style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.2)' }}
                  >
                    Connect your wallet to generate personalized instructions...
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
