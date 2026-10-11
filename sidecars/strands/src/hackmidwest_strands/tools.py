import os
from typing import Any

import httpx
from strands import tool

AGENT_API_URL_ENV = "AGENT_API_URL"
# Outlasts the API's worst case so a slow run is never reported failed while it still stores its
# recommendation. apps/api/src/clients/nws.ts gives each NWS request 4 attempts of 10 s plus 1 + 2 + 4 s of
# backoff (47 s), and an evaluation's observation pull makes 3 of them in series (points, stations, latest
# observation), so the API can take 141 s. The rest is margin for the preview and narration, though the narration's
# OpenRouter call sets no timeout of its own.
REQUEST_TIMEOUT_SECONDS = 180.0

type Json = dict[str, Any] | list[Any] | str | int | float | bool | None


class AgentApiError(Exception):
    pass


def _post(path: str) -> Json:
    base_url = os.environ.get(AGENT_API_URL_ENV)
    if not base_url:
        raise RuntimeError(f"{AGENT_API_URL_ENV} is not set")

    response = httpx.post(f"{base_url.rstrip('/')}{path}", timeout=REQUEST_TIMEOUT_SECONDS)
    # Raising makes Strands record an error tool result, so the model and the CLI both see a failure.
    if not response.is_success:
        raise AgentApiError(f"POST {path} failed with HTTP {response.status_code}: {response.text}")
    return response.json()


@tool
def run_facility(facility_id: int) -> Json:
    """Run the agent API's orchestration for one facility and return its step-by-step run log.

    The run evaluates the facility's posture with the deterministic engine, previews the
    recommendation, and narrates it. It never records a decision or dispatch of its own. Like any
    evaluation, it can make the API record a `no_decision` for the facility's previous
    recommendation when that one passed its decide-by time undecided.

    Args:
        facility_id: Numeric id of the facility to run.
    """
    return _post(f"/facilities/{facility_id}/run")


@tool
def narrate_recommendation(recommendation_id: int) -> Json:
    """Phrase a stored recommendation's rationale for a manager's email.

    Returns the template rationale and the narrated text. The posture is fixed input.

    Args:
        recommendation_id: Numeric id of the stored recommendation.
    """
    return _post(f"/recommendations/{recommendation_id}/narrate")


READ_ONLY_TOOLS = [run_facility, narrate_recommendation]
