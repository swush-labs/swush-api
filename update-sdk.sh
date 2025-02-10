#!/bin/bash

# Build and pack SDK
echo "Building and packing SDK..."
pnpm run pack:local

# Get the latest .tgz file
PACKAGE_FILE=$(ls -t *.tgz | head -n1)

# Get the absolute path of the current directory
CURRENT_DIR=$(pwd)

# Check if UI project path is provided
UI_PROJECT_PATH="../swush-ui"  # Update this to your actual Next.js project path
if [ ! -d "$UI_PROJECT_PATH" ]; then
    echo "Error: UI project directory not found at $UI_PROJECT_PATH"
    exit 1
fi

# Update package in UI project
echo "Updating SDK in UI project..."
cd "$UI_PROJECT_PATH"
pnpm remove dex-aggregator-service
pnpm add "$CURRENT_DIR/$PACKAGE_FILE"

echo "SDK update complete!" 