"""Engine entry point: `python -m dbeef --config dbeef.yaml`.

The first stdout line is the handshake {"port": ..., "token": ...} that Tauri reads.
"""

import argparse
import json
import secrets
import socket
import sys

import uvicorn

from .api import create_app
from .config import ConfigError, load_config
from .project import Project

DEFAULT_ORIGINS = ["tauri://localhost", "http://tauri.localhost"]


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(prog="dbeef-engine")
    ap.add_argument("--config", action="append", required=True, help="path to a dbeef.yaml (repeatable)")
    ap.add_argument("--port", type=int, default=0, help="0 picks a free port")
    ap.add_argument("--dev-token", help="use a known token instead of a random one (dev and tests only)")
    ap.add_argument("--allow-origin", action="append", default=[], help="extra CORS origin (repeatable)")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    projects: dict[str, Project] = {}
    try:
        for path in args.config:
            cfg = load_config(path)
            if cfg.project in projects:
                raise ConfigError(f"{path}: project {cfg.project!r} is already loaded from another config")
            projects[cfg.project] = Project(cfg)
    except ConfigError as e:
        print(f"dbeef: {e}", file=sys.stderr)
        return 2

    token = args.dev_token or secrets.token_urlsafe(32)
    app = create_app(projects, token, DEFAULT_ORIGINS + args.allow_origin)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", args.port))
    print(json.dumps({"port": sock.getsockname()[1], "token": token}), flush=True)
    try:
        uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[sock])
    finally:
        for p in projects.values():
            p.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
