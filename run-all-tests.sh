#!/usr/bin/env bash
# Run ALL SleepLogs test suites:
#   web unit (mocked DB)   -> web: npm test
#   web integration (TEST DB) -> web: npm run test:integration
#   watch C logic          -> watch: test_sleeplogs (gcc, no pebble.h)
#   watch PKJS harness     -> watch: node test/pkjs.test.js
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
FAILED=0

echo "=============================================="
echo "  SleepLogs test suite"
echo "=============================================="

echo
echo "--- Web unit tests (vitest, mocked DB) ---"
cd "$ROOT/web"
if npm test 2>&1 | tail -3; then
  echo "web unit: PASSED"
else
  echo "web unit: FAILED"; FAILED=1
fi

echo
echo "--- Web integration tests (separate TEST database) ---"
if [ -f .env.test ] && grep -q TEST_DATABASE_URL .env.test; then
  if npm run test:integration 2>&1 | tail -3; then
    echo "web integration: PASSED"
  else
    echo "web integration: FAILED"; FAILED=1
  fi
else
  echo "web integration: SKIPPED (no .env.test / TEST_DATABASE_URL)"
fi

echo
echo "--- Watch C logic tests (host gcc) ---"
cd "$ROOT/watch"
if gcc -std=c99 -Wall -Wextra -o test_sleeplogs test_sleeplogs.c && ./test_sleeplogs | tail -2; then
  echo "watch C: PASSED"
else
  echo "watch C: FAILED"; FAILED=1
fi

echo
echo "--- Watch PKJS harness (mocked phone) ---"
if node test/pkjs.test.js 2>&1 | tail -2; then
  echo "watch PKJS: PASSED"
else
  echo "watch PKJS: FAILED"; FAILED=1
fi

echo
echo "=============================================="
if [ "$FAILED" -eq 0 ]; then
  echo "ALL TEST SUITES PASSED ✅"
else
  echo "SOME TEST SUITES FAILED ❌"
fi
exit $FAILED