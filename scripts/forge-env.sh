#!/usr/bin/env bash
# ============================================================
# Forge environment provisioner — sovereign + idempotent.
#
#   bash scripts/forge-env.sh
#
# Installs every runtime Forge needs so it can run everything
# on its own infrastructure (no paid cloud, no vendor lock-in):
#
#   basics      git curl unzip ca-certificates
#   bun         primary JS/TS runtime (Forge + builds)
#   node/npm    fallback runtime + tooling
#   python3/uv  Python runtime builds (.zscripts/python-runtime-build.sh)
#   docker      optional — enables the isolated container path
#
# Safe to re-run: only installs what is missing, never downgrades.
# Works on Debian/Ubuntu, Fedora, Alpine, Termux (Android) and macOS.
# ============================================================
set -uo pipefail

log()  { printf '\033[1;32m[forge-env]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[forge-env]\033[0m %s\n' "$*"; }

SUDO=""
if [ "$(id -u 2>/dev/null || echo 1)" != "0" ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

IS_TERMUX=0
if [ -n "${PREFIX:-}" ]; then case "$PREFIX" in *com.termux*) IS_TERMUX=1 ;; esac; fi

PKGMGR=""
if   command -v apt-get >/dev/null 2>&1; then PKGMGR="apt"
elif command -v dnf     >/dev/null 2>&1; then PKGMGR="dnf"
elif command -v yum     >/dev/null 2>&1; then PKGMGR="yum"
elif command -v apk     >/dev/null 2>&1; then PKGMGR="apk"
elif command -v brew    >/dev/null 2>&1; then PKGMGR="brew"
elif command -v pkg     >/dev/null 2>&1 && [ "$IS_TERMUX" = "1" ]; then PKGMGR="termux"
fi
log "Package manager: ${PKGMGR:-none detected}"

install_pkg() {
  case "$PKGMGR" in
    apt)    $SUDO apt-get update -y >/dev/null 2>&1; $SUDO apt-get install -y "$@" >/dev/null 2>&1 ;;
    dnf)    $SUDO dnf install -y "$@" >/dev/null 2>&1 ;;
    yum)    $SUDO yum install -y "$@" >/dev/null 2>&1 ;;
    apk)    $SUDO apk add --no-cache "$@" >/dev/null 2>&1 ;;
    brew)   brew install "$@" >/dev/null 2>&1 ;;
    termux) pkg install -y "$@" >/dev/null 2>&1 ;;
    *)      warn "No package manager — cannot install: $*"; return 1 ;;
  esac
}

# ---- 1/5 basics ------------------------------------------------
log "Step 1/5 — basics (git curl unzip)"
missing=""
for t in git curl unzip; do
  command -v "$t" >/dev/null 2>&1 || missing="$missing $t"
done
if [ -n "$missing" ]; then
  install_pkg $missing ca-certificates || warn "could not install:$missing"
else
  log "basics already present"
fi

# ---- 2/5 bun ---------------------------------------------------
log "Step 2/5 — bun"
if command -v bun >/dev/null 2>&1; then
  log "bun already present: $(bun --version 2>/dev/null)"
else
  if [ "$IS_TERMUX" = "1" ]; then
    warn "bun unsupported on Termux — relying on node"
  else
    curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 || warn "bun installer failed"
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"
    if command -v bun >/dev/null 2>&1; then log "bun installed: $(bun --version)"; else warn "bun still missing"; fi
  fi
fi

# ---- 3/5 node + npm -------------------------------------------
log "Step 3/5 — node/npm"
if command -v node >/dev/null 2>&1; then
  log "node already present: $(node --version 2>/dev/null)"
else
  install_pkg nodejs npm || install_pkg nodejs || warn "could not install node"
  if command -v node >/dev/null 2>&1; then log "node installed: $(node --version)"; else warn "node still missing"; fi
fi

# ---- 4/5 python3 + uv (python runtime builds) ------------------
log "Step 4/5 — python3 + uv"
if command -v python3 >/dev/null 2>&1; then
  log "python3 already present: $(python3 --version 2>&1)"
else
  install_pkg python3 python3-venv || install_pkg python3 || warn "could not install python3"
fi
if command -v uv >/dev/null 2>&1; then
  log "uv already present: $(uv --version 2>/dev/null)"
else
  curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || warn "uv installer failed"
  export PATH="$HOME/.local/bin:$PATH"
  if command -v uv >/dev/null 2>&1; then log "uv installed: $(uv --version)"; else warn "uv still missing (python builds limited)"; fi
fi

# ---- 5/5 docker (optional, best effort) ------------------------
log "Step 5/5 — docker (optional)"
if command -v docker >/dev/null 2>&1; then
  log "docker already present: $(docker --version 2>/dev/null)"
else
  if [ "$IS_TERMUX" = "1" ]; then
    warn "docker unavailable on Termux — native path works without it"
  elif install_pkg docker; then
    log "docker installed via package manager"
  elif curl -fsSL https://get.docker.com | sh >/dev/null 2>&1; then
    log "docker installed via get.docker.com"
  else
    warn "docker unavailable — native path still works without it"
  fi
fi

# ---- summary ----------------------------------------------------
echo ""
log "Environment summary:"
for t in git curl unzip bun node python3 uv docker; do
  if command -v "$t" >/dev/null 2>&1; then
    printf '  \033[1;32mOK\033[0m   %-8s %s\n' "$t" "$($t --version 2>/dev/null | head -n1)"
  else
    printf '  \033[1;31mMISS\033[0m %-8s\n' "$t"
  fi
done
echo ""
log "Environment ready. Next: bash scripts/forge-up.sh"
