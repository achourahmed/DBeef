#!/usr/bin/env bash
# Run the DBeef engine on a remote machine and tunnel it to this one.
#   scripts/remote-engine.sh HOST [--config PATH ...]
# On HOST: a DBeef checkout at $DBEEF_REMOTE_DIR (default ~/DBeef) with engine/.venv installed, and the
# store env vars (VEDAS_DATA, NEO4J_*, REDIS_URL) exported in the login shell or passed via --env.
# Local: open the printed URL; the UI talks to http://localhost:8765 through the tunnel.
set -euo pipefail
host=${1:?usage: remote-engine.sh HOST [--config PATH ...]}; shift
dir=${DBEEF_REMOTE_DIR:-'~/DBeef'}
port=${DBEEF_PORT:-8765}
token=$(openssl rand -hex 16)  # tr </dev/urandom | head dies of SIGPIPE under pipefail
configs=${*:---config ../configs/vedas.yaml}  # paths resolve from engine/
echo "UI:  http://localhost:5173/?engine=http://127.0.0.1:${port}&token=${token}"
echo "Ctrl-C stops the engine and the tunnel."
exec ssh -o ExitOnForwardFailure=yes -L "127.0.0.1:${port}:127.0.0.1:${port}" -t "$host" \
  "cd $dir/engine && exec .venv/bin/python -m dbeef $configs --port $port --dev-token $token --allow-origin http://localhost:5173"
