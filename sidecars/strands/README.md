# Strands sidecar

A Python [Strands Agents](https://strandsagents.com) agent that calls the agent API over HTTP. It
exists for the AWS "Best Use of Strands Agents SDK" bonus. Strands is Python-only, so this sidecar lives
outside the Bun workspaces, Biome, and dependency-cruiser.

## Read-only by design

The agent has exactly two tools, and both only read or narrate:

| Tool                                        | Request                                         |
| ------------------------------------------- | ----------------------------------------------- |
| `run_facility(facility_id)`                 | `POST {AGENT_API_URL}/facilities/{id}/run`      |
| `narrate_recommendation(recommendation_id)` | `POST {AGENT_API_URL}/recommendations/{id}/narrate` |

A tool returns the response's parsed JSON. On a non-2xx response it raises, so Strands records an error
tool result with the status and body, and `run` exits `1`.

The deterministic engine decides a facility's posture, and a manager records every decision in the
web app. The agent has no tool that records a decision or dispatches a crew, and its system prompt tells
it to advise and narrate only.

## Set up

You need Python 3.12.

```sh
cd sidecars/strands
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
```

## Run

Start the agent API first (`bun run dev` from the repository root), then point the sidecar at it.

To call `run_facility` directly and print the run log, run the following. This mode needs no model, API
key, or AWS credentials.

```sh
AGENT_API_URL=http://localhost:3002 .venv/bin/python -m hackmidwest_strands run 1
```

To ask the model-driven agent a question, set the OpenRouter variables too:

```sh
AGENT_API_URL=http://localhost:3002 \
OPENROUTER_API_KEY=sk-or-... \
OPENROUTER_MODEL=openai/gpt-4o-mini \
.venv/bin/python -m hackmidwest_strands ask "Why is facility 1 closing?"
```

`ask` caps the agent at six turns (`ASK_LIMITS`), because every `run_facility` call stores a
recommendation. If the model is still calling tools at the cap, `ask` prints that it stopped without an
answer and exits `1`.

## Environment variables

| Variable             | Used by | Meaning                                                  |
| -------------------- | ------- | -------------------------------------------------------- |
| `AGENT_API_URL`      | both    | Base URL of the agent API, such as `http://localhost:3002` |
| `OPENROUTER_API_KEY` | `ask`   | OpenRouter API key                                       |
| `OPENROUTER_MODEL`   | `ask`   | OpenRouter model id, such as `openai/gpt-4o-mini`        |

## Test

```sh
.venv/bin/pytest
```

The tests run against a stub HTTP server and need no network or API key.
