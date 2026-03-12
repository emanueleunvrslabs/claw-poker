-- ============================================
-- CLAW POKER — Database Schema
-- Migration 001_initial.sql
-- ============================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) UNIQUE NOT NULL,
  display_name VARCHAR(50),
  balance_usdc DECIMAL(18,6) DEFAULT 0,
  total_deposited DECIMAL(18,6) DEFAULT 0,
  total_withdrawn DECIMAL(18,6) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) UNIQUE NOT NULL,
  api_key_hash VARCHAR(255) NOT NULL,
  owner_id UUID REFERENCES users(id) NOT NULL,
  agent_type VARCHAR(20) DEFAULT 'openclaw',
  total_tournaments INT DEFAULT 0,
  total_wins INT DEFAULT 0,
  total_profit DECIMAL(18,6) DEFAULT 0,
  elo_rating INT DEFAULT 1000,
  hands_played INT DEFAULT 0,
  vpip DECIMAL(5,2) DEFAULT 0,
  pfr DECIMAL(5,2) DEFAULT 0,
  aggression_factor DECIMAL(5,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('sit_n_go', 'heads_up', 'mtt')),
  buy_in DECIMAL(18,6) NOT NULL DEFAULT 0,
  rake_percent DECIMAL(5,2) DEFAULT 10,
  prize_pool DECIMAL(18,6) DEFAULT 0,
  max_players INT NOT NULL,
  min_players INT NOT NULL,
  current_players INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'registering' CHECK (status IN ('registering', 'running', 'finished', 'cancelled')),
  blind_structure JSONB NOT NULL,
  prize_structure JSONB NOT NULL,
  starting_chips INT DEFAULT 1500,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  winner_id UUID REFERENCES agents(id),
  results JSONB,
  is_free BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tournament_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id),
  user_id UUID REFERENCES users(id),
  buy_in_paid DECIMAL(18,6) NOT NULL DEFAULT 0,
  finish_position INT,
  prize_won DECIMAL(18,6) DEFAULT 0,
  registered_by VARCHAR(20) DEFAULT 'human' CHECK (registered_by IN ('human', 'agent')),
  tx_hash VARCHAR(66),
  chips_final INT DEFAULT 0,
  registered_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tournament_id, agent_id)
);

CREATE TABLE hand_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  table_id VARCHAR(50) NOT NULL,
  hand_number INT NOT NULL,
  dealer_position INT,
  small_blind DECIMAL(18,6),
  big_blind DECIMAL(18,6),
  community_cards JSONB,
  pot DECIMAL(18,6),
  side_pots JSONB,
  winners JSONB,
  actions JSONB,
  player_cards JSONB,
  player_chips_before JSONB,
  player_chips_after JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'buy_in', 'prize', 'rake', 'refund')),
  amount DECIMAL(18,6) NOT NULL,
  balance_after DECIMAL(18,6),
  tournament_id UUID REFERENCES tournaments(id),
  tx_hash VARCHAR(66),
  chain VARCHAR(20) DEFAULT 'base',
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_users_wallet ON users(wallet_address);
CREATE INDEX idx_agents_owner ON agents(owner_id);
CREATE INDEX idx_agents_name ON agents(name);
CREATE INDEX idx_tournaments_status ON tournaments(status);
CREATE INDEX idx_tournaments_type ON tournaments(type);
CREATE INDEX idx_entries_tournament ON tournament_entries(tournament_id);
CREATE INDEX idx_entries_agent ON tournament_entries(agent_id);
CREATE INDEX idx_hand_logs_tournament ON hand_logs(tournament_id);
CREATE INDEX idx_hand_logs_table ON hand_logs(tournament_id, table_id, hand_number);
CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_status ON transactions(status);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
