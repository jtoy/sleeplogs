# SleepLogs

Sleep tracking system: Pebble watch questionnaire + Vercel web dashboard.

## Structure

```
sleeplogs/
├── watch/          ← Pebble C SDK app (Emery / Pebble Time 2)
│   ├── src/c/      ← Watch code: UI, health, wakeups, dictation
│   ├── src/pkjs/   ← Phone JS proxy: HTTP to Vercel API, Clay config
│   └── test_sleeplogs.c  ← Host-compiled unit tests
│
└── web/            ← Next.js Vercel app (sleeplogs.jtoy.net)
    ├── app/api/    ← API routes: columns, write_log, logs
    ├── migrations/ ← PostgreSQL schema (Neon)
    └── test/       ← Vitest tests
```

## Setup

### Web App

```bash
cd web
cp .env.example .env  # set DATABASE_URL
npm install

# Run migrations
source .env
for f in migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done

# Dev server
npm run dev

# Tests
npm test
```

### Watch App

```bash
cd watch

# Run unit tests (host, no Pebble SDK needed)
gcc -std=c99 -Wall -Wextra -o test_sleeplogs test_sleeplogs.c && ./test_sleeplogs

# Build for Pebble (requires Pebble SDK)
pebble build
pebble install --emulator emery
```

### Configuration

1. Install watch app on Pebble Time 2
2. Open Settings → SleepLogs on phone
3. Enter your Distark ORC API token
4. Set API URL (default: https://sleeplogs.jtoy.net)
5. Configure popup time (default: 6:00 AM)

## How It Works

1. Watch wakes up at configured time (wakeup API)
2. Checks phone connectivity — exits silently if no phone
3. Fetches enabled columns from `/api/columns` via PKJS
4. Shows each question one at a time (UP/DOWN to adjust, SELECT to advance)
5. Text fields use Pebble dictation (voice → text)
6. On submit, POSTs all answers to `/api/write_log`
7. Schedules next day's wakeup; if not answered, reminds every 30 min

## Auth

All API calls use Distark ORC bearer token authentication.
Token is entered via Clay config on phone, stored in PKJS localStorage,
and sent as `Authorization: Bearer <token>` header.
The watch C code never sees the token.
