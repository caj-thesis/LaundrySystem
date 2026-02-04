import firebase_admin
from firebase_admin import credentials, firestore
import serial
import serial.tools.list_ports
import time
import sys
import os

# --- CONFIGURATION ---
BAUD_RATE = 9600  # Matched to your working Arduino Config
KEY_PATH = "serviceAccountKey.json" 
LED_RED = 'r'
LED_GREEN = 'g'
LED_YELLOW = 'y'

# --- FIREBASE SETUP ---
if not os.path.exists(KEY_PATH):
    print(f"❌ Error: {KEY_PATH} not found.")
    sys.exit(1)

try:
    cred = credentials.Certificate(KEY_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("✅ [FIREBASE] Authenticated (Anti-Spam Bridge)")
except Exception as e:
    print(f"❌ Firebase Error: {e}")
    sys.exit(1)

arduino = None
gsm = None

def find_and_connect():
    global arduino, gsm
    if arduino is None:
        ports = serial.tools.list_ports.comports()
        for port in ports:
            if "USB" in port.device or "ACM" in port.device:
                try:
                    s = serial.Serial(port.device, BAUD_RATE, timeout=1)
                    time.sleep(2) 
                    s.reset_input_buffer()
                    
                    start_check = time.time()
                    is_arduino = False
                    while time.time() - start_check < 2:
                        if s.in_waiting:
                            line = s.readline().decode('utf-8', errors='ignore').strip()
                            if "DATA" in line:
                                is_arduino = True
                                break
                    if is_arduino:
                        arduino = s
                        print(f"✅ FOUND ARDUINO on {port.device}!")
                    else:
                        s.close()
                except:
                    pass

def send_arduino_command(cmd):
    if arduino and arduino.is_open:
        try:
            arduino.write(f"{cmd}\n".encode('utf-8'))
            print(f"📤 Sent: {cmd}")
        except:
            pass

def update_locker_led(locker_id, data):
    status = data.get('status', '').lower()
    color = LED_RED
    if status == 'available': color = LED_GREEN
    elif data.get('currentTransactionId'): color = LED_YELLOW # Simplified
    send_arduino_command(f"{color}{locker_id}")

def on_locker_snapshot(col_snapshot, changes, read_time):
    for change in changes:
        if change.type.name in ['ADDED', 'MODIFIED']:
            data = change.document.to_dict()
            locker_id = change.document.id
            update_locker_led(locker_id, data)
            action = data.get('action')
            if action:
                cmd = 'u' if action.upper() == 'UNLOCK' else 'l'
                send_arduino_command(f"{cmd}{locker_id}")

if db:
    db.collection('lockers').on_snapshot(on_locker_snapshot)

# --- MAIN LOOP ---
print("🚀 Bridge Started.")
local_status_cache = {}

while True:
    if arduino is None:
        find_and_connect()
        time.sleep(2)
        continue 

    try:
        if arduino.in_waiting:
            line = arduino.readline().decode('utf-8', errors='ignore').strip()
            
            if line.startswith("DATA"):
                parts = line.split('|')
                for part in parts:
                    if part.startswith("L") and ":" in part:
                        try:
                            # Parse: L1:0.0:CLOSED:1
                            seg = part.split(':')
                            l_id = seg[0].replace('L', '')
                            door = seg[2]
                            conn_status = "Online" if seg[3] == "1" else "Offline"
                            
                            current_state = f"{door}_{conn_status}"
                            
                            # CRITICAL FIX: Check Cache BEFORE trying Firebase
                            if local_status_cache.get(l_id) != current_state:
                                print(f"🔄 Locker {l_id}: {conn_status} | {door}")
                                
                                # 1. Update Cache IMMEDIATELY to stop the loop
                                local_status_cache[l_id] = current_state
                                
                                # 2. Try Firebase (If it fails, we won't retry instantly)
                                if db:
                                    try:
                                        db.collection('lockers').document(l_id).update({
                                            'doorStatus': door,
                                            'connectionStatus': conn_status,
                                            'lastUpdate': firestore.SERVER_TIMESTAMP
                                        })
                                    except Exception as db_e:
                                        print(f"⚠️ Firebase Write Failed (Quota/Net): {db_e}")
                                        
                        except Exception as parse_e:
                            pass
                            
    except Exception as e:
        print(f"❌ Connection Error: {e}")
        if arduino: arduino.close()
        arduino = None

    time.sleep(0.01)