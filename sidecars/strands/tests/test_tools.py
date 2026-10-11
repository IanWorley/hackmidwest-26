from conftest import StubAgentApi, StubResponse

from hackmidwest_strands.tools import narrate_recommendation, run_facility

HTTP_NOT_FOUND = 404


def test_run_facility_posts_to_the_facility_run_route(agent_api: StubAgentApi) -> None:
    assert run_facility(facility_id=7) == {"method": "POST", "path": "/facilities/7/run"}


def test_narrate_recommendation_posts_to_the_narrate_route(agent_api: StubAgentApi) -> None:
    assert narrate_recommendation(recommendation_id=12) == {
        "method": "POST",
        "path": "/recommendations/12/narrate",
    }


def test_non_success_status_returns_the_error_shape(agent_api: StubAgentApi) -> None:
    agent_api.response = StubResponse(status=HTTP_NOT_FOUND, body={"error": "Facility not found"})

    assert run_facility(facility_id=99) == {
        "error": "POST /facilities/99/run failed with HTTP 404",
        "status_code": 404,
        "body": {"error": "Facility not found"},
    }
