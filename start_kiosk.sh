#!/bin/bash

# --- 1. LOGGING & CLEANUP ---
# UPDATED: Direct all output to a singular 'system_logs.log' file
exec > /home/caj/system_logs.log 2>&1
echo "--- Kiosk System Starting: $(date) ---"

echo "🧹 Cleaning up old processes..."
pkill -f "node server.js" || true
pkill -f "python3 hardware_bridge.py" || true
pkill -f "chromium" || true
fuser -k 5173/tcp 3000/tcp 2>/dev/null || true 

# --- 2. ENVIRONMENT SETUP ---
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v npm &> /dev/null; then
    echo "NVM failed. Using manual path fallback..."
    export PATH="/home/caj/.config/nvm/versions/node/v24.12.0/bin:$PATH"
fi

if ! command -v npm &> /dev/null; then
    echo "CRITICAL ERROR: Node/NPM not found."
    exit 1
fi

# --- 3. SYSTEM & PROJECT CHECKS ---
KIOSK_APP_DIR="/home/caj/laundry-kiosk"
cd "$KIOSK_APP_DIR" || { echo "Directory not found"; exit 1; }

# Check for Firebase Key
if [ ! -f "serviceAccountKey.json" ]; then
    echo "CRITICAL ERROR: serviceAccountKey.json is missing!"
    exit 1
fi

# Check for system packages
DEPENDENCIES=(unclutter x11-xserver-utils chromium libudev-dev)
for pkg in "${DEPENDENCIES[@]}"; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        echo "Installing missing package: $pkg"
        sudo apt-get update && sudo apt-get install -y "$pkg"
    fi
done

# Ensure Node modules are installed
if [ ! -d "node_modules" ] || [ ! -d "node_modules/firebase" ]; then
    echo "Installing/Updating Node dependencies..."
    npm install express cors serialport firebase --save
fi

# --- 4. HARDWARE & BACKEND STARTUP ---
# Start Python Hardware Bridge
if [ -f "hardware_bridge.py" ]; then
    if [ -d "venv" ]; then
        source venv/bin/activate
        echo "Starting Hardware Bridge..."
        # -u ensures output is unbuffered and appears immediately in the log
        python3 -u hardware_bridge.py &
    else
        echo "WARNING: venv not found. Trying global python..."
        python3 -u hardware_bridge.py &
    fi
else
    echo "CRITICAL ERROR: hardware_bridge.py not found in $(pwd)"
fi

# Start Node Backend
echo "Starting Backend Server..."
# UPDATED: Removed redirection to backend.log so it inherits system_logs.log
node server.js &

# Start React Frontend
echo "Starting React Frontend..."
npm run dev -- --port 5173 --strictPort &
FRONTEND_PID=$!

# --- 5. DISPLAY & BROWSER ---
export DISPLAY=:0
xset s off && xset -dpms && xset s noblank
unclutter -idle 0.5 -root &

echo "Waiting 20 seconds for full initialization..."
sleep 20

echo "Launching Chromium..."
chromium --no-sandbox \
         --kiosk \
         --disable-gpu \
         --disable-software-rasterizer \
         --noerrdialogs \
         --disable-session-crashed-bubble \
         --disable-infobars \
         --disable-notifications \
         --password-store=basic \
         --disable-background-networking \
         --disable-sync \
         --disable-features=TranslateUI,OptimizationHints,MediaRouter \
         http://localhost:5173 &

echo "--- Kiosk fully initialized. ---"
wait $FRONTEND_PID