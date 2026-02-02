# --- IMPORTS ---
import firebase_admin
from firebase_admin import credentials, firestore
import serial
import serial.tools.list_ports
import time
import sys
import os
import json
import datetime

# FORCE FLUSHING OF LOGS
sys.stdout.reconfigure(line_buffering=True)

# --- CONFIGURATION ---
BAUD_RATE = 115200 
LOG_FILE = "gsm_logs.log"
STATE_FILE = "sys_state.json" # Local file for IPC
UPDATE_INTERVAL = 0.2         # Update local file every 0.2s

# --- LOGGING FUNCTION ---
def log_gsm(message):
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"📱 {timestamp} {message}")
    try:
        with open(LOG_FILE, "a") as f:
            f.write(f"[{timestamp}] {message}\n")
    except:
        pass

# --- FIREBASE SETUP ---
key_path = "serviceAccountKey.json" 

if not os.path.exists(key_path):
    print(f"❌ Error: {key_path} not found.")
    db = None
else:
    try:
        cred = credentials.Certificate(key_path)
        firebase_admin.initialize_app(cred)
        db = firestore.client()
        print("✅ [FIREBASE] Authenticated (Command/SMS Mode)")
    except Exception as e:
        print(f"⚠️ [FIREBASE] Init Error: {e}")
        db = None

# --- HARDWARE DETECTION (ROBUST MODE) ---
def find_ports():
    print("--- Scanning for Hardware ---")
    arduino_port = None
    gsm_port = None
    ports = serial.tools.list_ports.comports()
    
    for port in ports:
        # Filter for likely candidates (USB or ACM)
        if "USB" in port.device or "ACM" in port.device:
            try:
                print(f"🔎 Probing {port.device}...")
                s = serial.Serial(port.device, BAUD_RATE, timeout=1)
                
                # WAIT FOR ARDUINO REBOOT (Crucial Step)
                # Arduinos reset on serial connection. We must wait > 2s.
                time.sleep(3) 
                
                # --- CHECK 1: Look for 'DATA|' stream (Arduino) ---
                # We try reading a few times in case data is buffered or split
                is_arduino = False
                for _ in range(3):
                    if s.in_waiting > 0:
                        line = s.read(s.in_waiting).decode('utf-8', errors='ignore')
                        if "DATA|" in line:
                            arduino_port = port.device
                            print(f"✅ ARDUINO found on {port.device}")
                            is_arduino = True
                            break
                    time.sleep(1) # Wait a bit more if empty
                
                if is_arduino:
                    s.close()
                    continue

                # --- CHECK 2: Look for 'OK' response (GSM) ---
                # If not Arduino, send AT command
                s.write(b'AT\r\n')
                time.sleep(0.5)
                resp = s.read(s.in_waiting).decode('utf-8', errors='ignore')
                if "OK" in resp:
                    gsm_port = port.device
                    print(f"✅ GSM found on {port.device}")
                
                s.close()
            except Exception as e:
                print(f"   Probe error on {port.device}: {e}")

    return arduino_port, gsm_port

arduino_port, gsm_port = find_ports()
arduino = serial.Serial(arduino_port, BAUD_RATE, timeout=1) if arduino_port else None
gsm = serial.Serial(gsm_port, BAUD_RATE, timeout=1) if gsm_port else None

if not arduino: print("⚠️ Arduino not found (Check USB Cable)")
if not gsm: print("⚠️ GSM not found (Check USB Cable)")

# --- LISTENERS (INTERNET) ---

# 1. SMS Listener
def on_transaction_snapshot(col_snapshot, changes, read_time):
    for change in changes:
        if change.type.name in ['ADDED', 'MODIFIED']:
            data = change.document.to_dict()
            status = data.get('laundryStatus')
            phone = data.get('phoneNumber')
            trans_id = data.get('transactionId', 'N/A')
            pin = data.get('pin', 'N/A')

            if not phone or not gsm: continue
            
            msg = ""
            if status == 'Pending':
                msg = f"Locker Code: {pin}\nRef: {trans_id}"
            elif status == 'Done':
                msg = f"Laundry Ready!\nRef: {trans_id}"

            if msg:
                log_gsm(f"Sending SMS to {phone}")
                try:
                    gsm.write(b'AT+CMGF=1\r\n')
                    time.sleep(0.5)
                    gsm.write(f'AT+CMGS="{phone}"\r\n'.encode())
                    time.sleep(0.5)
                    gsm.write(msg.encode())
                    gsm.write(bytes([26])) 
                    time.sleep(3)
                except Exception as e:
                    log_gsm(f"SMS Error: {e}")

# 2. Command Listener (Unlock/Lock)
def on_command_snapshot(doc_snapshot, changes, read_time):
    for change in changes:
        if change.type.name == 'MODIFIED': 
            data = change.document.to_dict()
            action = data.get('action')
            locker_id = data.get('lockerId')
            
            if arduino and action and locker_id:
                cmd = f"{action.upper()}:{locker_id}\n"
                try:
                    arduino.write(cmd.encode())
                    print(f"📤 [REMOTE COMMAND] Sent: {cmd.strip()}")
                except Exception as e:
                    print(f"❌ Command Error: {e}")

if db:
    print("🎧 Listening for Firebase Commands & Transactions...")
    try:
        # Using simple on_snapshot to avoid 'filter' warning
        db.collection('transactions').where('laundryStatus', 'in', ['Pending', 'Done']).on_snapshot(on_transaction_snapshot)
        db.collection('commands').document('latest').on_snapshot(on_command_snapshot)
    except Exception as e:
        print(f"Listener Error: {e}")

# --- MAIN LOOP (LOCAL FILE WRITE) ---
print("🚀 Hybrid Bridge Running...")
last_file_update = 0

while True:
    if arduino and arduino.in_waiting:
        try:
            line = arduino.readline().decode('utf-8', errors='ignore').strip()
            if line.startswith("DATA"):
                # Write to local file for Node.js
                if time.time() - last_file_update > UPDATE_INTERVAL:
                    state = {
                        "raw_data": line,
                        "timestamp": time.time()
                    }
                    temp_file = STATE_FILE + ".tmp"
                    with open(temp_file, "w") as f:
                        json.dump(state, f)
                    os.replace(temp_file, STATE_FILE)
                    last_file_update = time.time()
                    
        except Exception as e:
            print(f"Serial Read Error: {e}")
    
    time.sleep(0.01)