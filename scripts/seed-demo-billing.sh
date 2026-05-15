#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MODE="${1:---dry-run}"

timestamp() {
  date +"%Y-%m-%d %H:%M:%S"
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*"
}

fail() {
  printf '[%s] ERROR: %s\n' "$(timestamp)" "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  scripts/seed-demo-billing.sh --dry-run
  scripts/seed-demo-billing.sh --apply

Defaults:
  DEMO_TENANT_SLUG=aiot
  DEMO_TENANT_NAME=AIoT
  DEMO_USER_EMAIL=aiot@redtea.com
  DEMO_USER_PASSWORD=admin123

Environment overrides are supported before the command, for example:
  DEMO_DAYS=45 scripts/seed-demo-billing.sh --apply
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

case "$MODE" in
  --dry-run)
    ;;
  --apply)
    export DEMO_BILLING_SEED_APPLY="${DEMO_BILLING_SEED_APPLY:-YES}"
    export DEMO_ALLOW_PROD_LIKE="${DEMO_ALLOW_PROD_LIKE:-YES}"
    export DEMO_RESET_USER_PASSWORD="${DEMO_RESET_USER_PASSWORD:-YES}"
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage
    fail "unknown mode: $MODE"
    ;;
esac

require_command npm
require_command mvn

[[ -d "$APP_DIR" ]] || fail "app directory does not exist: $APP_DIR"
cd "$APP_DIR"

[[ -f "package.json" ]] || fail "package.json not found in $APP_DIR"
[[ -f "backend-java/pom.xml" ]] || fail "backend-java/pom.xml not found in $APP_DIR"

export DEMO_BILLING_SEED_CONFIRM="${DEMO_BILLING_SEED_CONFIRM:-YES}"
export DEMO_TENANT_SLUG="${DEMO_TENANT_SLUG:-aiot}"
export DEMO_TENANT_NAME="${DEMO_TENANT_NAME:-AIoT}"
export DEMO_USER_EMAIL="${DEMO_USER_EMAIL:-aiot@redtea.com}"
export DEMO_USER_PASSWORD="${DEMO_USER_PASSWORD:-admin123}"

log "running demo billing seed in $APP_DIR"
log "mode: $MODE"
log "tenant: ${DEMO_TENANT_NAME} (${DEMO_TENANT_SLUG})"
log "user: ${DEMO_USER_EMAIL}"

if [[ "$MODE" == "--apply" ]]; then
  log "apply mode will write demo usage, billing, recharge, and invoice rows"
else
  log "dry-run mode will not write database rows"
fi

npm run seed:demo-billing
