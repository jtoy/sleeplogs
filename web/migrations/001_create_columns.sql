CREATE TABLE IF NOT EXISTS columns (
  id SERIAL PRIMARY KEY,
  key VARCHAR(50) UNIQUE NOT NULL,
  label VARCHAR(100) NOT NULL,
  field_type VARCHAR(20) NOT NULL,
  default_value VARCHAR(100),
  min_value INT,
  max_value INT,
  sort_order INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_columns_sort_order ON columns(sort_order);
CREATE INDEX IF NOT EXISTS idx_columns_enabled ON columns(enabled);
