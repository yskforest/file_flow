#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker build -f test/docker/Dockerfile -t fileflow-test .
docker run --rm --init --network none --shm-size=1g fileflow-test
