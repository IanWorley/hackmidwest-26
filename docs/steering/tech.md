---
inclusion: always
---

# Technology & Conventions

## Stack
- **Language:** Python 3.12.
- **HTTP:** `httpx` (or `requests`) for the NWS client. Always set a descriptive `User-Agent`
  header — the NWS API requests one and may reject requests without it.
- **Data models:** `pydantic` for `Facility`, `Employee`, `Reading`, `Recommendation`,
  `DecisionRecord`.
- **Config:** `pyyaml` for `config/thresholds.yaml` and `config/facility.yaml`.
- **Tests:** `pytest`.

## Dependency boundary (important)
- Core system runs with **only** `requirements.txt`.
- The Strands Agents SDK layer is **optional** and isolated under `closure_call/agents/`.
  Import it lazily so the project runs fully without `strands-agents` installed.
- Optional deps live in `requirements-agents.txt`.

## Strands Agents SDK (optional layer only)
- Install: `pip install strands-agents strands-agents-tools`.
- `from strands import Agent`; define custom tools with the `@tool` decorator.
- `Agent(tools=[...], system_prompt=...)`. Default model provider is AWS Bedrock (needs AWS creds).
- The agent orchestrates and narrates; it must **not** choose the posture. Posture selection stays
  in the deterministic `threshold_engine`.

## Conventions
- Keep posture selection deterministic and rule-based (testable + auditable). Use an LLM only to
  phrase the human-readable rationale — never to decide the posture.
- Normalize every external reading into a common shape: `{source, observed_at, metric, value,
  unit, raw_ref}`.
- Add retry/backoff and timeouts on all external API calls. Cache the NWS `points` lookup.
- No secrets in code. Use `.env` (see `.env.example`).
