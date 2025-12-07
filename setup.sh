#!/bin/bash

# Define the library directory
LIB_DIR="lib"
JSZIP_URL="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"
JSZIP_FILE="$LIB_DIR/jszip.min.js"

# Create lib directory if it doesn't exist
if [ ! -d "$LIB_DIR" ]; then
    echo "Creating $LIB_DIR directory..."
    mkdir -p "$LIB_DIR"
fi

# Download JSZip if it doesn't exist
if [ ! -f "$JSZIP_FILE" ]; then
    echo "Downloading jszip.min.js..."
    if command -v curl >/dev/null 2>&1; then
        curl -L -o "$JSZIP_FILE" "$JSZIP_URL"
    elif command -v wget >/dev/null 2>&1; then
        wget -O "$JSZIP_FILE" "$JSZIP_URL"
    else
        echo "Error: Neither curl nor wget is available. Please install one of them."
        exit 1
    fi
    echo "Download complete."
else
    echo "jszip.min.js already exists."
fi

echo "Setup complete."
