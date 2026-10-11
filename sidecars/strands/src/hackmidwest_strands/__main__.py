import argparse
import sys

from strands.types.agent import Limits

from hackmidwest_strands.agent import MissingConfigError, NoGenerationModel, build_agent, openrouter_model

EXIT_SUCCESS = 0
EXIT_FAILURE = 1
# Every run_facility call stores a recommendation, so a runaway loop would flood history and spend.
ASK_LIMITS: Limits = {"turns": 6}
# The stop reason Strands reports when the turns cap in ASK_LIMITS ends the loop.
TURN_LIMIT_STOP_REASON = "limit_turns"


def _ask(question: str) -> int:
    try:
        model = openrouter_model()
    except MissingConfigError as error:
        print(error, file=sys.stderr)
        return EXIT_FAILURE

    result = build_agent(model)(question, limits=ASK_LIMITS)
    if result.stop_reason == TURN_LIMIT_STOP_REASON:
        print(f"The agent stopped after {ASK_LIMITS['turns']} turns without an answer.", file=sys.stderr)
        return EXIT_FAILURE

    print(result)
    return EXIT_SUCCESS


def _run(facility_id: int) -> int:
    # agent.tool holds only a weak reference, so the agent must outlive the call.
    agent = build_agent(NoGenerationModel())
    result = agent.tool.run_facility(facility_id=facility_id, record_direct_tool_call=False)
    text = "\n".join(block["text"] for block in result["content"] if "text" in block)
    if result["status"] == "error":
        print(text, file=sys.stderr)
        return EXIT_FAILURE

    print(text)
    return EXIT_SUCCESS


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="hackmidwest_strands")
    commands = parser.add_subparsers(dest="command", required=True)
    ask = commands.add_parser("ask", help="ask the model-driven agent a question (needs OpenRouter)")
    ask.add_argument("question")
    run = commands.add_parser("run", help="call run_facility directly, without a model")
    run.add_argument("facility_id", type=int)

    args = parser.parse_args(argv)
    if args.command == "ask":
        return _ask(args.question)
    return _run(args.facility_id)


if __name__ == "__main__":
    sys.exit(main())
