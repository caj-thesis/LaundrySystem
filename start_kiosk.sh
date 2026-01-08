#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# --- ENABLE LOGGING ---
exec > /home/caj/kiosk.log 2>&1
echo "--- Kiosk Script Started: $(date) ---"

# --- AUTO-INSTALLER SECTION (System) ---
echo "Checking system dependencies..."
# Added 'libudev-dev' which is often needed for Arduino Serial communication
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

    # 2. Backend Install (Fixes 'Cannot find package express')
    if [ ! -d "node_modules/express" ] || [ ! -d "node_modules/serialport" ]; then
        echo "Backend dependencies missing. Installing express, cors, serialport..."
        npm install express cors serialport
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

# Fallback: If npm isn't found via NVM, try manual path
if ! command -v npm &> /dev/null; then
    echo "NVM failed to load. Using manual fallback..."
    MANUAL_NPM_PATH="/home/caj/.config/nvm/versions/node/v24.12.0/bin/npm"
    export PATH="$PATH:$(dirname "$MANUAL_NPM_PATH")"
fi

# --- START BACKEND SERVER ---
echo "Starting Backend Server..."
# Run server in background & save logs
node server.js > /home/caj/backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend started with PID: $BACKEND_PID"

# --- START REACT APP ---
echo "Starting React App..."

if command -v npm &> /dev/null; then
    echo "npm found at: $(which npm)"
    npm run dev &
    FRONTEND_PID=$!
else
    echo "CRITICAL ERROR: npm could not be found."
    exit 1
fi

echo "Waiting 20 seconds for Vite to initialize..."
sleep 20

# --- LAUNCH CHROMIUM ---
echo "Launching Chromium in Kiosk mode..."
chromium --password-store=basic --kiosk --disable-restore-session-state --noerrdialogs --disable-gpu --disable-software-rasterizer http://localhost:5173 &

echo "--- Setup Complete. Waiting for processes... ---"

# --- KEEP SCRIPT ALIVE ---
wait $FRONTEND_PID