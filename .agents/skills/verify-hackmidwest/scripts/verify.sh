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
NWS_USER_AGENT_VALUE="(verify-hackmidwest, verify@example.com)"
TASKS_PAGE_TITLE="Tasks · Hack Midwest"
TASKS_API_PATH="/api/tasks"
TASKS_PAGE_PATH="/tasks"
AGENT_HEALTH_PATH="/health"
EVIDENCE_BRANCH="verification-evidence"
EVIDENCE_PATTERNS=("*.png" "*.aria.yml" "*.http.txt" "*.db.txt" "browser.log" "run.env")
GIT_FILE_MODE="100644"
STORAGE_HEALTHY="healthy"
STORAGE_BROKEN="broken"
BROKEN_DB_CONTENT="verify-hackmidwest: not a SQLite database"
HTTP_STATUS_OK="200"
HTTP_STATUS_INTERNAL_ERROR="500"
LLM_MODE="template"

die() { echo "verify: $*" >&2; exit 1; }

run_dir() { echo "$VERIFY_ROOT/runs/$1"; }
artifact_dir() { echo "$VERIFY_ROOT/artifacts/$1"; }

require_run() {
  [[ -n "${RUN_ID:-}" ]] || die "RUN_ID is required (printed by 'verify.sh up'; see 'verify.sh list')"
  [[ -f "$(run_dir "$RUN_ID")/state.env" ]] || die "no live run '$RUN_ID' under $VERIFY_ROOT/runs"
  # shellcheck disable=SC1091
  source "$(run_dir "$RUN_ID")/state.env"
}

# Matching the exact status keeps a healthy run from accepting an SSR error page that still has the title.
serves_app() {
  local response
  response="$(curl -s -w '\n%{http_code}' "$1")"
  [[ "${response##*$'\n'}" == "$2" ]] && grep -q "<title>$TASKS_PAGE_TITLE</title>" <<< "$response"
}

# Exec "$@" as the leader of a new session, keeping the caller's PID, so PID == PGID for `down`.
# macOS ships no setsid binary; perl's POSIX::setsid does the same there.
start_session() {
  if command -v setsid > /dev/null; then
    exec setsid "$@"
  fi
  exec perl -MPOSIX -e 'POSIX::setsid() != -1 or die "setsid: $!"; exec @ARGV or die "exec: $!"' "$@"
}

# macOS has no ss; lsof is the portable fallback.
listener_pid() {
  if command -v ss > /dev/null; then
    ss -ltnpH "sport = :$1" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
  else
    lsof -nP -iTCP:"$1" -sTCP:LISTEN -t | head -1
  fi
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
  local dir art api_port web_port agent_port
  dir="$(run_dir "$RUN_ID")"
  art="$(artifact_dir "$RUN_ID")"
  [[ ! -e "$dir" ]] || die "run '$RUN_ID' already exists"
  local storage="${STORAGE:-$STORAGE_HEALTHY}" expected_status
  case "$storage" in
    "$STORAGE_HEALTHY") expected_status="$HTTP_STATUS_OK" ;;
    "$STORAGE_BROKEN") expected_status="$HTTP_STATUS_INTERNAL_ERROR" ;;
    *) die "STORAGE must be '$STORAGE_HEALTHY' or '$STORAGE_BROKEN'" ;;
  esac
  mkdir -p "$dir" "$art"
  api_port="$(free_port)"
  web_port="$(free_port)"
  [[ "$api_port" != "$web_port" ]] || web_port="$(free_port)"
  agent_port="$(free_port)"
  while [[ "$agent_port" == "$api_port" || "$agent_port" == "$web_port" ]]; do agent_port="$(free_port)"; done

  # Shell env overrides the root .env that the package scripts load, so no repo file is written.
  export API_PORT="$api_port"
  export AGENT_API_PORT="$agent_port"
  export TASKS_API_URL="http://$HOST:$api_port"
  export WEB_ORIGIN="http://$HOST:$web_port"
  export DB_PATH="$dir/db.sqlite"
  export VITE_API_BASE_URL="http://$HOST:$api_port"
  export NWS_USER_AGENT="$NWS_USER_AGENT_VALUE"
  # The agent API reads empty as unset, so a developer's .env key never makes a run call a billable model.
  export OPENROUTER_API_KEY=""
  export OPENROUTER_MODEL=""

  if [[ "$storage" == "$STORAGE_BROKEN" ]]; then
    # The API opens a file the harness wrote, so every query fails without editing a real database.
    echo "$BROKEN_DB_CONTENT" > "$DB_PATH"
    echo "storage=$STORAGE_BROKEN: skipped migrate/seed" > "$dir/setup.log"
  else
    (cd "$REPO_ROOT" && bun run db:migrate && bun run db:seed) > "$dir/setup.log" 2>&1 \
      || { cat "$dir/setup.log" >&2; die "migrate/seed failed"; }
  fi

  # start_session execs in place, so $! is the new group's leader and PID == PGID.
  start_session bun run --cwd "$REPO_ROOT" dev > "$dir/dev.log" 2>&1 < /dev/null &
  local pgid=$!

  cat > "$dir/state.env" <<EOF
