#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

APP_DIR="${APP_DIR:-/srv/taas/app/TaaS}"
BRANCH="${1:-${BRANCH:-prod}}"
BACKEND_SERVICE="${BACKEND_SERVICE:-taas-backend}"
BACKEND_JAR_SOURCE_REL="${BACKEND_JAR_SOURCE_REL:-backend-java/target/backend-java-0.0.1-SNAPSHOT.jar}"
BACKEND_JAR_TARGET="${BACKEND_JAR_TARGET:-/srv/taas/backend/current/app.jar}"
FRONTEND_DIST_REL="${FRONTEND_DIST_REL:-client/dist}"
FRONTEND_TARGET="${FRONTEND_TARGET:-/srv/taas/frontend/current}"
HEALTH_LIVE_URL="${HEALTH_LIVE_URL:-http://127.0.0.1:3001/health/live}"
HEALTH_READY_URL="${HEALTH_READY_URL:-http://127.0.0.1:3001/health}"
PUBLIC_CHECK_URL="${PUBLIC_CHECK_URL:-http://8.219.108.49}"
DOCKER_SERVICES="${DOCKER_SERVICES:-postgres redis}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_SLEEP_SECONDS="${HEALTH_SLEEP_SECONDS:-2}"
SKIP_NPM_INSTALL="${SKIP_NPM_INSTALL:-0}"

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

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

wait_for_http_ok() {
  local url="$1"
  local label="$2"
  local attempt

  for ((attempt = 1; attempt <= HEALTH_RETRIES; attempt++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "$label is healthy: $url"
      return 0
    fi
    sleep "$HEALTH_SLEEP_SECONDS"
  done

  return 1
}

on_error() {
  local exit_code="$1"
  local line_no="$2"
  printf '[%s] ERROR: deploy failed at line %s (exit code %s)\n' "$(timestamp)" "$line_no" "$exit_code" >&2
}

trap 'on_error "$?" "$LINENO"' ERR

if [[ "${EUID}" -ne 0 ]]; then
  fail "please run this script as root (for systemctl, nginx reload, and publish directories)"
fi

require_command git
require_command docker
require_command mvn
require_command npm
require_command curl
require_command systemctl
require_command nginx

[[ -d "$APP_DIR" ]] || fail "app directory does not exist: $APP_DIR"

cd "$APP_DIR"

log "deploying branch '$BRANCH' in $APP_DIR"
log "current commit: $(git rev-parse --short HEAD)"

log "updating source code"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [[ -n "$DOCKER_SERVICES" ]]; then
  IFS=' ' read -r -a docker_service_args <<<"$DOCKER_SERVICES"
  log "ensuring docker compose services are running (${#docker_service_args[@]}): ${docker_service_args[*]}"
  docker compose up -d "${docker_service_args[@]}"
fi

if [[ -f "$APP_DIR/.env" ]]; then
  log "loading environment variables from .env"
  set -a
  # shellcheck disable=SC1091
  source "$APP_DIR/.env"
  set +a
else
  log "warning: .env not found, continuing with current environment"
fi

log "building backend jar"
mvn -f backend-java/pom.xml -DskipTests package

BACKEND_JAR_SOURCE="$APP_DIR/$BACKEND_JAR_SOURCE_REL"
[[ -f "$BACKEND_JAR_SOURCE" ]] || fail "backend jar not found: $BACKEND_JAR_SOURCE"

mkdir -p "$(dirname "$BACKEND_JAR_TARGET")"
if [[ -f "$BACKEND_JAR_TARGET" ]]; then
  BACKEND_BACKUP="${BACKEND_JAR_TARGET}.$(date +%Y%m%d%H%M%S).bak"
  cp "$BACKEND_JAR_TARGET" "$BACKEND_BACKUP"
  log "backed up current backend jar to $BACKEND_BACKUP"
fi

cp "$BACKEND_JAR_SOURCE" "$BACKEND_JAR_TARGET"
log "published backend jar to $BACKEND_JAR_TARGET"

log "restarting backend service: $BACKEND_SERVICE"
systemctl restart "$BACKEND_SERVICE"

if ! wait_for_http_ok "$HEALTH_LIVE_URL" "backend live check"; then
  journalctl -u "$BACKEND_SERVICE" -n 80 --no-pager || true
  fail "backend live health check failed: $HEALTH_LIVE_URL"
fi

if ! wait_for_http_ok "$HEALTH_READY_URL" "backend health check"; then
  journalctl -u "$BACKEND_SERVICE" -n 80 --no-pager || true
  fail "backend readiness health check failed: $HEALTH_READY_URL"
fi

if [[ "$SKIP_NPM_INSTALL" != "1" ]]; then
  log "installing frontend dependencies"
  npm install --prefix client
else
  log "skipping frontend dependency install because SKIP_NPM_INSTALL=1"
fi

log "building frontend"
npm run build --prefix client

FRONTEND_DIST="$APP_DIR/$FRONTEND_DIST_REL"
[[ -d "$FRONTEND_DIST" ]] || fail "frontend dist directory not found: $FRONTEND_DIST"

TMP_FRONTEND_DIR="$(mktemp -d)"
cp -R "$FRONTEND_DIST"/. "$TMP_FRONTEND_DIR"/

mkdir -p "$FRONTEND_TARGET"
rm -rf "${FRONTEND_TARGET:?}/"*
cp -R "$TMP_FRONTEND_DIR"/. "$FRONTEND_TARGET"/
rm -rf "$TMP_FRONTEND_DIR"

log "published frontend assets to $FRONTEND_TARGET"

log "validating nginx config"
nginx -t

log "reloading nginx"
systemctl reload nginx

if [[ -n "$PUBLIC_CHECK_URL" ]]; then
  log "checking public entrypoint"
  curl -fsSI "$PUBLIC_CHECK_URL" >/dev/null
fi

log "deployment completed successfully"
log "backend health: $HEALTH_READY_URL"
if [[ -n "$PUBLIC_CHECK_URL" ]]; then
  log "public check: $PUBLIC_CHECK_URL"
fi
