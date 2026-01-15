#!/bin/bash

# --- ENABLE LOGGING ---
exec > /home/caj/kiosk.log 2>&1
echo "--- Kiosk Script Started: $(date) ---"

# --- ENVIRONMENT SETUP (MOVED TO TOP) ---
export NVM_DIR="$HOME/.nvm"
# Fixed typo: changed "\." to "." to correctly source the file if it exists
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Fallback: Check if npm is found; if not, force the manual path
if ! command -v npm &> /dev/null; then
    echo "NVM failed to load. Using manual fallback..."
    # Derived from the path found in your original script
    MANUAL_NODE_HOME="/home/caj/.config/nvm/versions/node/v24.12.0"
    export PATH="$MANUAL_NODE_HOME/bin:$PATH"
fi

# Verification: Exit early if npm is still missing
if ! command -v npm &> /dev/null; then
    echo "CRITICAL ERROR: npm could not be found in PATH."
    echo "Current PATH: $PATH"
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

    # 2. Backend Install (UPDATED: Added firebase)
    # Checks if express, serialport OR firebase are missing
    if [ ! -d "node_modules/express" ] || [ ! -d "node_modules/serialport" ] || [ ! -d "node_modules/firebase" ]; then
        echo "Backend dependencies missing. Installing express, cors, serialport, firebase..."
        # ADDED --save to update package.json
        npm install express cors serialport firebase --save
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
# We can now rely on the 'node' command being in the PATH
node server.js > /home/caj/backend.log 2>&1 &
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
# Added --disable-background-networking --disable-sync to fix QUOTA_EXCEEDED error
chromium --password-store=basic --kiosk --disable-restore-session-state --noerrdialogs --disable-gpu --disable-software-rasterizer --disable-background-networking --disable-sync http://localhost:5173 &

echo "--- Setup Complete. Waiting for processes... ---"

# --- KEEP SCRIPT ALIVE ---
wait $FRONTEND_PID