import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from conftest import HTTP_NOT_FOUND, StubAgentApi, StubResponse
from strands.models import Model
from strands.types.streaming import StreamEvent

from hackmidwest_strands import __main__ as cli
from hackmidwest_strands.__main__ import ASK_LIMITS, main
from hackmidwest_strands.agent import OPENROUTER_API_KEY_ENV, OPENROUTER_MODEL_ENV, NoGenerationModel, build_agent

# Ends the loop if nothing else does, so a missing cap fails the test instead of hanging it.
RUNAWAY_TURNS = 50


class AlwaysRunFacilityModel(Model):
    """Requests run_facility on every turn, so only a turn cap ends the loop early."""

    def __init__(self) -> None:
        self.turns = 0

    def update_config(self, **model_config: Any) -> None:
        pass

    def get_config(self) -> dict[str, Any]:
        return {}

    def structured_output(self, *args: Any, **kwargs: Any) -> Any:
        raise NotImplementedError

    async def stream(self, *args: Any, **kwargs: Any) -> AsyncIterator[StreamEvent]:
        self.turns += 1
        yield {"messageStart": {"role": "assistant"}}
        if self.turns > RUNAWAY_TURNS:
            yield {"contentBlockDelta": {"delta": {"text": "done"}}}
            yield {"contentBlockStop": {}}
            yield {"messageStop": {"stopReason": "end_turn"}}
            return
        yield {"contentBlockStart": {"start": {"toolUse": {"toolUseId": f"run-{self.turns}", "name": "run_facility"}}}}
        yield {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps({"facility_id": 7})}}}}
        yield {"contentBlockStop": {}}
        yield {"messageStop": {"stopReason": "tool_use"}}


def test_agent_registers_only_the_read_only_tools() -> None:
    assert sorted(build_agent(NoGenerationModel()).tool_names) == ["narrate_recommendation", "run_facility"]


def test_run_command_prints_the_run_log_without_a_model(
    agent_api: StubAgentApi, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = main(["run", "7"])

    assert (exit_code, json.loads(capsys.readouterr().out)) == (
        0,
        {"method": "POST", "path": "/facilities/7/run"},
    )


def test_run_command_never_initializes_bedrock(agent_api: StubAgentApi, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AWS_PROFILE", "does-not-exist")

    exit_code = main(["run", "7"])

    assert (exit_code, agent_api.paths) == (0, ["/facilities/7/run"])


def test_run_command_fails_when_the_agent_api_rejects_the_run(
    agent_api: StubAgentApi, capsys: pytest.CaptureFixture[str]
) -> None:
    agent_api.response = StubResponse(status=HTTP_NOT_FOUND, body={"message": "Facility not found"})

    exit_code = main(["run", "99"])

    assert (exit_code, capsys.readouterr().err.strip()) == (
        1,
        'Error: AgentApiError - POST /facilities/99/run failed with HTTP 404: {"message": "Facility not found"}',
    )


def test_ask_command_fails_clearly_without_an_openrouter_key(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv(OPENROUTER_API_KEY_ENV, raising=False)
    monkeypatch.setenv(OPENROUTER_MODEL_ENV, "openai/gpt-4o-mini")

    exit_code = main(["ask", "Why is facility 7 closed?"])

    assert (exit_code, capsys.readouterr().err.strip()) == (1, "Set OPENROUTER_API_KEY to ask the agent a question.")


def test_ask_command_stops_a_runaway_tool_loop_at_the_turn_cap(
    agent_api: StubAgentApi, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "openrouter_model", AlwaysRunFacilityModel)
    turn_cap = ASK_LIMITS["turns"]

    exit_code = main(["ask", "Why is facility 7 closed?"])

    assert (exit_code, len(agent_api.paths), capsys.readouterr().err.strip()) == (
        1,
        turn_cap,
        f"The agent stopped after {turn_cap} turns without an answer.",
    )
