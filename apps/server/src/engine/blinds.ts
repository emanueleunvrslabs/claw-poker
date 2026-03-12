import type { BlindLevel } from '@claw-poker/shared'
import {
  BLIND_STRUCTURE_SIT_N_GO,
  BLIND_STRUCTURE_HEADS_UP,
} from '@claw-poker/shared'

export interface BlindState {
  current_level: number
  small_blind: number
  big_blind: number
  ante: number
  next_level_at: Date
  seconds_until_next_level: number
}

export function getBlindLevel(
  structure: BlindLevel[],
  levelIndex: number
): BlindLevel {
  const idx = Math.min(levelIndex, structure.length - 1)
  return structure[idx]
}

export function calculateNextLevelTime(level: BlindLevel, startedAt: Date): Date {
  const ms = level.duration_minutes * 60 * 1000
  return new Date(startedAt.getTime() + ms)
}

export function getCurrentBlindState(
  structure: BlindLevel[],
  tournamentStartedAt: Date
): BlindState {
  const now = Date.now()
  const elapsed = now - tournamentStartedAt.getTime()

  let accumulated = 0
  let levelIndex = 0

  for (let i = 0; i < structure.length; i++) {
    const levelDuration = structure[i].duration_minutes * 60 * 1000
    if (elapsed < accumulated + levelDuration) {
      levelIndex = i
      break
    }
    accumulated += levelDuration
    levelIndex = i
  }

  const currentLevel = structure[levelIndex]
  const levelStartMs = accumulated
  const levelEndMs = levelStartMs + currentLevel.duration_minutes * 60 * 1000
  const secondsUntilNext = Math.max(0, Math.ceil((levelEndMs - elapsed) / 1000))

  return {
    current_level: currentLevel.level,
    small_blind: currentLevel.small_blind,
    big_blind: currentLevel.big_blind,
    ante: currentLevel.ante,
    next_level_at: new Date(tournamentStartedAt.getTime() + levelEndMs),
    seconds_until_next_level: secondsUntilNext,
  }
}

export function getBlindStructureForType(type: 'sit_n_go' | 'heads_up' | 'mtt'): BlindLevel[] {
  switch (type) {
    case 'heads_up':
      return BLIND_STRUCTURE_HEADS_UP
    case 'sit_n_go':
    case 'mtt':
    default:
      return BLIND_STRUCTURE_SIT_N_GO
  }
}
