#!/bin/bash
# WordPress MCP Server launcher for gateway deployment.
# Sources credentials from SECRETS_DIR or local .env file.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source credentials
if [ -n "$SECRETS_DIR" ] && [ -f "$SECRETS_DIR/wordpress.env" ]; then
    set -a; source "$SECRETS_DIR/wordpress.env"; set +a
elif [ -f "$SCRIPT_DIR/.env" ]; then
    set -a; source "$SCRIPT_DIR/.env"; set +a
fi

# Auto-install dependencies if needed
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    npm install --prefix "$SCRIPT_DIR" --production 2>&1 >&2
fi

exec node "$SCRIPT_DIR/src/server.js"
