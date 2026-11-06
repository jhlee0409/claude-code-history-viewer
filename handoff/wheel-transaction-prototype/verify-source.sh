#!/bin/bash
set -o pipefail
source ~/.nvm/nvm.sh
nvm use 22.18.0 || exit $?
mkdir -p scratch/wheel-verification
result=0
run() {
  local name="$1"
  shift
  "$@" > "scratch/wheel-verification/$name.log" 2>&1
  local code=$?
  printf '%s\n' "$code" > "scratch/wheel-verification/$name.exit"
  printf '%s exit=%s\n' "$name" "$code"
  if [ "$code" -ne 0 ]; then result=1; fi
}
run source env -u NODE_ENV pnpm exec vitest run src --config handoff/wheel-transaction-prototype/vitest.config.mjs --configLoader native --cache=false --maxWorkers=4 --reporter=dot
run lint env -u NODE_ENV pnpm exec eslint src
run type-app env -u NODE_ENV pnpm exec tsc -p tsconfig.app.json --incremental --tsBuildInfoFile scratch/wheel-verification/app.tsbuildinfo --pretty false
run type-node env -u NODE_ENV pnpm exec tsc -p tsconfig.node.json --incremental --tsBuildInfoFile scratch/wheel-verification/node.tsbuildinfo --pretty false
run whitespace git diff --check
exit "$result"
