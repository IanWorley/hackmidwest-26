import os
from typing import Any, NoReturn

from strands import Agent
from strands.models import Model
from strands.models.openai import OpenAIModel

from hackmidwest_strands.tools import READ_ONLY_TOOLS

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY"
OPENROUTER_MODEL_ENV = "OPENROUTER_MODEL"
NO_MODEL_MESSAGE = "This agent has no model. Call its tools directly, or use `ask` with OpenRouter."

SYSTEM_PROMPT = """\
You help a facility manager understand severe-weather closure recommendations.
You advise and narrate only. A deterministic engine decides each facility's posture, \
and a human manager makes every closure decision. Never choose, change, or argue for a \
different posture, and never claim that a decision or dispatch has been made.
Use run_facility to see how a facility's recommendation was produced, and \
narrate_recommendation to phrase a stored recommendation for an email. \
Report tool errors plainly instead of guessing at the data."""


class MissingConfigError(Exception):
    pass


class NoGenerationModel(Model):
    """Stands in for a model when tools are called directly, so Strands never builds its Bedrock default."""

    def update_config(self, **model_config: Any) -> None:
        pass

    def get_config(self) -> dict[str, Any]:
        return {}

    def structured_output(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise RuntimeError(NO_MODEL_MESSAGE)

    def stream(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise RuntimeError(NO_MODEL_MESSAGE)


def openrouter_model() -> OpenAIModel:
    missing = [name for name in (OPENROUTER_API_KEY_ENV, OPENROUTER_MODEL_ENV) if not os.environ.get(name)]
    if missing:
        raise MissingConfigError(f"Set {' and '.join(missing)} to ask the agent a question.")

    return OpenAIModel(
        client_args={"base_url": OPENROUTER_BASE_URL, "api_key": os.environ[OPENROUTER_API_KEY_ENV]},
        model_id=os.environ[OPENROUTER_MODEL_ENV],
    )


def build_agent(model: Model) -> Agent:
    return Agent(model=model, tools=READ_ONLY_TOOLS, system_prompt=SYSTEM_PROMPT, callback_handler=None)
