#!/bin/bash

# --- ENABLE LOGGING ---
exec > /home/caj/kiosk.log 2>&1
echo "--- Kiosk Script Started: $(date) ---"

# ==========================================
# CLEANUP OLD PROCESSES
# ==========================================
echo "Killing old processes..."
pkill -f "node" || true
pkill -f "chromium" || true
# Wait a moment for ports to free up
sleep 2
# ==========================================

# --- ENVIRONMENT SETUP ---
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Fallback: Check if npm is found; if not, force the manual path
if ! command -v npm &> /dev/null; then
    echo "NVM failed to load. Using manual fallback..."
    MANUAL_NODE_HOME="/home/caj/.config/nvm/versions/node/v24.12.0"
    export PATH="$MANUAL_NODE_HOME/bin:$PATH"
fi

# Verification
if ! command -v npm &> /dev/null; then
    echo "CRITICAL ERROR: npm could not be found in PATH."
    exit 1
fi
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# --- AUTO-INSTALLER SECTION (System) ---
echo "Checking system dependencies..."
DEPENDENCIES=(unclutter x11-xserver-utils chromium libudev-dev)

for pkg in "${DEPENDENCIES[@]}"; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        echo "Installing missing package: $pkg"
        sudo apt-get update && sudo apt-get install -y "$pkg"
    else
        echo "Package $pkg is already installed."
    fi
done

# --- PROJECT SETUP ---
KIOSK_APP_DIR="/home/caj/laundry-kiosk"

if [ -d "$KIOSK_APP_DIR" ]; then
    echo "Changing directory to $KIOSK_APP_DIR..."
    cd "$KIOSK_APP_DIR" || exit 1
    
    # 1. Standard Install (React Dependencies)
    if [ ! -d "node_modules" ]; then
        echo "node_modules not found. Installing..."
        npm install --no-audit --no-fund || { echo "npm install failed"; exit 1; }
    fi

    # 2. Backend Install (Safety Check)
    # Explicitly checks if firebase-admin is present. If not, installs it.
    if [ ! -d "node_modules/express" ] || [ ! -d "node_modules/serialport" ] || [ ! -d "node_modules/firebase-admin" ]; then
        echo "Backend dependencies missing. Installing express, cors, serialport, firebase, firebase-admin..."
        npm install express cors serialport firebase firebase-admin
    fi
else
    echo "ERROR: Could not find folder at $KIOSK_APP_DIR"
    exit 1
fi

# --- DISPLAY SETTINGS ---
export DISPLAY=:0
xset s off
xset -dpms
xset s noblank

# --- STARTUP UTILS ---
unclutter -idle 0.5 &

# --- START BACKEND SERVER ---
echo "Starting Backend Server..."
# Using the hardcoded path to Node to ensure it finds the command
/home/caj/.config/nvm/versions/node/v24.12.0/bin/node server.js > /home/caj/backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend started with PID: $BACKEND_PID"

# --- START REACT APP ---
echo "Starting React App..."
npm run dev &
FRONTEND_PID=$!

echo "Waiting 20 seconds for Vite to initialize..."
sleep 20

# --- LAUNCH CHROMIUM ---
echo "Launching Chromium in Kiosk mode..."
chromium --password-store=basic --kiosk --disable-restore-session-state --noerrdialogs --disable-gpu --disable-software-rasterizer http://localhost:5173 &

echo "--- Setup Complete. Waiting for processes... ---"

# --- KEEP SCRIPT ALIVE ---
wait $FRONTEND_PID