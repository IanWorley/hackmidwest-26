#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
VERIFY_ROOT="${VERIFY_ROOT:-/tmp/verify-hackmidwest}"
TOOLS_DIR="${VERIFY_TOOLS_DIR:-$HOME/.cache/verify-hackmidwest/tools}"
PLAYWRIGHT_VERSION="1.64.0"
READY_TIMEOUT_SECONDS=90
STOP_TIMEOUT_SECONDS=10
READY_POLL_SECONDS=1
STOP_POLL_SECONDS=0.5
LOG_TAIL_LINES=40
HOST="localhost"
APP_TITLE="Hack Midwest tasks"
TASKS_API_PATH="/api/tasks"
TASKS_PAGE_PATH="/tasks"

die() { echo "verify: $*" >&2; exit 1; }

run_dir() { echo "$VERIFY_ROOT/runs/$1"; }
artifact_dir() { echo "$VERIFY_ROOT/artifacts/$1"; }

require_run() {
  [[ -n "${RUN_ID:-}" ]] || die "RUN_ID is required (printed by 'verify.sh up'; see 'verify.sh list')"
  [[ -f "$(run_dir "$RUN_ID")/state.env" ]] || die "no live run '$RUN_ID' under $VERIFY_ROOT/runs"
  # shellcheck disable=SC1091
  source "$(run_dir "$RUN_ID")/state.env"
}

free_port() {
  bun -e 'const s = Bun.serve({ port: 0, fetch: () => new Response() }); console.log(s.port); s.stop(true);'
}

cmd_setup() {
  (cd "$REPO_ROOT" && bun install --frozen-lockfile)
  mkdir -p "$TOOLS_DIR"
  if [[ ! -f "$TOOLS_DIR/node_modules/playwright/package.json" ]]; then
    echo '{"private":true,"type":"module"}' > "$TOOLS_DIR/package.json"
    (cd "$TOOLS_DIR" && npm install --no-fund --no-audit "playwright@$PLAYWRIGHT_VERSION")
  fi
  (cd "$TOOLS_DIR" && npx playwright install --with-deps chromium)
}

cmd_up() {
  RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}"
  local dir art api_port web_port
  dir="$(run_dir "$RUN_ID")"
  art="$(artifact_dir "$RUN_ID")"
  [[ ! -e "$dir" ]] || die "run '$RUN_ID' already exists"
  mkdir -p "$dir" "$art"
  api_port="$(free_port)"
  web_port="$(free_port)"
  [[ "$api_port" != "$web_port" ]] || web_port="$(free_port)"

  # Shell env overrides the root .env that the package scripts load, so no repo file is written.
  export API_PORT="$api_port"
  export WEB_ORIGIN="http://$HOST:$web_port"
  export DB_PATH="$dir/db.sqlite"
  export VITE_API_BASE_URL="http://$HOST:$api_port"

  (cd "$REPO_ROOT" && bun run db:migrate && bun run db:seed) > "$dir/setup.log" 2>&1 \
    || { cat "$dir/setup.log" >&2; die "migrate/seed failed"; }

  # Backgrounding setsid directly (no subshell) makes $! the new group's leader, so PID == PGID.
  setsid bun run --cwd "$REPO_ROOT" dev > "$dir/dev.log" 2>&1 < /dev/null &
  local pgid=$!

  cat > "$dir/state.env" <<EOF
RUN_ID=$RUN_ID
PGID=$pgid
API_PORT=$api_port
WEB_PORT=$web_port
API_URL=http://$HOST:$api_port
WEB_URL=http://$HOST:$web_port
DB_PATH=$dir/db.sqlite
ARTIFACTS=$art
GIT_REV=$(git -C "$REPO_ROOT" rev-parse --short HEAD)
EOF

  local deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
  until curl -sf "http://$HOST:$api_port$TASKS_API_PATH" > /dev/null \
     && curl -sf "http://$HOST:$web_port$TASKS_PAGE_PATH" | grep -q "<title>$APP_TITLE</title>"; do
    if ! kill -0 "$pgid" 2> /dev/null || (( SECONDS > deadline )); then
      tail -"$LOG_TAIL_LINES" "$dir/dev.log" >&2
      RUN_ID="$RUN_ID" cmd_down > /dev/null 2>&1 || true
      die "instance did not become ready (log tail above)"
    fi
    sleep "$READY_POLL_SECONDS"
  done
  echo "ready RUN_ID=$RUN_ID"
  cat "$dir/state.env"
}

