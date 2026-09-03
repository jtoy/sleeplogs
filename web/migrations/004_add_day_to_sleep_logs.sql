-- Add the wake/filing day (separate from night_of).
-- User model: filed 9/3 (woke 9/3) -> night_of 9/2, day 9/3.
ALTER TABLE sleep_logs ADD COLUMN IF NOT EXISTS day DATE;
UPDATE sleep_logs SET day = (night_of + INTERVAL '1 day')::date WHERE day IS NULL;