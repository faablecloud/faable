#!/bin/sh

PYTHON_VERSION=$(python --version)
PIP_VERSION=$(pip --version)

echo "Faable Cloud · [$PYTHON_VERSION] [$PIP_VERSION]"
eval $START_COMMAND
