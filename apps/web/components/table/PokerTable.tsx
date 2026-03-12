'use client'
import { CardComponent } from './CardComponent'
import { PlayerSeat } from './PlayerSeat'
import type { SpectatorGameView } from '@claw-poker/shared'

// ── Seat layout positions by player count ────────────────────────────────────

// 2-player: left ↔ right (heads-up)
const SEAT_POSITIONS_2 = [
  { top: '50%', left: '4%',  transform: 'translate(0, -50%)',     label: 'left' },
  { top: '50%', left: '96%', transform: 'translate(-100%, -50%)', label: 'right' },
]

// 4-player: 2 on top, 2 on bottom
const SEAT_POSITIONS_4 = [
  { top: '14%', left: '32%', transform: 'translate(-50%, -50%)', label: 'top-left' },
  { top: '14%', left: '68%', transform: 'translate(-50%, -50%)', label: 'top-right' },
  { top: '86%', left: '68%', transform: 'translate(-50%, -50%)', label: 'bottom-right' },
  { top: '86%', left: '32%', transform: 'translate(-50%, -50%)', label: 'bottom-left' },
]

// 6-player standard
const SEAT_POSITIONS_6 = [
  { top: '82%', left: '28%', transform: 'translate(-50%, -50%)', label: 'bottom-left' },
  { top: '82%', left: '72%', transform: 'translate(-50%, -50%)', label: 'bottom-right' },
  { top: '50%', left: '4%',  transform: 'translate(0, -50%)',    label: 'left' },
  { top: '50%', left: '96%', transform: 'translate(-100%, -50%)',label: 'right' },
  { top: '18%', left: '28%', transform: 'translate(-50%, -50%)', label: 'top-left' },
  { top: '18%', left: '72%', transform: 'translate(-50%, -50%)', label: 'top-right' },
]

// 9-player full table
const SEAT_POSITIONS_9 = [
  { top: '82%', left: '28%', transform: 'translate(-50%, -50%)', label: 'bottom-left' },
  { top: '82%', left: '72%', transform: 'translate(-50%, -50%)', label: 'bottom-right' },
  { top: '50%', left: '4%',  transform: 'translate(0, -50%)',    label: 'left' },
  { top: '50%', left: '96%', transform: 'translate(-100%, -50%)',label: 'right' },
  { top: '18%', left: '28%', transform: 'translate(-50%, -50%)', label: 'top-left' },
  { top: '18%', left: '72%', transform: 'translate(-50%, -50%)', label: 'top-right' },
  { top: '4%',  left: '50%', transform: 'translate(-50%, 0)',    label: 'top' },
  { top: '60%', left: '50%', transform: 'translate(-50%, -50%)', label: 'bottom' },
  { top: '65%', left: '14%', transform: 'translate(-50%, -50%)', label: 'bottom-left-2' },
]

function getSeatPositions(count: number) {
  if (count <= 2) return SEAT_POSITIONS_2
  if (count <= 4) return SEAT_POSITIONS_4
  if (count <= 6) return SEAT_POSITIONS_6
  return SEAT_POSITIONS_9
}

interface Props {
  view?: SpectatorGameView | null
  tournamentId: string
  tableId: string
}

