// ===== CARDS =====
export type Suit = 'h' | 'd' | 'c' | 's' // hearts, diamonds, clubs, spades
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14
// 11=Jack, 12=Queen, 13=King, 14=Ace

export interface Card {
  suit: Suit
  rank: Rank
}

export type HandRanking =
  | 'Royal Flush'
  | 'Straight Flush'
  | 'Four of a Kind'
  | 'Full House'
  | 'Flush'
  | 'Straight'
  | 'Three of a Kind'
  | 'Two Pair'
  | 'Pair'
  | 'High Card'

// ===== GAME =====
export enum GamePhase {
  WAITING = 'waiting',
  PREFLOP = 'preflop',
  FLOP = 'flop',
  TURN = 'turn',
  RIVER = 'river',
  SHOWDOWN = 'showdown',
}

export type ActionType = 'fold' | 'check' | 'call' | 'raise'

export interface AgentAction {
  action: ActionType
  amount?: number // required only for raise
}

export interface PlayerState {
  agent_id: string
  agent_name: string
  seat: number
  chips: number
  bet_this_round: number
  hole_cards: Card[] // only visible to the player and spectators
  is_folded: boolean
  is_all_in: boolean
  is_dealer: boolean
  is_small_blind: boolean
  is_big_blind: boolean
  is_sitting_out: boolean
  has_acted_this_round: boolean
}

export interface SidePot {
  amount: number
  eligible_players: string[] // agent_ids
}

export interface GameState {
  table_id: string
  tournament_id: string
  hand_number: number
  phase: GamePhase
  community_cards: Card[]
  pot: number
  side_pots: SidePot[]
  players: PlayerState[]
  current_player_index: number
  dealer_index: number
  small_blind_index: number
  big_blind_index: number
  min_bet: number
  min_raise: number
  last_raise_size: number
  small_blind: number
  big_blind: number
  ante: number
}

// ===== AGENT VIEW (what the agent sees via WebSocket) =====
export interface AgentGameView {
  tournament_id: string
  table_id: string
  hand_number: number
  phase: GamePhase
  your_cards: Card[]
  community_cards: Card[]
  pot: number
  side_pots: SidePot[]
  your_chips: number
  your_bet_this_round: number
  current_bet: number
  min_raise: number
  players: {
    agent_id: string
    agent_name: string
    seat: number
    chips: number
    bet_this_round: number
    is_folded: boolean
    is_all_in: boolean
    is_dealer: boolean
    is_current_turn: boolean
  }[]
  your_position: number
  dealer_position: number
  time_to_act: number
  valid_actions: ActionType[]
}

// ===== SPECTATOR VIEW (sees EVERYTHING) =====
export interface SpectatorGameView {
  tournament_id: string
  table_id: string
  hand_number: number
  phase: GamePhase
  community_cards: Card[]
  pot: number
  side_pots: SidePot[]
  players: {
    agent_id: string
    agent_name: string
    seat: number
    chips: number
    bet_this_round: number
    hole_cards: Card[] // ALL CARDS VISIBLE to spectator
    is_folded: boolean
    is_all_in: boolean
    is_dealer: boolean
    is_small_blind: boolean
    is_big_blind: boolean
    is_current_turn: boolean
    time_remaining?: number
  }[]
  actions: {
    agent_name: string
    action: ActionType
    amount?: number
    timestamp: string
  }[]
  blind_level: number
  small_blind: number
  big_blind: number
  ante: number
  next_level_in: number
  players_remaining: number
  total_players: number
}

// ===== TOURNAMENTS =====
export type TournamentType = 'sit_n_go' | 'heads_up' | 'mtt'
export type TournamentStatus = 'registering' | 'running' | 'finished' | 'cancelled'

export interface BlindLevel {
  level: number
  small_blind: number
  big_blind: number
  ante: number
  duration_minutes: number
}

export interface PrizeStructure {
  [position: string]: number // e.g. {"1": 50, "2": 30, "3": 20} = percentages
}

export interface Tournament {
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
  blind_structure: BlindLevel[]
  prize_structure: PrizeStructure
  starting_chips: number
  is_free: boolean
  scheduled_at?: string
  started_at?: string
  finished_at?: string
  winner_id?: string
}

export interface TournamentEntry {
  id: string
  tournament_id: string
  agent_id: string
  agent_name: string
  user_id: string
  finish_position?: number
  prize_won: number
  registered_by: 'human' | 'agent'
}

// ===== USERS & AGENTS =====
export interface User {
  id: string
  wallet_address: string
  display_name?: string
  balance_usdc: number
}

export interface Agent {
  id: string
  name: string
  owner_id: string
  agent_type: string
  total_tournaments: number
  total_wins: number
  total_profit: number
  elo_rating: number
  hands_played: number
  vpip: number
  pfr: number
  aggression_factor: number
  is_active: boolean
}

// ===== TRANSACTIONS =====
export type TransactionType = 'deposit' | 'withdrawal' | 'buy_in' | 'prize' | 'rake' | 'refund'

export interface Transaction {
  id: string
  user_id: string
  type: TransactionType
  amount: number
  balance_after: number
  tournament_id?: string
  tx_hash?: string
  status: 'pending' | 'confirmed' | 'failed'
  created_at: string
}

// ===== WEBSOCKET EVENTS =====
// Server → Agent
export type ServerToAgentEvents = {
  'game:state': (state: AgentGameView) => void
  'game:your_turn': (state: AgentGameView) => void
  'game:result': (result: { hand_number: number; winners: string[]; pot: number }) => void
  'tournament:start': (info: { tournament_id: string; starting_chips: number }) => void
  'tournament:eliminated': (info: { position: number }) => void
  'tournament:end': (results: { position: number; prize: number }[]) => void
  error: (msg: string) => void
}

// Agent → Server
export type AgentToServerEvents = {
  action: (action: AgentAction) => void
}

// Server → Spectator
export type ServerToSpectatorEvents = {
  'game:state': (state: SpectatorGameView) => void
  'game:action': (action: { agent_name: string; action: ActionType; amount?: number }) => void
  'game:deal': (info: { phase: GamePhase; cards?: Card[] }) => void
  'game:showdown': (result: {
    winners: { agent_name: string; hand: string; cards: Card[] }[]
    pot: number
  }) => void
  'game:eliminate': (info: { agent_name: string; position: number }) => void
  'tournament:end': (results: TournamentEntry[]) => void
}
