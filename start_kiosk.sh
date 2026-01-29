#!/bin/bash
# --- ENABLE LOGGING ---
exec > /home/caj/kiosk.log 2>&1
echo "--- Kiosk Script Started: $(date) ---"

# --- CLEANUP (Fixes 'Killed' errors) ---
echo "🧹 Killing old processes..."
pkill -f "node server.js" || true
pkill -f "python3 hardware_bridge.py" || true
pkill -f "chromium" || true
# Free up ports
fuser -k 5173/tcp 3000/tcp 2>/dev/null || true 

# --- ENVIRONMENT ---
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# --- PROJECT SETUP ---
KIOSK_APP_DIR="/home/caj/laundry-kiosk"
cd "$KIOSK_APP_DIR" || exit 1

# --- FIREBASE KEY CHECK ---
if [ ! -f "serviceAccountKey.json" ]; then
    echo "CRITICAL ERROR: serviceAccountKey.json is missing!"
    exit 1
fi

# --- START HARDWARE BRIDGE ---
echo "Verifying Python dependencies..."
if [ -d "venv" ]; then
    source venv/bin/activate
    python3 hardware_bridge.py &
else
    echo "ERROR: 'venv' directory not found."
    exit 1
fi

# --- START BACKEND & UI ---
echo "Starting Node.js Server..."
node server.js > /home/caj/backend.log 2>&1 &

echo "Starting React App..."
npm run dev -- --port 5173 --strictPort &

echo "Waiting 15 seconds for initialization..."
sleep 15

# --- LAUNCH CHROMIUM ---
export DISPLAY=:0
xset s off && xset -dpms && xset s noblank
unclutter -idle 0.5 -root &

chromium --no-sandbox \
         --kiosk \
         --disable-gpu \
         --disable-software-rasterizer \
         --noerrdialogs \
         --disable-session-crashed-bubble \
         --disable-infobars \
         --disable-notifications \
         --disable-component-update \
         --disable-background-networking \
         --password-store=basic \
         --disable-virtual-keyboard \
         --disable-features=TranslateUI,OptimizationHints,MediaRouter \
         http://localhost:5173 &

echo "--- Setup Complete. ---"
wait