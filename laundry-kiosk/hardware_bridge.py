# --- IMPORTS ---
import firebase_admin
from firebase_admin import credentials, firestore
import serial
import serial.tools.list_ports
import time
import sys
import os
import threading

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
        print("✅ Authenticated to Firebase")
    except Exception as e:
        print(f"⚠️ Firebase Init Error: {e}")
        db = None

# --- SMART PORT DETECTION ---
def probe_device(port_device):
    """Checks if a port is Arduino or GSM by testing communication"""
    print(f"🔎 Probing {port_device}...")
    try:
        # Open port safely
        ser = serial.Serial(port_device, BAUD_RATE, timeout=2)
        time.sleep(2) # Wait for device reboot (Arduino resets on connect)
        
        # TEST 1: Check for Arduino Data Stream
        # Arduino sends "DATA|..." continuously.
        if ser.in_waiting > 0:
            reading = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
            if "DATA|" in reading:
                ser.close()
                return "ARDUINO"
        
        # TEST 2: Check for GSM Command Response
        # GSM is silent until we speak to it.
        ser.write(b'AT\r\n')
        time.sleep(1)
        response = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
        if "OK" in response:
            ser.close()
            return "GSM"

        ser.close()
    except Exception as e:
        print(f"   (Probe failed: {e})")
    
    return None

def find_ports():
    found_arduino = None
    found_gsm = None
    ports = serial.tools.list_ports.comports()
    
    for port in ports:
        # Only check USB ports
        if "USB" in port.device or "ACM" in port.device:
            device_type = probe_device(port.device)
            
            if device_type == "ARDUINO":
                print(f"   ✅ Identified ARDUINO on {port.device}")
                found_arduino = port.device
            elif device_type == "GSM":
                print(f"   ✅ Identified GSM on {port.device}")
                found_gsm = port.device
            else:
                print(f"   (Unknown device on {port.device})")

    return found_arduino, found_gsm

# --- MAIN SETUP ---
arduino_port, gsm_port = find_ports()

arduino = None
gsm = None

# Connect to identified ports
if arduino_port:
    try:
        arduino = serial.Serial(arduino_port, BAUD_RATE, timeout=1)
        print("🔌 Arduino Connected.")
    except: pass

if gsm_port:
    try:
        gsm = serial.Serial(gsm_port, BAUD_RATE, timeout=1)
        print("🔌 GSM Connected.")
    except: pass

# --- SIMULATION STATE (If Arduino Missing) ---
sim_state = {
    "L1": {"weight": 0.0, "door": "CLOSED"},
    "L2": {"weight": 0.0, "door": "CLOSED"},
    "CREDIT": 0.0
}

def auto_scenario_runner():
    """Runs if Arduino is missing."""
    print("\n🤖 AUTO-SIMULATION ACTIVE (No Arduino Detected)")
    while True:
        sim_state["L1"] = {"weight": 0.0, "door": "CLOSED"}
        sim_state["CREDIT"] = 0.0
        time.sleep(5)

        # Open Door, Add Weight
        sim_state["L1"]["door"] = "OPEN"
        time.sleep(2)
        sim_state["L1"]["weight"] = 5.5
        time.sleep(2)
        sim_state["L1"]["door"] = "CLOSED"
        time.sleep(2)

        # Add Credit
        for i in range(1, 4):
            sim_state["CREDIT"] = float(i * 10)
            time.sleep(2)
        
        time.sleep(5)

# --- EXECUTION LOOP ---
# 1. SMS Listener
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
        # Listening for both Pending (initial drop-off) and Done
        query = db.collection('transactions').where('laundryStatus', 'in', ['Pending', 'Done'])
        query.on_snapshot(on_snapshot)
    except Exception as e:
        print(f"Error setting up snapshot: {e}")

# 2. Main Logic
if not arduino:
    # Start Simulation
    t = threading.Thread(target=auto_scenario_runner, daemon=True)
    t.start()
    
    # Sync Loop (Simulated)
    try:
        while True:
            data_str = f"DATA|L1:{sim_state['L1']['weight']}:{sim_state['L1']['door']}|L2:{sim_state['L2']['weight']}:{sim_state['L2']['door']}|CREDIT:{sim_state['CREDIT']}"
            if db:
                db.collection('kiosks').document('main_unit').set({
                    "raw_data": data_str,
                    "lastUpdated": firestore.SERVER_TIMESTAMP
                }, merge=True)
            time.sleep(0.5)
    except KeyboardInterrupt: pass

else:
    # Sync Loop (Real Arduino)
    print("🚀 Bridge Running (Hardware Mode)...")
    try:
        while True:
            if arduino.in_waiting > 0:
                line = arduino.readline().decode('utf-8', errors='ignore').strip()
                if line.startswith("DATA") and db:
                    print(f"🔄 {line}")
                    db.collection('kiosks').document('main_unit').set({
                        "raw_data": line,
                        "lastUpdated": firestore.SERVER_TIMESTAMP
                    }, merge=True)
            time.sleep(0.1)
    except KeyboardInterrupt: pass