#!/bin/bash

# --- ENABLE LOGGING ---
# This writes all errors to a file named 'kiosk.log' in your home folder
exec > /home/caj/kiosk.log 2>&1

echo "--- Kiosk Script Started: $(date) ---"

# 1. Screen Settings
echo "Setting display..."
export DISPLAY=:0
xset s off
xset -dpms
xset s noblank

# 2. Hide Mouse
echo "Starting unclutter..."
unclutter -idle 0.5 &

# 3. Go to folder
echo "Changing directory to /home/caj/laundry-kiosk..."
cd /home/caj/laundry-kiosk || { echo "ERROR: Could not find folder!"; exit 1; }

# 4. Start React
echo "Starting React..."
# We use the full path to npm just in case
/usr/bin/npm run dev &

# 5. Wait
echo "Waiting 15 seconds..."
sleep 15

# 6. Launch Browser
echo "Launching Chromium..."
/usr/bin/chromium --password-store=basic --kiosk --disable-restore-session-state --noerrdialogs http://localhost:5173

echo "--- Script Finished ---"
