#!/usr/bin/env bash
# Run the DBeef engine in Docker on a remote machine, next to the stores it reads, and tunnel it here.
#   scripts/remote-docker.sh HOST CONFIG [DOCKER_ARGS_FILE]
# DOCKER_ARGS_FILE defaults to CONFIG with .yaml replaced by .docker: one docker-run argument per line
# (network, mounts, env), '#' comments allowed, $HOME expanded on HOST. HOST needs Docker and rsync.
# The engine and config are copied to ~/$DBEEF_REMOTE_DIR (default dbeef) and the image is built there.
set -euo pipefail
usage="usage: remote-docker.sh HOST CONFIG [DOCKER_ARGS_FILE]"
host=${1:?$usage}; config=${2:?$usage}; args_file=${3:-${config%.yaml}.docker}
port=${DBEEF_PORT:-8765}; remote=${DBEEF_REMOTE_DIR:-dbeef}
root=$(cd "$(dirname "$0")/.." && pwd)
docker_args=$(grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' "$args_file" | tr '\n' ' ')
token=$(openssl rand -hex 16)  # tr </dev/urandom | head dies of SIGPIPE under pipefail
rsync -a --delete --exclude .venv --exclude tests --exclude __pycache__ --exclude .pytest_cache \
  "$root/engine/" "$host:$remote/engine/"
rsync -a "$config" "$host:$remote/config.yaml"
echo "UI:  http://localhost:5173/?engine=http://127.0.0.1:${port}&token=${token}"
echo "Ctrl-C stops the engine and the tunnel."
# Detached run + trap: the container is removed even when the SSH connection drops (-tt: the remote
# shell gets a pty, and so the SIGHUP, even when this script runs without a terminal).
# Never --network host: the image listens on 0.0.0.0. Port published on the remote loopback only.
exec ssh -o ExitOnForwardFailure=yes -tt -L "127.0.0.1:${port}:127.0.0.1:${port}" "$host" "bash -c '
  set -e; cd \$HOME/$remote
  docker build -q -t dbeef-engine engine >/dev/null
  docker rm -f dbeef-engine >/dev/null 2>&1 || true
  trap \"docker rm -f dbeef-engine >/dev/null 2>&1\" EXIT HUP INT TERM
  docker run -d --name dbeef-engine --memory 768m --cpus 1 -p 127.0.0.1:${port}:8765 \
    -v \$HOME/$remote/config.yaml:/cfg/config.yaml:ro $docker_args \
    dbeef-engine --config /cfg/config.yaml --dev-token $token --allow-origin http://localhost:5173 >/dev/null
  docker logs -f dbeef-engine & wait \$!  # wait, unlike a foreground child, lets the trap run at once
'"