// Mock data for preview
const MOCK_VIEW: SpectatorGameView = {
  tournament_id: 'mock',
  table_id: 'mock-1',
  hand_number: 47,
  phase: 'river' as never,
  community_cards: [
    { rank: 14, suit: 'h' },
    { rank: 13, suit: 'd' },
    { rank: 7, suit: 's' },
    { rank: 3, suit: 'c' },
    { rank: 9, suit: 'h' },
  ],
  pot: 1240,
  side_pots: [],
  players: [
    { agent_id: '1', agent_name: 'Agent_Alpha', seat: 0, chips: 1200, bet_this_round: 200, hole_cards: [{ rank: 13, suit: 's' }, { rank: 12, suit: 'h' }], is_folded: false, is_all_in: false, is_dealer: true, is_small_blind: false, is_big_blind: false, is_current_turn: false },
    { agent_id: '2', agent_name: 'BluffMaster', seat: 1, chips: 800, bet_this_round: 200, hole_cards: [{ rank: 7, suit: 'd' }, { rank: 7, suit: 'c' }], is_folded: false, is_all_in: false, is_dealer: false, is_small_blind: true, is_big_blind: false, is_current_turn: false },
    { agent_id: '3', agent_name: 'DeepBluff', seat: 2, chips: 600, bet_this_round: 200, hole_cards: [{ rank: 14, suit: 'c' }, { rank: 11, suit: 'h' }], is_folded: false, is_all_in: false, is_dealer: false, is_small_blind: false, is_big_blind: true, is_current_turn: false },
    { agent_id: '4', agent_name: 'NashAgent', seat: 3, chips: 400, bet_this_round: 400, hole_cards: [{ rank: 9, suit: 'd' }, { rank: 10, suit: 'h' }], is_folded: false, is_all_in: true, is_dealer: false, is_small_blind: false, is_big_blind: false, is_current_turn: false },
    { agent_id: '5', agent_name: 'PokerBot_X', seat: 4, chips: 1500, bet_this_round: 0, hole_cards: [{ rank: 2, suit: 's' }, { rank: 5, suit: 'd' }], is_folded: false, is_all_in: false, is_dealer: false, is_small_blind: false, is_big_blind: false, is_current_turn: true, time_remaining: 9 },
    { agent_id: '6', agent_name: 'OpenClaw_42', seat: 5, chips: 2100, bet_this_round: 0, hole_cards: [{ rank: 4, suit: 'h' }, { rank: 8, suit: 'c' }], is_folded: true, is_all_in: false, is_dealer: false, is_small_blind: false, is_big_blind: false, is_current_turn: false },
  ],
  actions: [
    { agent_name: 'Agent_Alpha', action: 'raise', amount: 200, timestamp: '19:23:01' },
    { agent_name: 'DeepBluff', action: 'call', timestamp: '19:23:05' },
    { agent_name: 'NashAgent', action: 'raise', amount: 400, timestamp: '19:23:08' },
    { agent_name: 'BluffMaster', action: 'call', timestamp: '19:23:12' },
    { agent_name: 'OpenClaw_42', action: 'fold', timestamp: '19:23:15' },
  ],
  blind_level: 5,
  small_blind: 75,
  big_blind: 150,
  ante: 15,
  next_level_in: 187,
  players_remaining: 5,
  total_players: 9,
}

export function PokerTable({ view, tournamentId, tableId }: Props) {
  const state = view ?? MOCK_VIEW

  return (
    <div className="relative w-full" style={{ minHeight: 600 }}>
      {/* Table oval */}
      <div
        className="poker-table rounded-[50%] mx-auto relative"
        style={{
          width: '100%',
          maxWidth: 780,
          height: 420,
        }}
      >
        {/* Community cards — center */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-3 z-10"
        >
          {/* Phase label */}
          <div
            className="font-mono text-[10px] tracking-widest uppercase mb-1"
            style={{ color: 'rgba(255,255,255,0.3)' }}
          >
            {state.phase}
          </div>

          {/* Community cards */}
          <div className="flex gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <CardComponent
                key={i}
                card={state.community_cards[i]}
                faceDown={!state.community_cards[i]}
                size="md"
                delay={i * 0.07}
              />
            ))}
          </div>

          {/* Pot */}
          <div
            className="mt-2 px-4 py-1.5 rounded-full flex items-center gap-2"
            style={{
              background: 'rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.1)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <div className="chip w-4 h-4" />
            <span className="font-mono text-sm font-semibold" style={{ color: '#fbbf24' }}>
              {state.pot.toLocaleString()}
            </span>
            <span className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
              POT
            </span>
          </div>
        </div>

        {/* Player seats — layout adapts to player count */}
        {getSeatPositions(state.players.length).slice(0, state.players.length).map((pos, i) => {
          const player = state.players[i]
          if (!player) return null
          return (
            <div
              key={player.agent_id}
              className="absolute z-20"
              style={{
                top: pos.top,
                left: pos.left,
                transform: pos.transform,
              }}
            >
              <PlayerSeat player={player} position={pos.label as never} />
            </div>
          )
        })}
      </div>

      {/* Blind info bar */}
      <div className="flex items-center justify-center gap-6 mt-6">
        <InfoPill label="Level" value={String(state.blind_level)} />
        <InfoPill label="Blinds" value={`${state.small_blind}/${state.big_blind}`} />
        {state.ante > 0 && <InfoPill label="Ante" value={String(state.ante)} />}
        <InfoPill label="Next level" value={`${Math.floor(state.next_level_in / 60)}:${String(state.next_level_in % 60).padStart(2, '0')}`} accent />
        <InfoPill label="Players" value={`${state.players_remaining}/${state.total_players}`} />
        <InfoPill label="Hand" value={`#${state.hand_number}`} />
      </div>
    </div>
  )
}

function InfoPill({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: accent ? '1px solid rgba(230,57,70,0.2)' : '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <span className="font-mono text-[10px] tracking-wider uppercase" style={{ color: 'rgba(255,255,255,0.3)' }}>
        {label}
      </span>
      <span
        className="font-mono text-sm font-semibold"
        style={{ color: accent ? '#e63946' : 'rgba(255,255,255,0.8)' }}
      >
        {value}
      </span>
    </div>
  )
}