RUN_ID=$RUN_ID
PGID=$pgid
API_PORT=$api_port
WEB_PORT=$web_port
AGENT_API_PORT=$agent_port
API_URL=http://$HOST:$api_port
WEB_URL=http://$HOST:$web_port
AGENT_API_URL=http://$HOST:$agent_port
DB_PATH=$dir/db.sqlite
STORAGE=$storage
EXPECTED_STATUS=$expected_status
LLM=$LLM_MODE
ARTIFACTS=$art
GIT_REV=$(git -C "$REPO_ROOT" rev-parse --short HEAD)
EOF
  cp "$dir/state.env" "$art/run.env"

  local deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
  until [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://$HOST:$api_port$TASKS_API_PATH")" == "$expected_status" ]] \
     && serves_app "http://$HOST:$web_port$TASKS_PAGE_PATH" "$expected_status" \
     && [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://$HOST:$agent_port$AGENT_HEALTH_PATH")" == "$HTTP_STATUS_OK" ]]; do
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
    pid="$(listener_pid "$1")"
    [[ -n "$pid" && "$(ps -o pgid= -p "$pid" | tr -d ' ')" == "$PGID" ]]
  }
  check "process group $PGID alive" "kill -0 -- -$PGID 2> /dev/null"
  check "API port $API_PORT owned by this run" "owns_port $API_PORT"
  check "web port $WEB_PORT owned by this run" "owns_port $WEB_PORT"
  check "agent API port $AGENT_API_PORT owned by this run" "owns_port $AGENT_API_PORT"
  if [[ "$STORAGE" == "$STORAGE_BROKEN" ]]; then
    check "GET $API_URL$TASKS_API_PATH answers $EXPECTED_STATUS (storage=$STORAGE)" \
      "[[ \"\$(curl -s -o /dev/null -w '%{http_code}' '$API_URL$TASKS_API_PATH')\" == '$EXPECTED_STATUS' ]]"
  else
    check "GET $API_URL$TASKS_API_PATH returns a JSON array" \
      "curl -sf '$API_URL$TASKS_API_PATH' | jq -e 'type == \"array\"' > /dev/null"
  fi
  check "GET $WEB_URL$TASKS_PAGE_PATH answers $EXPECTED_STATUS and serves '$TASKS_PAGE_TITLE'" \
    "serves_app '$WEB_URL$TASKS_PAGE_PATH' '$EXPECTED_STATUS'"
  check "GET $AGENT_API_URL$AGENT_HEALTH_PATH answers $HTTP_STATUS_OK" \
    "[[ \"\$(curl -s -o /dev/null -w '%{http_code}' '$AGENT_API_URL$AGENT_HEALTH_PATH')\" == '$HTTP_STATUS_OK' ]]"
  check "database file exists at $DB_PATH" "[[ -f '$DB_PATH' ]]"
  local head
  head="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  check "checkout HEAD $head matches launch rev $GIT_REV" "[[ '$head' == '$GIT_REV' ]]"
  echo "working tree: $(git -C "$REPO_ROOT" status --porcelain | wc -l | tr -d ' ') changed paths (dev server hot-reloads them)"
  (( ok )) || exit 1
}

send_request() {
  local base="$1" name="$2" method="$3" path="$4" body="${5:-}"
  local out="$ARTIFACTS/$name.http.txt"
  local args=(-s -i -X "$method" "$base$path")
  [[ -z "$body" ]] || args+=(-H "content-type: application/json" --data "$body")
  {
    echo "> $method $base$path"
    [[ -z "$body" ]] || echo "> $body"
    echo
    curl "${args[@]}"
    echo
  } > "$out"
  cat "$out"
  echo "saved $out"
}

