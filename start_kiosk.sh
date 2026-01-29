#!/bin/bash

# --- 1. LOGGING & CLEANUP ---
exec > /home/caj/kiosk.log 2>&1
echo "--- Kiosk System Starting: $(date) ---"

echo "🧹 Cleaning up old processes..."
pkill -f "node server.js" || true
pkill -f "python3 hardware_bridge.py" || true
pkill -f "chromium" || true
fuser -k 5173/tcp 3000/tcp 2>/dev/null || true 

# --- 2. ENVIRONMENT SETUP ---
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Fallback for Node if NVM fails
if ! command -v npm &> /dev/null; then
    echo "NVM failed. Using manual path fallback..."
    export PATH="/home/caj/.config/nvm/versions/node/v24.12.0/bin:$PATH"
fi

# Exit if Node is still not found
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
DEPENDENCIES=(unclutter x11-xserver-utils chromium-browser libudev-dev)
for pkg in "${DEPENDENCIES[@]}"; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
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
if [ -d "venv" ]; then
    source venv/bin/activate
    echo "Starting Hardware Bridge..."
    python3 hardware_bridge.py &
else
    echo "WARNING: venv not found. Hardware bridge might fail."
fi

# Start Node Backend
echo "Starting Backend Server..."
node server.js > /home/caj/backend.log 2>&1 &

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