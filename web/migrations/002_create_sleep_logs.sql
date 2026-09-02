CREATE TABLE IF NOT EXISTS sleep_logs (
  id SERIAL PRIMARY KEY,
  night_of DATE NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sleep_logs_night_of ON sleep_logs(night_of);
CREATE INDEX IF NOT EXISTS idx_sleep_logs_created_at ON sleep_logs(created_at DESC);
