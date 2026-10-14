#!/usr/bin/env bash
set -eu
cd -- "$(dirname -- "$0")"
command -v node >/dev/null 2>&1 || { echo 'Node.js 24 or newer is required.'; exit 1; }
exec node scripts/launch.mjs "$@"
