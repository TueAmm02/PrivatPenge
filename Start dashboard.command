#!/bin/zsh
# Starter økonomi-dashboardet og åbner det i browseren
cd "$(dirname "$0")"
if ! lsof -i :5180 -sTCP:LISTEN >/dev/null 2>&1; then
  node server.js &
  sleep 1
fi
open http://localhost:5180
wait
