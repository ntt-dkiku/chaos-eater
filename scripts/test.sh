#!/bin/bash
# Run tests in Docker container
#
# Usage:
#   ./scripts/test.sh                    # Run all tests with coverage
#   ./scripts/test.sh tests/test_utils_functions.py  # Run specific test file
#   ./scripts/test.sh -k "test_parse"    # Run tests matching pattern
#   ./scripts/test.sh --help             # Show pytest help

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Build and run tests
if [ $# -eq 0 ]; then
    # No arguments: run all tests with coverage
    docker compose -f docker/docker-compose.test.yaml run --rm test
else
    # Pass arguments to pytest
    PYTEST_ARGS="$*" docker compose -f docker/docker-compose.test.yaml run --rm test
fi
