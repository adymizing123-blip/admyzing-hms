#!/usr/bin/env bash
# Runs the database tests against an EMPTY PostgreSQL database (never your live Supabase project).
# Usage: DATABASE_URL=postgres://user:pass@localhost:5432/hms_test npm run test:db
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to an empty test database}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/00_stub_auth.sql -f supabase/setup.sql -f supabase/tests/10_tests.sql -f supabase/tests/20_chats_automations_tests.sql
