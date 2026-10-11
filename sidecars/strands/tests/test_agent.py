import json

import pytest
from conftest import HTTP_NOT_FOUND, StubAgentApi, StubResponse

from hackmidwest_strands.__main__ import main
from hackmidwest_strands.agent import OPENROUTER_API_KEY_ENV, OPENROUTER_MODEL_ENV, build_agent


def test_agent_registers_only_the_read_only_tools() -> None:
    assert sorted(build_agent().tool_names) == ["narrate_recommendation", "run_facility"]


def test_run_command_prints_the_run_log_without_a_model(
    agent_api: StubAgentApi, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = main(["run", "7"])

    assert (exit_code, json.loads(capsys.readouterr().out)) == (
        0,
        {"method": "POST", "path": "/facilities/7/run"},
    )


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
