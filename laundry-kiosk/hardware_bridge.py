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
STATE_FILE = "sys_state.json" 
UPDATE_INTERVAL = 0.2         

# --- LOGGING ---
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
        print("✅ [FIREBASE] Authenticated (Locker/SMS Mode)")
    except Exception as e:
        print(f"⚠️ [FIREBASE] Init Error: {e}")
        db = None

# --- HARDWARE DETECTION ---
def find_ports():
    print("--- Scanning for Hardware ---")
    arduino_port = None
    gsm_port = None
    ports = serial.tools.list_ports.comports()
    
    for port in ports:
        if "USB" in port.device or "ACM" in port.device:
            try:
                print(f"🔎 Probing {port.device}...")
                s = serial.Serial(port.device, BAUD_RATE, timeout=1)
                time.sleep(3) 
                
                # Check 1: Arduino (DATA|)
                is_arduino = False
                for _ in range(3):
                    if s.in_waiting > 0:
                        line = s.read(s.in_waiting).decode('utf-8', errors='ignore')
                        if "DATA|" in line:
                            arduino_port = port.device
                            print(f"✅ ARDUINO found on {port.device}")
                            is_arduino = True
                            break
                    time.sleep(1) 
                
                if is_arduino:
                    s.close()
                    continue

                # Check 2: GSM (OK)
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

# --- STATE TRACKING ---
# Keeps track of the last known physical state to prevent infinite loops
local_door_states = { "1": None, "2": None, "3": None }

# --- LISTENERS ---

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

# 2. Locker Action Listener (Fixed: Translates LOCK/UNLOCK to Single Chars)
def on_locker_snapshot(col_snapshot, changes, read_time):
    for change in changes:
        if change.type.name == 'MODIFIED': 
            data = change.document.to_dict()
            locker_id = change.document.id
            action = data.get('action')
            
            # Translate 'LOCK'/'UNLOCK' to Arduino Single Chars
            # Locker 1: Unlock='1', Lock='4'
            # Locker 2: Unlock='2', Lock='5'
            cmd_char = None
            
            if action:
                act = action.upper()
                if locker_id == '1':
                    if act == 'UNLOCK': cmd_char = '1'
                    elif act == 'LOCK': cmd_char = '4'
                elif locker_id == '2':
                    if act == 'UNLOCK': cmd_char = '2'
                    elif act == 'LOCK': cmd_char = '5'
                elif locker_id == '3':
                    if act == 'UNLOCK': cmd_char = '3'
                    elif act == 'LOCK': cmd_char = '6'

            if arduino and cmd_char:
                try:
                    arduino.write(cmd_char.encode())
                    print(f"📤 [FIREBASE] Received Action: {action} -> Sent Command: '{cmd_char}'")
                except Exception as e:
                    print(f"❌ Serial Write Error: {e}")

if db:
    print("🎧 Listening for Firebase 'lockers' & 'transactions'...")
    try:
        db.collection('transactions').where('laundryStatus', 'in', ['Pending', 'Done']).on_snapshot(on_transaction_snapshot)
        db.collection('lockers').on_snapshot(on_locker_snapshot)
    except Exception as e:
        print(f"Listener Error: {e}")

# --- MAIN LOOP ---
print("🚀 Hybrid Bridge Running...")
last_file_update = 0

while True:
    if arduino and arduino.in_waiting:
        try:
            line = arduino.readline().decode('utf-8', errors='ignore').strip()
            
            # --- HANDLE DATA STREAM & SYNC TO FIREBASE ---
            if line.startswith("DATA"):
                # 1. Update Local JSON (Existing Logic)
                if time.time() - last_file_update > UPDATE_INTERVAL:
                    state = { "raw_data": line, "timestamp": time.time() }
                    temp_file = STATE_FILE + ".tmp"
                    with open(temp_file, "w") as f:
                        json.dump(state, f)
                    os.replace(temp_file, STATE_FILE)
                    last_file_update = time.time()

                # 2. Parse & Sync to Firebase Action Field (New Logic)
                # Format: DATA|L1:Wt:Door|L2:Wt:Door...
                parts = line.split('|')
                for part in parts:
                    if part.startswith('L') and ':' in part:
                        # Example part: "L1:0.0:CLOSED"
                        try:
                            l_data = part.split(':')
                            l_id = l_data[0].replace('L', '') 
                            door_status = l_data[2]      
                            
                            if local_door_states.get(l_id) != door_status:
                                local_door_states[l_id] = door_status
                                
                                new_action = 'lock' if door_status == 'CLOSED' else 'unlock'
                                
                                if db:
                                    # Only update the status, never change the 'action' based on sensor data
                                    print(f"🔄 [SYNC] Locker {l_id} status update -> {door_status}")
                                    db.collection('lockers').document(l_id).update({
                                        'doorStatus': door_status 
                                    })
                        except Exception as parse_err:
                            print(f"Parse Error on part '{part}': {parse_err}")

        except Exception as e:
            print(f"Serial Read Error: {e}")
    
    time.sleep(0.01)