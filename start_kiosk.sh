#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# --- ENABLE LOGGING ---
exec > /home/caj/kiosk.log 2>&1
echo "--- Kiosk Script Started: $(date) ---"

# --- AUTO-INSTALLER SECTION ---
echo "Checking system dependencies..."
# Use 'chromium' for Debian Trixie compatibility
DEPENDENCIES=(unclutter x11-xserver-utils chromium)

for pkg in "${DEPENDENCIES[@]}"; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        echo "Installing missing package: $pkg"
        sudo apt-get update && sudo apt-get install -y "$pkg"
    else
        echo "Package $pkg is already installed."
    fi
done

# --- AUTO-DEPENDENCY CHECK ---
cd /home/caj/laundry-kiosk || exit 1

if [ ! -d "node_modules" ]; then
    echo "node_modules not found. Automatically installing dependencies..."
    # Running with --no-audit and --no-fund makes it faster and uses less memory
    npm install --no-audit --no-fund || { echo "npm install failed"; exit 1; }
fi

# --- PROJECT SETUP ---
KIOSK_APP_DIR="/home/caj/laundry-kiosk"

if [ -d "$KIOSK_APP_DIR" ]; then
    echo "Changing directory to $KIOSK_APP_DIR..."
    cd "$KIOSK_APP_DIR" || exit 1
    
    # Install node_modules if they are missing
    if [ ! -d "node_modules" ]; then
        echo "node_modules not found. Installing project dependencies..."
        npm install
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

# --- STARTUP ---
unclutter -idle 0.5 &

echo "Starting React App..."

# --- OPTION A: Try to load NVM ---
export NVM_DIR="$HOME/.nvm"
# This weird syntax (\.) is required for scripts
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" 

# --- OPTION B: Fallback if NVM failed ---
# If 'npm' is still not found, add the specific path manually
if ! command -v npm &> /dev/null; then
    echo "NVM failed to load npm. Using manual fallback path..."
    
    # !!! IMPORTANT: RUN 'which npm' IN TERMINAL AND PASTE THE RESULT BELOW !!!
    # It should look like: /home/caj/.nvm/versions/node/vXX.X.X/bin/npm
    MANUAL_NPM_PATH="/home/caj/.config/nvm/versions/node/v24.12.0/bin/npm"
    
    # This adds the folder containing npm to the system PATH
    export PATH="$PATH:$(dirname "$MANUAL_NPM_PATH")"
fi

# --- VERIFY & RUN ---
if command -v npm &> /dev/null; then
    echo "npm found at: $(which npm)"
    npm run dev &
else
    echo "CRITICAL ERROR: npm could not be found via NVM or Manual Path."
    exit 1
fi

echo "Waiting 20 seconds for Vite to initialize..."
sleep 20

echo "Launching Chromium in Kiosk mode..."
# Added GPU/Vulkan fix flags based on your crash logs
chromium --password-store=basic --kiosk --disable-restore-session-state --noerrdialogs --disable-gpu --disable-software-rasterizer http://localhost:5173 &

echo "--- Script Setup Complete ---"
