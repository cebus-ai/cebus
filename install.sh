#!/bin/bash
# Cebus Installation Script for Linux/macOS

set -e

echo ""
echo "  Installing Cebus..."
echo ""

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
SHELL_RC=""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "  [ERROR] Node.js is not installed"
    echo "  Install Node.js: brew install node"
    exit 1
fi

# Install dependencies and rebuild native modules
echo "  Installing dependencies..."
if command -v npm &> /dev/null; then
    npm install --quiet
    npm rebuild better-sqlite3 --quiet
    echo "  [OK] Dependencies installed"
else
    echo "  [WARNING] npm not found, skipping dependency installation"
fi

# Detect shell
if [ -n "$ZSH_VERSION" ]; then
    SHELL_RC="$HOME/.zshrc"
elif [ -n "$BASH_VERSION" ]; then
    SHELL_RC="$HOME/.bashrc"
else
    SHELL_RC="$HOME/.profile"
fi

# Check if already in PATH
if echo "$PATH" | grep -q "$INSTALL_DIR"; then
    echo "  [OK] Already in PATH"
else
    # Add to shell rc file
    echo "" >> "$SHELL_RC"
    echo "# Cebus" >> "$SHELL_RC"
    echo "export PATH=\"\$PATH:$INSTALL_DIR\"" >> "$SHELL_RC"
    echo "  [OK] Added to $SHELL_RC"
fi

# Build the project
echo "  Building project..."
npm run build --quiet
echo "  [OK] Build complete"

# Create Unix executable
cat > "$INSTALL_DIR/cebus" << 'EOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Use Node.js (required for better-sqlite3 support)
if command -v npx &> /dev/null; then
    npx tsx "$SCRIPT_DIR/apps/cli/src/index.ts" "$@"
elif command -v node &> /dev/null; then
    node --import tsx "$SCRIPT_DIR/apps/cli/src/index.ts" "$@"
else
    echo "Error: Node.js is required"
    echo "Install Node.js: brew install node"
    exit 1
fi
EOF

chmod +x "$INSTALL_DIR/cebus"

echo ""
echo "  Installation complete!"
echo ""
echo "  Run: source $SHELL_RC"
echo "  Then: cebus"
echo ""
