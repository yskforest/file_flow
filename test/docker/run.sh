#!/bin/sh
set -eu
node test/run_tests.js
node test/setup.js
node test/integration.js
node test/browser.js
