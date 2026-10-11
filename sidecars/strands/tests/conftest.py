import json
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from hackmidwest_strands.tools import AGENT_API_URL_ENV

HTTP_OK = 200


@dataclass
class StubResponse:
    status: int = HTTP_OK
    body: object = None


class StubAgentApi:
    """Answers every POST with the configured response, or by echoing the method and path."""

    def __init__(self) -> None:
        self.response = StubResponse()
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                body = stub.response.body
                if body is None:
                    body = {"method": "POST", "path": self.path}
                payload = json.dumps(body).encode()
                self.send_response(stub.response.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, format: str, *args: object) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        host, port = self.server.server_address[:2]
        self.url = f"http://{host}:{port}"


@pytest.fixture
def agent_api(monkeypatch: pytest.MonkeyPatch) -> Iterator[StubAgentApi]:
    stub = StubAgentApi()
    thread = threading.Thread(target=stub.server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv(AGENT_API_URL_ENV, stub.url)
    yield stub
    stub.server.shutdown()
    stub.server.server_close()
