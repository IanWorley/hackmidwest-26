# Agent runs

A caller sends a prompt to the agent API and watches the model's answer stream back as server-sent events. Each run is stored, so the caller can read it back later with how it ended: `completed`, `refused`, `failed`, or `cancelled`. Invalid requests are rejected and store nothing.

## Sub-features

- `run-stream`: `POST /api/agent-runs` streams `started`, then `text` chunks, then `done`.
- `run-read`: `GET /api/agent-runs/:id` returns the stored run with its status, output, and stop reason.
- `run-reject`: an unknown provider or an empty prompt returns `422` and stores no run.
- `run-missing`: an unknown run id returns `404`.
- `local-only`: the agent API answers on `localhost` only.

## How to get to it (user POV)

- An HTTP client posts `{"provider":"anthropic","prompt":"…"}` to the agent API at `AGENT_API_URL` from the run state.
- An HTTP client reads a run by id from the same API.
- There is no UI for agent runs.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index. A fresh `up` has no agent runs.
- Anthropic credentials are available to the agent API (`ANTHROPIC_API_KEY` or an `ant auth login` profile). Without them, the run ends `failed`.

- **Start a run.** Post a prompt with a predictable answer. Run `RUN_ID=<id> $V agent-api agent-runs-start POST /api/agent-runs '{"provider":"anthropic","prompt":"Reply with exactly the word: hello"}'`. Status `200 OK`, `Content-Type: text/event-stream`, then `event: started` with `{"type":"started","runId":1}`, one or more `event: text` frames, and last `event: done` with `"status":"completed"`.
- **Read it back.** Run `RUN_ID=<id> $V agent-api agent-runs-get GET /api/agent-runs/1`. Status `200 OK`; the body has `"status":"completed"` and an `output` equal to the streamed text joined together.
- **Stored.** Run `RUN_ID=<id> $V db agent-runs-row "select id, provider, status, stop_reason, output from agent_runs order by id"`. One row, `1|anthropic|completed|end_turn|<output>`.
- **Reject unknown provider.** Run `RUN_ID=<id> $V agent-api agent-runs-unknown-provider POST /api/agent-runs '{"provider":"openai","prompt":"hello"}'`. Status `422 Unprocessable Entity`.
- **Reject empty prompt.** Run `RUN_ID=<id> $V agent-api agent-runs-empty-prompt POST /api/agent-runs '{"provider":"anthropic","prompt":""}'`. Status `422 Unprocessable Entity`.
- **Missing run.** Run `RUN_ID=<id> $V agent-api agent-runs-missing GET /api/agent-runs/99`. Status `404 Not Found`, body `Agent run not found`.
- **Proof nothing invalid stored.** Run `RUN_ID=<id> $V db agent-runs-final "select id, status from agent_runs order by id"`. Only row `1|completed` exists.
- **Local only.** Run `curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://$(hostname -I | awk '{print $1}'):<AGENT_API_PORT>/api/agent-runs/1"`. It prints `000` because nothing answers on the network address.

## Gotchas

- Each `agent-runs-start` makes a real model call and spends Anthropic credits. Keep prompts short.
- The model's wording varies. Assert on the event sequence, the status, and that `output` equals the streamed text, not on exact text beyond a one-word prompt.
- `refused`, `failed`, and `cancelled` endings are not drivable on demand without a provider failure or a client disconnect mid-stream. Report them as unverified here; unit tests in `apps/agent-api` cover them.
- `$V api` targets the tasks API. Use `$V agent-api` for agent runs.
