#!/usr/bin/env bash
#
# Backend coverage gate: fail if any instrumented line has zero executions.
#
# This reads the lcov export from `cargo llvm-cov`, whose per-line `DA:` rows
# are derived from the same execution data the other exports (JSON `segments`,
# HTML) use. It deliberately does NOT use llvm-cov's `--fail-under-lines`
# summary threshold: that summary counts region entries as lines and can
# disagree with every actual export — it is what reported the phantom "missed
# lines" in providers/*.rs that no other source of execution data could
# reproduce. The intent is unchanged (100% of lines must execute); only the
# measurement is now reproducible and cross-checkable against the artifacts.
#
# Usage: check-backend-coverage.sh [path/to/lcov.info]

set -euo pipefail

lcov="${1:-lcov.info}"

if [ ! -f "$lcov" ]; then
  echo "ERROR: lcov report not found at $lcov" >&2
  exit 1
fi

awk '
  /^SF:/ { f = substr($0, 4) }
  /^DA:/ {
    split(substr($0, 4), a, ",")
    if (a[2] + 0 == 0) { print f ":" a[1]; bad++ }
  }
  END {
    if (bad) { print "ERROR: " bad " line(s) with no execution"; exit 1 }
    print "OK: every instrumented line executed"
  }
' "$lcov"
