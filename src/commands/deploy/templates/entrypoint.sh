#!/bin/sh

NPM_RUN_COMMAND=$1

NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
YARN_VERSION=$(yarn --version)
echo "FaableCloud · Node:$NODE_VERSION NPM:$NPM_VERSION Yarn:$YARN_VERSION"
echo "Running npm script -> $NPM_RUN_COMMAND"


yarn run $NPM_RUN_COMMAND