cmd_api() {
  (( $# >= 3 )) || die "usage: RUN_ID=<id> verify.sh api <name> <METHOD> <path> [json-body]"
  require_run
  send_request "$API_URL" "$@"
}

cmd_agent() {
  (( $# >= 3 )) || die "usage: RUN_ID=<id> verify.sh agent <name> <METHOD> <path> [json-body]"
  require_run
  send_request "$AGENT_API_URL" "$@"
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

# Writes go to a .backup snapshot, never DB_PATH, so the instance keeps its seeded state for other recipes.
cmd_db_reject() {
  (( $# == 3 )) || die "usage: RUN_ID=<id> verify.sh db-reject <name> \"<write-sql>\" \"<expected-error>\""
  require_run
  local name="$1" sql="$2" expected="$3"
  local out="$ARTIFACTS/$name.db.txt"
  local probe
  probe="$(run_dir "$RUN_ID")/probe-$name.sqlite"
  sqlite3 -readonly "$DB_PATH" ".backup '$probe'"
  local before after error status=0
  before="$(sha256sum < "$probe")"
  error="$(sqlite3 -bail "$probe" "$sql" 2>&1 > /dev/null)" || status=$?
  after="$(sha256sum < "$probe")"
  rm -f "$probe"
  local verdict="FAIL"
  if (( status != 0 )) && [[ "$error" == *"$expected"* && "$before" == "$after" ]]; then verdict="rejected"; fi
  {
    echo "sql> $sql"
    echo "expect> $expected"
    echo "exit> $status"
    echo "error> $error"
    echo "snapshot unchanged> $([[ "$before" == "$after" ]] && echo yes || echo no)"
    echo "verdict> $verdict"
  } > "$out"
  cat "$out"
  echo "saved $out"
  [[ "$verdict" == "rejected" ]]
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

cmd_publish() {
  (( $# >= 1 && $# <= 2 )) || die "usage: RUN_ID=<id> verify.sh publish <pr-number> [summary.md]"
  [[ -n "${RUN_ID:-}" ]] || die "RUN_ID is required"
  local pr="$1" summary="${2:-}" art
  art="$(artifact_dir "$RUN_ID")"
  [[ -d "$art" ]] || die "no evidence at $art"
  [[ -z "$summary" || -f "$summary" ]] || die "summary file '$summary' not found"

  local files=() pattern candidate
  shopt -s nullglob
  # nullglob drops unmatched globs but keeps literal names such as browser.log, so check each file exists.
  for pattern in "${EVIDENCE_PATTERNS[@]}"; do
    for candidate in "$art"/$pattern; do
      if [[ -f "$candidate" ]]; then files+=("$candidate"); fi
    done
  done
  shopt -u nullglob
  (( ${#files[@]} )) || die "no evidence files in $art"

  # A private index commits straight to the evidence branch without touching any checkout,
  # which matters because other agents may share this working tree.
  local scratch parent="" prefix="pr-$pr/$RUN_ID" file blob tree commit repo
  scratch="$(mktemp -d)"
  export GIT_INDEX_FILE="$scratch/index"
  if git -C "$REPO_ROOT" fetch -q origin "$EVIDENCE_BRANCH" 2> /dev/null; then
    parent="$(git -C "$REPO_ROOT" rev-parse FETCH_HEAD)"
    git -C "$REPO_ROOT" read-tree "$parent"
  fi
  for file in "${files[@]}"; do
    blob="$(git -C "$REPO_ROOT" hash-object -w "$file")"
    git -C "$REPO_ROOT" update-index --add --cacheinfo "$GIT_FILE_MODE,$blob,$prefix/$(basename "$file")"
  done
  tree="$(git -C "$REPO_ROOT" write-tree)"
  unset GIT_INDEX_FILE
  rm -rf "$scratch"
  commit="$(git -C "$REPO_ROOT" commit-tree "$tree" ${parent:+-p "$parent"} -m "evidence: PR #$pr run $RUN_ID")"
  git -C "$REPO_ROOT" push -q origin "$commit:refs/heads/$EVIDENCE_BRANCH" \
    || die "push to $EVIDENCE_BRANCH failed (another publish may have raced; rerun)"

  repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
  local raw="https://raw.githubusercontent.com/$repo/$commit/$prefix"
  local blob_url="https://github.com/$repo/blob/$commit/$prefix"
  local body="$art/proof-comment.md" name
  {
    echo "## Verification proof"
    echo
    [[ -z "$summary" ]] || { cat "$summary"; echo; }
    echo "Run \`$RUN_ID\` from the \`verify-hackmidwest\` skill."
    echo
    for file in "${files[@]}"; do
      name="$(basename "$file")"
      if [[ "$name" == *.png ]]; then
        printf '### %s\n\n![%s](%s/%s)\n\n' "${name%.png}" "$name" "$raw" "$name"
      fi
    done
    echo "### Transcripts"
    echo
    for file in "${files[@]}"; do
      name="$(basename "$file")"
      if [[ "$name" != *.png ]]; then
        echo "- [$name]($blob_url/$name)"
      fi
    done
  } > "$body"
  gh pr comment "$pr" --body-file "$body"
}

cmd_list() {
  ls -1 "$VERIFY_ROOT/runs" 2> /dev/null || true
}

case "${1:-}" in
  setup) cmd_setup ;;
  up) cmd_up ;;
  doctor) cmd_doctor ;;
  api) shift; cmd_api "$@" ;;
  agent) shift; cmd_agent "$@" ;;
  db) shift; cmd_db "$@" ;;
  db-reject) shift; cmd_db_reject "$@" ;;
  browser) shift; cmd_browser "$@" ;;
  down) cmd_down ;;
  publish) shift; cmd_publish "$@" ;;
  list) cmd_list ;;
  *) die "usage: verify.sh setup | up | doctor | api | agent | db | db-reject | browser | down | publish | list (see SKILL.md)" ;;
esac