cmd_doctor() {
  require_run
  local ok=1
  check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; ok=0; fi; }
  owns_port() {
    local pid
    pid="$(ss -ltnpH "sport = :$1" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)"
    [[ -n "$pid" && "$(ps -o pgid= -p "$pid" | tr -d ' ')" == "$PGID" ]]
  }
  check "process group $PGID alive" "kill -0 -- -$PGID 2> /dev/null"
  check "API port $API_PORT owned by this run" "owns_port $API_PORT"
  check "web port $WEB_PORT owned by this run" "owns_port $WEB_PORT"
  check "GET $API_URL$TASKS_API_PATH returns a JSON array" \
    "curl -sf '$API_URL$TASKS_API_PATH' | jq -e 'type == \"array\"' > /dev/null"
  check "GET $WEB_URL$TASKS_PAGE_PATH serves '$APP_TITLE'" \
    "curl -sf '$WEB_URL$TASKS_PAGE_PATH' | grep -q '<title>$APP_TITLE</title>'"
  check "database file exists at $DB_PATH" "[[ -f '$DB_PATH' ]]"
  local head
  head="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  check "checkout HEAD $head matches launch rev $GIT_REV" "[[ '$head' == '$GIT_REV' ]]"
  echo "working tree: $(git -C "$REPO_ROOT" status --porcelain | wc -l | tr -d ' ') changed paths (dev server hot-reloads them)"
  (( ok )) || exit 1
}

cmd_api() {
  (( $# >= 3 )) || die "usage: RUN_ID=<id> verify.sh api <name> <METHOD> <path> [json-body]"
  require_run
  local name="$1" method="$2" path="$3" body="${4:-}"
  local out="$ARTIFACTS/$name.http.txt"
  local args=(-s -i -X "$method" "$API_URL$path")
  [[ -z "$body" ]] || args+=(-H "content-type: application/json" --data "$body")
  {
    echo "> $method $API_URL$path"
    [[ -z "$body" ]] || echo "> $body"
    echo
    curl "${args[@]}"
    echo
  } > "$out"
  cat "$out"
  echo "saved $out"
}

cmd_db() {
  (( $# == 2 )) || die "usage: RUN_ID=<id> verify.sh db <name> \"<sql>\""
  require_run
  local name="$1" sql="$2"
  local out="$ARTIFACTS/$name.db.txt"
  { echo "sql> $sql"; sqlite3 -readonly -header "$DB_PATH" "$sql"; } > "$out"
  cat "$out"
  echo "saved $out"
}

cmd_browser() {
  require_run
  WEB_URL="$WEB_URL" API_URL="$API_URL" ARTIFACTS="$ARTIFACTS" TOOLS_DIR="$TOOLS_DIR" \
    node "$SCRIPT_DIR/browser.mjs" "$@"
}

cmd_down() {
  require_run
  if kill -0 -- "-$PGID" 2> /dev/null; then
    kill -TERM -- "-$PGID" 2> /dev/null || true
    local deadline=$((SECONDS + STOP_TIMEOUT_SECONDS))
    while kill -0 -- "-$PGID" 2> /dev/null && (( SECONDS < deadline )); do sleep "$STOP_POLL_SECONDS"; done
    kill -KILL -- "-$PGID" 2> /dev/null || true
  fi
  local dir
  dir="$(run_dir "$RUN_ID")"
  cp "$dir"/*.log "$ARTIFACTS/" 2> /dev/null || true
  rm -rf "$dir"
  echo "stopped RUN_ID=$RUN_ID; evidence kept in $ARTIFACTS"
}

cmd_list() {
  ls -1 "$VERIFY_ROOT/runs" 2> /dev/null || true
}

case "${1:-}" in
  setup) cmd_setup ;;
  up) cmd_up ;;
  doctor) cmd_doctor ;;
  api) shift; cmd_api "$@" ;;
  db) shift; cmd_db "$@" ;;
  browser) shift; cmd_browser "$@" ;;
  down) cmd_down ;;
  list) cmd_list ;;
  *) die "usage: verify.sh setup | up | doctor | api | db | browser | down | list (see SKILL.md)" ;;
esac
