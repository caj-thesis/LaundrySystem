#!/bin/bash

set -u

# --- 1. LOGGING & CLEANUP ---
exec > /home/caj/system_logs.log 2>&1
echo "--- Kiosk System Starting: $(date) ---"

echo "Cleaning up old processes..."
pkill -f "node server.js" || true
pkill -f "python3 -u hardware_bridge.py" || true
pkill -f "chromium" || true
fuser -k 5173/tcp 3000/tcp 2>/dev/null || true

# --- 2. ENVIRONMENT SETUP ---
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v npm >/dev/null 2>&1; then
    echo "NVM lookup failed. Using manual Node path fallback..."
    export PATH="/home/caj/.config/nvm/versions/node/v24.12.0/bin:$PATH"
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "CRITICAL ERROR: Node/NPM not found."
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "CRITICAL ERROR: python3 not found."
    exit 1
fi

# --- 3. PROJECT CHECKS ---
KIOSK_APP_DIR="/home/caj/laundry-system"
cd "$KIOSK_APP_DIR" || { echo "CRITICAL ERROR: $KIOSK_APP_DIR not found."; exit 1; }

REQUIRED_FILES=("package.json" "server.js" "hardware_bridge.py")
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "CRITICAL ERROR: required file missing: $file"
        exit 1
    fi
done

DEPENDENCIES=(unclutter x11-xserver-utils chromium libudev-dev)
MISSING_PACKAGES=()
for pkg in "${DEPENDENCIES[@]}"; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        MISSING_PACKAGES+=("$pkg")
    fi
done

if [ ${#MISSING_PACKAGES[@]} -gt 0 ]; then
    echo "Installing missing system packages: ${MISSING_PACKAGES[*]}"
    sudo apt-get update
    sudo apt-get install -y "${MISSING_PACKAGES[@]}"
fi

if [ ! -d "node_modules" ] || [ ! -d "node_modules/sql.js" ]; then
    echo "Installing Node dependencies..."
    if [ -f "package-lock.json" ]; then
        npm ci
    else
        npm install
    fi
fi

should_build_frontend() {
    local build_marker="dist/index.html"

    if [ ! -f "$build_marker" ]; then
        return 0
    fi

    local watched_files=(
        "index.html"
        "package.json"
        "package-lock.json"
        "vite.config.ts"
        "tsconfig.json"
        "tsconfig.app.json"
        "tsconfig.node.json"
    )

    local file
    for file in "${watched_files[@]}"; do
        if [ -f "$file" ] && [ "$file" -nt "$build_marker" ]; then
            return 0
        fi
    done

    if [ -d "src" ] && find src -type f -newer "$build_marker" | grep -q .; then
        return 0
    fi

    if [ -d "public" ] && find public -type f -newer "$build_marker" | grep -q .; then
        return 0
    fi

    return 1
}

if should_build_frontend; then
    echo "Frontend source changed or build missing. Building production frontend..."
    npm run build || { echo "CRITICAL ERROR: frontend build failed"; exit 1; }
fi

[ -f "locker_actions.json" ] || echo "[]" > locker_actions.json
[ -f "local_transactions.json" ] || echo "[]" > local_transactions.json
[ -f "local_settings.json" ] || echo "{}" > local_settings.json
[ -f "sys_state.json" ] || echo '{"raw_data":"","timestamp":0}' > sys_state.json

wait_for_http() {
    local url="$1"
    local label="$2"
    local timeout_seconds="${3:-30}"
    local elapsed=0
    local backend_pid="${BACKEND_PID:-}"
    local frontend_pid="${FRONTEND_PID:-}"

    while [ "$elapsed" -lt "$timeout_seconds" ]; do
        if command -v curl >/dev/null 2>&1; then
            if curl --silent --fail --max-time 2 "$url" >/dev/null 2>&1; then
                echo "$label is ready at $url"
                return 0
            fi
        elif command -v wget >/dev/null 2>&1; then
            if wget -q --spider --timeout=2 "$url"; then
                echo "$label is ready at $url"
                return 0
            fi
        else
            if python3 - <<PY >/dev/null 2>&1
import urllib.request
urllib.request.urlopen("$url", timeout=2)
PY
            then
                echo "$label is ready at $url"
                return 0
            fi
        fi

        if [ "$label" = "Backend Server" ] && [ -n "$backend_pid" ] && ! kill -0 "$backend_pid" >/dev/null 2>&1; then
            echo "CRITICAL ERROR: Backend Server exited before becoming ready."
            return 1
        fi

        if [ "$label" = "React Frontend" ] && [ -n "$frontend_pid" ] && ! kill -0 "$frontend_pid" >/dev/null 2>&1; then
            echo "CRITICAL ERROR: React Frontend exited before becoming ready."
            return 1
        fi

        sleep 1
        elapsed=$((elapsed + 1))
    done

    echo "CRITICAL ERROR: Timed out waiting for $label at $url"
    return 1
}

# --- 4. HARDWARE & BACKEND STARTUP ---
if [ ! -d "venv" ]; then
    echo "Python virtual environment not found. Creating it..."
    python3 -m venv venv || { echo "CRITICAL ERROR: failed to create venv"; exit 1; }
fi

source venv/bin/activate

if ! python3 -c "import serial" >/dev/null 2>&1; then
    echo "Installing Python runtime dependencies..."
    pip install --upgrade pip
    pip install pyserial || { echo "CRITICAL ERROR: failed to install pyserial"; exit 1; }
fi

echo "Starting hardware bridge..."
python3 -u hardware_bridge.py &
HARDWARE_PID=$!

echo "Starting backend server..."
node server.js &
BACKEND_PID=$!

wait_for_http "http://127.0.0.1:3000/api/status" "Backend Server" 30 || exit 1
wait_for_http "http://127.0.0.1:3000" "Kiosk Frontend" 10 || exit 1

# --- 5. DISPLAY & BROWSER ---
export DISPLAY=:0
xset s off && xset -dpms && xset s noblank
unclutter -idle 0.5 -root &

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
         http://localhost:3000 &
CHROMIUM_PID=$!

echo "--- Kiosk fully initialized. ---"
wait $BACKEND_PID
