INSERT INTO columns (key, label, field_type, default_value, min_value, max_value, sort_order) VALUES
  ('sleep_rating',        'Sleep Rating',       'rating', NULL,    1, 5,    1),
  ('woke_up_times',       'Wake-ups',           'int',    '0',     0, 20,   2),
  ('total_sleep_minutes', 'Total Sleep (min)',   'int',    NULL,    0, 900,  3),
  ('time_out_of_bed',     'Time Out of Bed',     'text',   NULL,    NULL, NULL, 4),
  ('nap',                 'Nap?',               'bool',   'false', NULL, NULL, 5),
  ('melatonin_mcg',       'Melatonin (mcg)',     'int',    '400',   0, 5000, 6),
  ('followed_process',    'Followed Process?',   'bool',   'false', NULL, NULL, 7),
  ('notes',               'Notes',              'text',   NULL,    NULL, NULL, 8)
ON CONFLICT (key) DO NOTHING;
