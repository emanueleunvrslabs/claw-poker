import type { BlindLevel, PrizeStructure } from './types'

// ===== BLIND STRUCTURES =====

export const BLIND_STRUCTURE_SIT_N_GO: BlindLevel[] = [
  { level: 1,  small_blind: 10,  big_blind: 20,   ante: 0,   duration_minutes: 5 },
  { level: 2,  small_blind: 15,  big_blind: 30,   ante: 0,   duration_minutes: 5 },
  { level: 3,  small_blind: 25,  big_blind: 50,   ante: 0,   duration_minutes: 5 },
  { level: 4,  small_blind: 50,  big_blind: 100,  ante: 10,  duration_minutes: 5 },
  { level: 5,  small_blind: 75,  big_blind: 150,  ante: 15,  duration_minutes: 5 },
  { level: 6,  small_blind: 100, big_blind: 200,  ante: 25,  duration_minutes: 5 },
  { level: 7,  small_blind: 150, big_blind: 300,  ante: 30,  duration_minutes: 5 },
  { level: 8,  small_blind: 200, big_blind: 400,  ante: 50,  duration_minutes: 5 },
  { level: 9,  small_blind: 300, big_blind: 600,  ante: 75,  duration_minutes: 5 },
  { level: 10, small_blind: 500, big_blind: 1000, ante: 100, duration_minutes: 5 },
]

export const BLIND_STRUCTURE_HEADS_UP: BlindLevel[] = [
  { level: 1, small_blind: 10,  big_blind: 20,  ante: 0,  duration_minutes: 3 },
  { level: 2, small_blind: 20,  big_blind: 40,  ante: 0,  duration_minutes: 3 },
  { level: 3, small_blind: 30,  big_blind: 60,  ante: 0,  duration_minutes: 3 },
  { level: 4, small_blind: 50,  big_blind: 100, ante: 10, duration_minutes: 3 },
  { level: 5, small_blind: 75,  big_blind: 150, ante: 15, duration_minutes: 3 },
  { level: 6, small_blind: 100, big_blind: 200, ante: 25, duration_minutes: 3 },
  { level: 7, small_blind: 150, big_blind: 300, ante: 30, duration_minutes: 3 },
  { level: 8, small_blind: 200, big_blind: 400, ante: 50, duration_minutes: 3 },
]

// ===== PRIZE STRUCTURES =====

export const PRIZE_STRUCTURE_9_PLAYER: PrizeStructure = {
  '1': 50, // 50% del prize pool
  '2': 30, // 30%
  '3': 20, // 20%
}

export const PRIZE_STRUCTURE_6_PLAYER: PrizeStructure = {
  '1': 65,
  '2': 35,
}

export const PRIZE_STRUCTURE_HEADS_UP: PrizeStructure = {
  '1': 100, // winner takes all
}

// ===== GAME CONSTANTS =====
export const STARTING_CHIPS = 1_000_000
export const ACTION_TIMEOUT_SECONDS = 15          // timeout massimo per azione
export const AGENT_MIN_THINK_SECONDS = 2          // delay minimo prima che un agente possa agire
export const AGENT_MAX_THINK_SECONDS = 5          // delay massimo per i bot demo
export const RAKE_PERCENT = 10
export const MIN_WITHDRAWAL_USDC = 5
export const MAX_PLAYERS_PER_TABLE = 9

// ===== USDC ON BASE =====
export const USDC_CONTRACT_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
export const BASE_CHAIN_ID = 8453
