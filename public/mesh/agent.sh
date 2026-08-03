#!/usr/bin/env bash
# ============================================================
# Forge Mesh agent — runs on any node (Linux / Termux).
# Connects OUTBOUND to the Forge control plane; no inbound
# ports required. Works behind NAT, CGNAT and mobile data.
#
# Required env: FORGE_URL, NODE_SLUG, NODE_SECRET
# Optional:     FORGE_PUBLISH_DIR (default ~/.forge-node/sites)
#               FORGE_AGENT_INTERVAL (default 20s)
#               FORGE_AGENT_ALLOW_COMMANDS=1 (enables run_command)
# ============================================================
set -u

FORGE_URL="${FORGE_URL:?FORGE_URL is required (e.g. https://forge.example.com)}"
NODE_SLUG="${NODE_SLUG:?NODE_SLUG is required}"
NODE_SECRET="${NODE_SECRET:?NODE_SECRET is required}"
FORGE_PUBLISH_DIR="${FORGE_PUBLISH_DIR:-$HOME/.forge-node/sites}"
INTERVAL="${FORGE_AGENT_INTERVAL:-20}"
AGENT_VERSION="0.1.0"

FORGE_URL="${FORGE_URL%/}"
API="$FORGE_URL/api/forge/nodes/$NODE_SLUG"
mkdir -p "$FORGE_PUBLISH_DIR"

# --- capability detection ---
CAPS='["static"]'
if command -v node >/dev/null 2>&1; then CAPS='["static","node"]'; fi
if command -v docker >/dev/null 2>&1; then CAPS='["static","node","docker"]'; fi

is_termux=0
case "${PREFIX:-}" in *com.termux*) is_termux=1 ;; esac

log() { printf '[forge-agent %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

api() { # api METHOD PATH [JSON_BODY]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -m 30 -X "$method" "$API$path" \
      -H "x-forge-node-secret: $NODE_SECRET" \
      -H 'content-type: application/json' \
      -d "$body" 2>/dev/null
  else
    curl -fsS -m 30 -X "$method" "$API$path" \
      -H "x-forge-node-secret: $NODE_SECRET" 2>/dev/null
  fi
}

verify_checksum() { # file expected_sha256 (empty expected = skip)
  local file="$1" expected="$2"
  [ -z "$expected" ] && return 0
  local actual=""
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | cut -d' ' -f1)"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$file" | cut -d' ' -f1)"
  fi
  [ -n "$actual" ] && [ "$actual" = "$expected" ]
}

run_task_deploy_static() { # task_json
  local task="$1"
  local url version sha256 site
  url="$(printf '%s' "$task" | jq -r '.payload.url // empty')"
  version="$(printf '%s' "$task" | jq -r '.payload.version // "unknown"' | tr -cd 'a-zA-Z0-9._-')"
  sha256="$(printf '%s' "$task" | jq -r '.payload.sha256 // empty')"
  site="$(printf '%s' "$task" | jq -r '.payload.site // "default"' | tr -cd 'a-zA-Z0-9._-')"
  [ -z "$site" ] && site="default"
  [ -z "$url" ] && { echo "missing payload.url"; return 1; }

  local base="$FORGE_PUBLISH_DIR/$site"
  local releases="$base/releases"
  local target="$releases/$version"
  local tmp archive
  tmp="$(mktemp -d)"
  archive="$tmp/release.tgz"

  log "deploy_static site=$site version=$version"
  if ! curl -fsSL -m 600 -o "$archive" "$url"; then
    echo "download failed"; rm -rf "$tmp"; return 1
  fi
  if ! verify_checksum "$archive" "$sha256"; then
    echo "checksum mismatch"; rm -rf "$tmp"; return 1
  fi

  mkdir -p "$target"
  if tar -tzf "$archive" >/dev/null 2>&1; then
    if ! tar -xzf "$archive" -C "$target"; then
      echo "extract failed"; rm -rf "$tmp"; return 1
    fi
  else
    # single-file payload — serve as index.html
    cp "$archive" "$target/index.html"
  fi

  # atomic symlink swap (zero downtime)
  ln -sfn "$target" "$base/current.tmp.$$" && mv -f "$base/current.tmp.$$" "$base/current"

  # prune old releases — keep newest 5
  ls -1t "$releases" 2>/dev/null | tail -n +6 | while read -r old; do
    rm -rf "$releases/$old"
  done

  rm -rf "$tmp"
  echo "deployed site=$site version=$version path=$base/current"
}

report() { # task_id status result error
  local task_id="$1" status="$2" result="${3:-}" error="${4:-}"
  local body
  body="$(jq -n --arg s "$status" --arg r "$result" --arg e "$error" \
    '{status:$s, result:$r, error:$e}')"
  api POST "/tasks/$task_id" "$body" >/dev/null || true
}

log "started slug=$NODE_SLUG url=$FORGE_URL caps=$CAPS termux=$is_termux"

while true; do
  hb_body="$(jq -n --argjson caps "$CAPS" --arg v "$AGENT_VERSION" \
    '{status:"idle", capabilities:$caps, version:$v, labels:{}}' 2>/dev/null || echo '{}')"
  resp="$(api POST "/heartbeat" "$hb_body")"
  if [ -n "$resp" ]; then
    count="$(printf '%s' "$resp" | jq -r '.data.tasks | length' 2>/dev/null || echo 0)"
    case "$count" in ''|*[!0-9]*) count=0 ;; esac
    if [ "$count" -gt 0 ]; then
      i=0
      while [ "$i" -lt "$count" ]; do
        task="$(printf '%s' "$resp" | jq -c ".data.tasks[$i]")"
        task_id="$(printf '%s' "$task" | jq -r '.id')"
        kind="$(printf '%s' "$task" | jq -r '.kind')"
        out=""; rc=0
        case "$kind" in
          deploy_static)
            out="$(run_task_deploy_static "$task" 2>&1)" || rc=$? ;;
          run_command)
            if [ "${FORGE_AGENT_ALLOW_COMMANDS:-0}" = "1" ]; then
              cmd="$(printf '%s' "$task" | jq -r '.payload.command // empty')"
              out="$(bash -c "$cmd" 2>&1 | tail -c 3000)" || rc=$?
            else
              out="run_command disabled (set FORGE_AGENT_ALLOW_COMMANDS=1)"; rc=1
            fi ;;
          *)
            out="unsupported task kind: $kind"; rc=1 ;;
        esac
        if [ "$rc" -eq 0 ]; then
          report "$task_id" done "$out"
          log "task $task_id ($kind) done"
        else
          report "$task_id" failed "" "$out"
          log "task $task_id ($kind) failed"
        fi
        i=$((i + 1))
      done
    fi
  else
    log "heartbeat failed — retrying in ${INTERVAL}s"
  fi
  sleep "$INTERVAL"
done
