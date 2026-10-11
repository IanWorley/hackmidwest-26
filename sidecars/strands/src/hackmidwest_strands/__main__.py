import argparse
import sys

from hackmidwest_strands.agent import MissingConfigError, build_agent, openrouter_model

EXIT_FAILURE = 1


def _ask(question: str) -> int:
    try:
        model = openrouter_model()
    except MissingConfigError as error:
        print(error, file=sys.stderr)
        return EXIT_FAILURE

    print(build_agent(model)(question))
    return 0


def _run(facility_id: int) -> int:
    # agent.tool holds only a weak reference, so the agent must outlive the call.
    agent = build_agent()
    result = agent.tool.run_facility(facility_id=facility_id, record_direct_tool_call=False)
    text = "\n".join(block["text"] for block in result["content"] if "text" in block)
    if result["status"] == "error":
        print(text, file=sys.stderr)
        return EXIT_FAILURE

    print(text)
    return 0


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
