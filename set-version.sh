#!/usr/bin/env sh
# Sets the app version in every file that stores it. Usage: ./set-version.sh 1.0.0
cd "$(dirname "$0")" && node scripts/set-version.mjs "$@"
