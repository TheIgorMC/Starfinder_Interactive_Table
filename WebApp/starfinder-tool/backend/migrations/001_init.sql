-- 001_init.sql — iteration 1 schema

CREATE TABLE IF NOT EXISTS characters (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  race        TEXT NOT NULL DEFAULT '',
  theme       TEXT NOT NULL DEFAULT '',
  class       TEXT NOT NULL DEFAULT '',
  level       INT  NOT NULL DEFAULT 1,
  -- abilities
  str INT NOT NULL DEFAULT 10,
  dex INT NOT NULL DEFAULT 10,
  con INT NOT NULL DEFAULT 10,
  int INT NOT NULL DEFAULT 10,
  wis INT NOT NULL DEFAULT 10,
  cha INT NOT NULL DEFAULT 10,
  -- pools
  hp_max INT NOT NULL DEFAULT 0,
  hp_cur INT NOT NULL DEFAULT 0,
  sp_max INT NOT NULL DEFAULT 0,
  sp_cur INT NOT NULL DEFAULT 0,
  rp_max INT NOT NULL DEFAULT 0,
  rp_cur INT NOT NULL DEFAULT 0,
  -- defenses / combat
  eac INT NOT NULL DEFAULT 10,
  kac INT NOT NULL DEFAULT 10,
  bab INT NOT NULL DEFAULT 0,
  save_fort INT NOT NULL DEFAULT 0,
  save_ref  INT NOT NULL DEFAULT 0,
  save_will INT NOT NULL DEFAULT 0,
  init_bonus INT NOT NULL DEFAULT 0,
  speed INT NOT NULL DEFAULT 30,
  -- everything else lives as structured JSON until dedicated tables exist
  skills     JSONB NOT NULL DEFAULT '{}',
  feats      JSONB NOT NULL DEFAULT '[]',
  spells     JSONB NOT NULL DEFAULT '[]',
  equipment  JSONB NOT NULL DEFAULT '[]',
  notes      TEXT  NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS battle_sessions (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  grid_w     INT NOT NULL DEFAULT 30,
  grid_h     INT NOT NULL DEFAULT 20,
  map_url    TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tokens (
  id         SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES battle_sessions(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#4f8ef7',
  x          INT NOT NULL DEFAULT 0,
  y          INT NOT NULL DEFAULT 0,
  character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  tracker_id TEXT UNIQUE,           -- maps a physical mini (PCB id) to this token
  visible    BOOLEAN NOT NULL DEFAULT true
);

-- AoN cached rules data (generic per-category store, iteration 1)
CREATE TABLE IF NOT EXISTS aon_entries (
  id        SERIAL PRIMARY KEY,
  category  TEXT NOT NULL,           -- 'feat', 'class', 'equipment', ...
  name      TEXT NOT NULL,
  source    TEXT NOT NULL DEFAULT '',
  url       TEXT NOT NULL DEFAULT '',
  data      JSONB NOT NULL DEFAULT '{}',
  UNIQUE (category, name)
);
CREATE INDEX IF NOT EXISTS aon_entries_category_idx ON aon_entries (category);
CREATE INDEX IF NOT EXISTS aon_entries_name_idx ON aon_entries (lower(name));
