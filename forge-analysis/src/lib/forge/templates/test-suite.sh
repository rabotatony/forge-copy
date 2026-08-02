#!/usr/bin/env bash
# ============================================================
# Forge — comprehensive single-session test
# ============================================================
# Runs all tests in sequence with server restarts between
# heavy operations to avoid OOM.
# ============================================================
set -uo pipefail

BASE="http://localhost:3000"
PASS=0
FAIL=0
RESULTS=""

log() { echo "  $1"; }
pass() { PASS=$((PASS+1)); RESULTS+="✓ $1\n"; }
fail() { FAIL=$((FAIL+1)); RESULTS+="✗ $1 — $2\n"; }

restart_server() {
  pkill -f "next" 2>/dev/null
  sleep 3
  nohup node --max-old-space-size=2048 node_modules/.bin/next start -p 3000 > dev.log 2>&1 &
  sleep 10
}

echo "=== Forge Test Suite ==="
echo

# --- Test 1: Server starts ---
restart_server
if curl -s -o /dev/null -w "%{http_code}" $BASE/ | grep -q 200; then
  pass "Server starts"
else
  fail "Server starts" "no response"
fi

# --- Test 2: Stats API ---
if curl -s $BASE/api/forge/stats | python3 -c "import json,sys;d=json.load(sys.stdin);assert d['projects']>=0" 2>/dev/null; then
  pass "Stats API returns data"
else
  fail "Stats API" "no data"
fi

# --- Test 3: Upload Python ---
restart_server
PY_RESP=$(curl -s -X POST -F "file=@/tmp/py-app.zip" $BASE/api/forge/upload 2>/dev/null)
PY_ID=$(echo "$PY_RESP" | python3 -c "import json,sys;print(json.load(sys.stdin)['project']['id'])" 2>/dev/null)
PY_KIND=$(echo "$PY_RESP" | python3 -c "import json,sys;print(json.load(sys.stdin)['project']['kind'])" 2>/dev/null)
if [[ -n "$PY_ID" && "$PY_KIND" == "python" ]]; then
  pass "Upload Python → detected as python"
else
  fail "Upload Python" "got kind=$PY_KIND"
fi

# --- Test 4: Python intent ---
restart_server
INTENT=$(curl -s $BASE/api/forge/projects/$PY_ID/intent 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['intent'])" 2>/dev/null)
if [[ "$INTENT" == "test-suite" || "$INTENT" == "library" ]]; then
  pass "Python intent detected: $INTENT"
else
  fail "Python intent" "got $INTENT"
fi

# --- Test 5: AI fast path — "run tests" ---
restart_server
AI_RESP=$(curl -s -X POST $BASE/api/forge/ai-assistant -H 'content-type: application/json' -d "{\"message\":\"run tests\",\"projects\":[{\"id\":\"$PY_ID\",\"name\":\"py-app\",\"kind\":\"python\",\"fileName\":\"py-app.zip\"}]}" 2>/dev/null)
AI_ACTION=$(echo "$AI_RESP" | python3 -c "import json,sys;print(json.load(sys.stdin)['action'])" 2>/dev/null)
AI_WF=$(echo "$AI_RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('workflow',''))" 2>/dev/null)
if [[ "$AI_ACTION" == "run-workflow" && "$AI_WF" == "test" ]]; then
  pass "AI: 'run tests' → run-workflow: test"
else
  fail "AI run tests" "got action=$AI_ACTION wf=$AI_WF"
fi

# --- Test 6: AI fast path — "security audit" ---
restart_server
AI_RESP=$(curl -s -X POST $BASE/api/forge/ai-assistant -H 'content-type: application/json' -d "{\"message\":\"security audit\",\"projects\":[{\"id\":\"$PY_ID\",\"name\":\"py-app\",\"kind\":\"python\",\"fileName\":\"py-app.zip\"}]}" 2>/dev/null)
AI_WF=$(echo "$AI_RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('workflow',''))" 2>/dev/null)
if [[ "$AI_WF" == "security-scan" ]]; then
  pass "AI: 'security audit' → security-scan"
else
  fail "AI security" "got wf=$AI_WF"
fi

# --- Test 7: AI fast path — "show projects" ---
restart_server
AI_RESP=$(curl -s -X POST $BASE/api/forge/ai-assistant -H 'content-type: application/json' -d '{"message":"show my projects","projects":[]}' 2>/dev/null)
AI_TARGET=$(echo "$AI_RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('target',''))" 2>/dev/null)
if [[ "$AI_TARGET" == "home" ]]; then
  pass "AI: 'show projects' → navigate: home"
else
  fail "AI navigate" "got target=$AI_TARGET"
fi

# --- Test 8: Badge SVG ---
restart_server
BADGE_TYPE=$(curl -s -o /dev/null -w "%{content_type}" $BASE/api/forge/projects/$PY_ID/badge 2>/dev/null)
if [[ "$BADGE_TYPE" == *"svg"* ]]; then
  pass "Badge returns SVG"
else
  fail "Badge" "got type=$BADGE_TYPE"
fi

# --- Test 9: API token create ---
restart_server
TOKEN_RESP=$(curl -s -X POST $BASE/api/forge/tokens -H 'content-type: application/json' -d '{"name":"test-bot","scopes":"read"}' 2>/dev/null)
TOKEN_VAL=$(echo "$TOKEN_RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
if [[ "$TOKEN_VAL" == fk_* ]]; then
  pass "API token created: ${TOKEN_VAL:0:11}…"
else
  fail "API token" "got $TOKEN_VAL"
fi

# --- Test 10: Scheduled run create ---
restart_server
SCHED_RESP=$(curl -s -X POST $BASE/api/forge/projects/$PY_ID/scheduled-runs -H 'content-type: application/json' -d '{"workflow":"inspect","cron":"0 9 * * 1-5"}' 2>/dev/null)
SCHED_NEXT=$(echo "$SCHED_RESP" | python3 -c "import json,sys;print(json.load(sys.stdin)['schedule']['nextRunAt'][:10])" 2>/dev/null)
if [[ -n "$SCHED_NEXT" ]]; then
  pass "Scheduled run created (next: $SCHED_NEXT)"
else
  fail "Scheduled run" "no nextRunAt"
fi

echo
echo "=== Results ==="
echo -e "$RESULTS"
echo "Passed: $PASS / $((PASS+FAIL))"
echo "Failed: $FAIL / $((PASS+FAIL))"
