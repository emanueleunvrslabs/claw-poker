-- ============================================
-- CLAW POKER — RPC Functions
-- Migration 002_rpc_functions.sql
-- ============================================

-- Atomic balance update (prevents race conditions)
CREATE OR REPLACE FUNCTION update_user_balance(p_user_id UUID, p_delta DECIMAL)
RETURNS DECIMAL AS $$
DECLARE
  new_balance DECIMAL;
BEGIN
  UPDATE users
  SET balance_usdc = balance_usdc + p_delta,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING balance_usdc INTO new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  IF new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

-- Increment tournament player count + update prize pool
CREATE OR REPLACE FUNCTION increment_tournament_players(p_tournament_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE tournaments
  SET current_players = current_players + 1
  WHERE id = p_tournament_id;
END;
$$ LANGUAGE plpgsql;

-- Decrement tournament player count
CREATE OR REPLACE FUNCTION decrement_tournament_players(p_tournament_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE tournaments
  SET current_players = GREATEST(current_players - 1, 0)
  WHERE id = p_tournament_id;
END;
$$ LANGUAGE plpgsql;
