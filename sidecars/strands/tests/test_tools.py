import pytest
from conftest import HTTP_NOT_FOUND, StubAgentApi, StubResponse

from hackmidwest_strands.tools import AgentApiError, narrate_recommendation, run_facility


def test_run_facility_posts_to_the_facility_run_route(agent_api: StubAgentApi) -> None:
    assert run_facility(facility_id=7) == {"method": "POST", "path": "/facilities/7/run"}


def test_narrate_recommendation_posts_to_the_narrate_route(agent_api: StubAgentApi) -> None:
    assert narrate_recommendation(recommendation_id=12) == {
        "method": "POST",
        "path": "/recommendations/12/narrate",
    }


def test_non_success_status_raises_with_the_status_and_body(agent_api: StubAgentApi) -> None:
    agent_api.response = StubResponse(status=HTTP_NOT_FOUND, body={"message": "Facility not found"})

    with pytest.raises(AgentApiError) as raised:
        run_facility(facility_id=99)

    assert str(raised.value) == 'POST /facilities/99/run failed with HTTP 404: {"message": "Facility not found"}'
