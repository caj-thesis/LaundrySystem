# --- IMPORTS ---
import firebase_admin
from firebase_admin import credentials, firestore
import serial
import serial.tools.list_ports
import time
import sys
import os

# FORCE FLUSHING OF LOGS
sys.stdout.reconfigure(line_buffering=True)

# --- CONFIGURATION ---
BAUD_RATE = 115200 

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
        print("✅ [FIREBASE] Authenticated")
    except Exception as e:
        print(f"⚠️ [FIREBASE] Init Error: {e}")
        db = None

# --- SMART PORT DETECTION ---
def probe_device(port_device):
    """Checks if a port is Arduino or GSM by testing communication"""
    print(f"🔎 Probing {port_device}...")
    try:
        ser = serial.Serial(port_device, BAUD_RATE, timeout=2)
        time.sleep(2) 
        
        # TEST 1: Check for Arduino Data Stream
        if ser.in_waiting > 0:
            reading = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
            if "DATA|" in reading:
                ser.close()
                return "ARDUINO"
        
        # TEST 2: Check for GSM Command Response
        ser.write(b'AT\r\n')
        time.sleep(1)
        response = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
        if "OK" in response:
            ser.close()
            return "GSM"

        ser.close()
    except Exception as e:
        print(f"   (Probe failed on {port_device}: {e})")
    
    return None

def find_ports():
    print("--- Scanning for Hardware ---")
    found_arduino = None
    found_gsm = None
    ports = serial.tools.list_ports.comports()
    
    if not ports:
        print("⚠️ No USB devices found!")

    for port in ports:
        if "USB" in port.device or "ACM" in port.device:
            device_type = probe_device(port.device)
            
            if device_type == "ARDUINO":
                print(f"✅ [HARDWARE] Identified ARDUINO on {port.device}")
                found_arduino = port.device
            elif device_type == "GSM":
                print(f"✅ [HARDWARE] Identified GSM on {port.device}")
                found_gsm = port.device
            else:
                print(f"❓ [HARDWARE] Unknown device on {port.device}")

    return found_arduino, found_gsm

# --- MAIN SETUP ---
arduino_port, gsm_port = find_ports()

arduino = None
gsm = None

if arduino_port:
    try:
        arduino = serial.Serial(arduino_port, BAUD_RATE, timeout=1)
        print(f"🔌 [ARDUINO] Connected Successfully on {arduino_port}")
    except Exception as e: 
        print(f"❌ [ARDUINO] Connection Failed: {e}")
else:
    print("⚠️ [ARDUINO] Not found during scan.")

if gsm_port:
    try:
        gsm = serial.Serial(gsm_port, BAUD_RATE, timeout=1)
        print(f"🔌 [GSM] Connected Successfully on {gsm_port}")
    except Exception as e: 
        print(f"❌ [GSM] Connection Failed: {e}")
else:
    print("⚠️ [GSM] Not found during scan.")

# --- SMS LISTENER ---
def on_snapshot(col_snapshot, changes, read_time):
    for change in changes:
        # Check for NEW transactions (Added) or Status Updates (Modified)
        if change.type.name in ['ADDED', 'MODIFIED']:
            data = change.document.to_dict()
            status = data.get('laundryStatus')
            phone = data.get('phoneNumber')
            trans_id = data.get('transactionId', 'N/A')
            pin = data.get('pin', 'N/A')

            if not phone or not gsm:
                if not gsm and phone:
                    print(f"⚠️ Cannot send SMS to {phone}: GSM not connected.")
                continue

            message = ""
            if status == 'Pending':
                message = f"Drop-off Confirmed!\nID: {trans_id}\nPIN: {pin}\nStatus: {status}"
            elif status == 'Done':
                message = f"Laundry Ready!\nID: {trans_id}\nStatus: {status}"

            if message:
                try:
                    gsm.write(b'AT+CMGF=1\r\n')
                    time.sleep(0.5)
                    gsm.write(f'AT+CMGS="{phone}"\r\n'.encode())
                    time.sleep(0.5)
                    gsm.write(message.encode())
                    gsm.write(bytes([26]))
                    print(f"✅ SMS Sent to {phone}: {status}")
                    
                    # Log the SMS event
                    with open("sms_history.log", "a") as f:
                        f.write(f"{time.ctime()} | TO: {phone} | MSG: {message.replace('\\n', ' ')}\n")
                except Exception as e:
                    print(f"❌ SMS Failed: {e}")

# Update the query to listen for all relevant statuses
if db:
    try:
        print("🎧 Listening for Firebase transactions...")
        # Listening for both Pending (initial drop-off) and Done
        query = db.collection('transactions').where('laundryStatus', 'in', ['Pending', 'Done'])
        query.on_snapshot(on_snapshot)
    except Exception as e:
        print(f"Error setting up snapshot: {e}")

# --- MAIN EXECUTION LOOP ---
if not arduino:
    print("⚠️ WARNING: Arduino not detected. Hardware sync disabled.")
if not gsm:
    print("⚠️ WARNING: GSM not detected. SMS notifications disabled.")

print("🚀 Bridge Running (Production Mode)...")

try:
    while True:
        # 1. Read from Arduino (if connected)
        if arduino and arduino.in_waiting > 0:
            try:
                line = arduino.readline().decode('utf-8', errors='ignore').strip()
                if line.startswith("DATA") and db:
                    print(f"🔄 {line}")
                    # Push hardware state to Firebase for the Kiosk UI
                    db.collection('kiosks').document('main_unit').set({
                        "raw_data": line,
                        "lastUpdated": firestore.SERVER_TIMESTAMP
                    }, merge=True)
            except Exception as e:
                print(f"❌ Error reading Arduino: {e}")

        # 2. Keep script alive
        time.sleep(0.1)

except KeyboardInterrupt:
    print("\n🛑 Bridge Stopped by User")
    if arduino: arduino.close()
    if gsm: gsm.close()