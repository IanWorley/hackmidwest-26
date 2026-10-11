# Strands sidecar

The Strands sidecar in `sidecars/strands` is a Python command-line agent over the agent API. `run <facility_id>` calls its `run_facility` tool directly, with no model, and prints the agent API's run log for that facility. `ask "<question>"` lets an OpenRouter model choose between `run_facility` and `narrate_recommendation`. The sidecar has no tool that records a decision or dispatches notifications.

## Sub-features

- `strands-run-ok` prints the `POST /facilities/:id/run` body as JSON and exits `0`.
- `strands-run-side-effects` leaves one new `recommendations` row and no `decisions` or `notification_dispatches` rows.
- `strands-run-bad-aws-profile` behaves like `strands-run-ok` with `AWS_PROFILE` set to a profile that does not exist, because `run` never builds a Bedrock model.
- `strands-run-not-found` prints `Error: AgentApiError - POST /facilities/999999/run failed with HTTP 404: {"message":"Facility not found"}` to stderr and exits `1`.
- `strands-ask-no-key` prints `Set OPENROUTER_API_KEY to ask the agent a question.` to stderr and exits `1` when the key is unset.

## How to get to it (user POV)

- From `sidecars/strands`, run `.venv/bin/python -m hackmidwest_strands run <facility_id>` with `AGENT_API_URL` set.
- From `sidecars/strands`, run `.venv/bin/python -m hackmidwest_strands ask "<question>"` with `AGENT_API_URL`, `OPENROUTER_API_KEY`, and `OPENROUTER_MODEL` set.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index (no recommendations).
- The sidecar venv exists: `python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'` in `sidecars/strands`.
- `$V up` printed `AGENT_API_URL`. Below, `<agent>` is that value.

- **Run.** From `sidecars/strands`, run `AGENT_API_URL=<agent> .venv/bin/python -m hackmidwest_strands run 1`. Exit `0`; stdout is the run log, with `facilityId` `1`, `recommendationId` `1`, and `steps[].tool` exactly `evaluate`, `preview_notifications`, `narrate`. Save the command, stdout, and exit code as `strands-run-ok.http.txt` in `$ARTIFACTS`, with a first line saying it is a Strands CLI transcript, so `publish` ships it.
- **Side effects.** Run `RUN_ID=<id> $V db strands-run-recommendations "select id, facility_id, posture from recommendations order by id"` (one row, id `1`, facility `1`), `RUN_ID=<id> $V db strands-run-decisions "select count(*) as decisions from decisions"` (`0`), and `RUN_ID=<id> $V db strands-run-dispatches "select count(*) as dispatches from notification_dispatches"` (`0`).
- **Same route over HTTP.** Run `RUN_ID=<id> $V agent strands-run-direct POST /facilities/1/run` to compare the CLI output with the route's own body. It creates recommendation `2`.
- **Bad AWS profile.** Run `AWS_PROFILE=does-not-exist AGENT_API_URL=<agent> .venv/bin/python -m hackmidwest_strands run 1`. Exit `0`; stdout is a run log for facility `1` with a new `recommendationId`. Save it as `strands-run-bad-aws-profile.http.txt`.
- **Unknown facility.** Run `AGENT_API_URL=<agent> .venv/bin/python -m hackmidwest_strands run 999999`. Exit `1`; stderr is the `strands-run-not-found` line. Save it as `strands-run-not-found.http.txt`.
- **Ask without a key.** Run `AGENT_API_URL=<agent> OPENROUTER_MODEL=openai/gpt-4o-mini .venv/bin/python -m hackmidwest_strands ask "Why is facility 1 closing?"` with `OPENROUTER_API_KEY` unset. Exit `1` with the `strands-ask-no-key` line.

## Gotchas

- A model-driven `ask` needs real OpenRouter credentials. Without them, report `ask` as unreached beyond its missing-key error.
- `run` makes a live NWS and Open-Meteo pull through the API. If the agent API answers `500`, the CLI exits `1`; report the run as unreached.
- `run` builds its Strands agent with a stub model that raises if asked to generate, so it needs no AWS credentials.
- `ask` stops after six turns (`ASK_LIMITS` in `__main__.py`). Without OpenRouter credentials the cap is covered only by pytest.
- `verify.sh` does not drive the sidecar. Run it yourself and save the transcript into `$ARTIFACTS` by hand.
