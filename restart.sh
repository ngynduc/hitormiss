#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose down
docker compose up -d --build
#docker compose logs -f --tail=20
