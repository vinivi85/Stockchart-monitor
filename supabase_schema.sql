-- ============================================================
-- Stock Monitor — Supabase Schema
-- Módulos: BR (B3) e US, cada ticker com watchlist, posição
-- e regras de monitoramento configuráveis por indicador.
-- ============================================================

create table if not exists watchlist (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('BR', 'US')),
  ticker text not null,           -- ex: 'PETR4' (BR) ou 'AAPL' (US)
  yahoo_symbol text not null,     -- ex: 'PETR4.SA' (BR) ou 'AAPL' (US)
  name text,
  created_at timestamptz not null default now(),
  unique (market, ticker)
);

create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references watchlist(id) on delete cascade,
  quantity numeric not null default 0,
  avg_price numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- Uma regra = um indicador configurado para um ticker.
-- 'params' guarda a config específica de cada indicador, ex:
--   HiLo:              {"period": 3}
--   SMA cross:         {"fast": 9, "slow": 21}
--   RSI:               {"period": 14, "threshold": 30}
--   Bollinger:         {"period": 20, "stddev": 2}
create table if not exists monitoring_rules (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references watchlist(id) on delete cascade,
  indicator_type text not null,   -- 'hilo' | 'sma_cross' | 'ema_cross' | 'rsi' | 'macd' |
                                   -- 'bollinger' | 'atr' | 'stochastic' | 'williams_r' |
                                   -- 'adx' | 'ichimoku' | 'volume_relative' | 'obv' |
                                   -- 'week52_range' | 'ath_distance' | 'support_resistance'
  condition text not null,        -- 'cross_above' | 'cross_below' | 'above' | 'below'
  params jsonb not null default '{}',
  check_interval_minutes integer not null default 15
    check (check_interval_minutes in (5, 15, 30)),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists alerts_log (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references watchlist(id) on delete cascade,
  rule_id uuid not null references monitoring_rules(id) on delete cascade,
  triggered_at timestamptz not null default now(),
  price_at_trigger numeric,
  notified boolean not null default false
);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_watchlist_market on watchlist(market);
create index if not exists idx_rules_watchlist on monitoring_rules(watchlist_id);
create index if not exists idx_rules_active on monitoring_rules(active) where active = true;
create index if not exists idx_alerts_watchlist on alerts_log(watchlist_id);

-- ============================================================
-- Módulo Dividendos
-- ============================================================
create table if not exists dividend_watchlist (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('BR', 'US')),
  ticker text not null,
  yahoo_symbol text not null,
  name text,
  created_at timestamptz not null default now(),
  unique (market, ticker)
);
