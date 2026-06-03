#!/bin/sh

PYTHON_VERSION=$(python --version 2>&1)
PIP_VERSION=$(pip --version 2>&1)

echo "Faable Cloud · [$PYTHON_VERSION] [$PIP_VERSION]"
eval $START_COMMAND
