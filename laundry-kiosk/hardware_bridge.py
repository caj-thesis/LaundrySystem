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
LOCKER_ACTIONS_FILE = "locker_actions.json"
SMS_QUEUE_FILE = "sms_queue.json"  # 🚀 NEW: SMS Queue File
UPDATE_INTERVAL = 0.2 
RECONNECT_INTERVAL = 3.0        

# --- LED COLOR DEFINITIONS ---
LED_OFF = 0
LED_RED = 1
LED_GREEN = 2
LED_BLUE = 3
LED_YELLOW = 4

# --- GLOBAL STATE ---
SHOP_NAME = "CAJ LAUNDRY LOCKER CO." # Default name

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
        print("✅ [FIREBASE] Authenticated")
    except Exception as e:
        print(f"⚠️ [FIREBASE] Init Error: {e}")
        db = None

# --- DYNAMIC PORT DISCOVERY ---
def find_ports():
    print("🔎 Scanning ports for devices...")
    ports = serial.tools.list_ports.comports()
    found_arduino = None
    found_gsm = None

    for port in ports:
        if "ttyAMA" in port.device: 
            continue
        
        print(f"   👉 Testing {port.device}...")
        try:
            with serial.Serial(port.device, BAUD_RATE, timeout=1.5) as s:
                time.sleep(2) 
                
                # 1. TEST FOR GSM 
                s.write(b'AT\r\n')
                time.sleep(0.5)
                response = s.read_all().decode('utf-8', errors='ignore')
                
                if "OK" in response:
                    print(f"      📱 IDENTIFIED: GSM Module on {port.device}")
                    found_gsm = port.device
                    continue 

                # 2. TEST FOR ARDUINO 
                start_time = time.time()
                while time.time() - start_time < 3.0:
                    line = s.readline().decode('utf-8', errors='ignore').strip()
                    if line.startswith("DATA"):
                        print(f"      🤖 IDENTIFIED: Arduino on {port.device}")
                        found_arduino = port.device
                        break
        except Exception as e:
            print(f"      ⚠️ Could not read {port.device}: {e}")
            continue
            
    return found_arduino, found_gsm

# --- HARDWARE CONNECTION ---
def connect_hardware():
    print("--- Connecting to Hardware ---")
    ard_path, gsm_path = find_ports()
    
    ard = None
    if ard_path:
        try:
            print(f"🔌 Opening Arduino Connection at {ard_path}...")
            ard = serial.Serial(ard_path, BAUD_RATE, timeout=1)
            time.sleep(2) 
            print(f"✅ ARDUINO connected.")
        except Exception as e:
            print(f"⚠️ Arduino Connection Failed: {e}")
    else:
        print("❌ ARDUINO NOT DETECTED during scan.")

    modem = None
    if gsm_path:
        try:
            print(f"🔌 Opening GSM Connection at {gsm_path}...")
            modem = serial.Serial(gsm_path, BAUD_RATE, timeout=1)
            modem.write(b'AT\r\n')
            time.sleep(0.5)
            print(f"✅ GSM connected.")
        except Exception as e:
            print(f"⚠️ GSM Connection Failed: {e}")
    else:
        print("❌ GSM MODULE NOT DETECTED during scan.")

    return ard, modem

def reconnect_arduino_if_needed(current_arduino, last_attempt_ts):
    if current_arduino and current_arduino.is_open:
        return current_arduino, last_attempt_ts

    now = time.time()
    if now - last_attempt_ts < RECONNECT_INTERVAL:
        return current_arduino, last_attempt_ts

    print("🔁 Attempting Arduino reconnection...")
    new_arduino, _ = connect_hardware()
    if new_arduino and new_arduino.is_open:
        print("✅ Arduino reconnected. Restoring local hardware stream.")
        return new_arduino, now

    return current_arduino, now


arduino, gsm = connect_hardware()

# --- STATE TRACKING ---
local_door_states = { "1": None, "2": None, "3": None }
local_connection_states = { "1": None, "2": None, "3": None }

# --- LED CONTROL FUNCTIONS ---
def send_led_command(locker_id, color_code):
    action_char = None
    if color_code == LED_RED:      action_char = 'r'
    elif color_code == LED_GREEN:  action_char = 'g'
    elif color_code == LED_YELLOW: action_char = 'y'
    elif color_code == LED_BLUE:   action_char = 'r' 

    if arduino and arduino.is_open and action_char:
        try:
            command = f"{action_char}{locker_id}\n"
            arduino.write(command.encode('utf-8'))
        except Exception as e:
            print(f"❌ LED Write Error: {e}")

def process_locker_leds(locker_id, locker_data):
    raw_status = locker_data.get('collectionStatus', locker_data.get('status', ''))
    is_connected = locker_data.get('isConnected', True)
    if not is_connected:
        send_led_command(locker_id, LED_RED) 
        return

    status = raw_status.lower()
    if status == 'available':
        send_led_command(locker_id, LED_GREEN)
        return 

    current_tx_id = locker_data.get('currentTransactionId')
    is_done = False
    if current_tx_id and db:
        try:
            tx_ref = db.collection('transactions').document(current_tx_id)
            tx_doc = tx_ref.get()
            if tx_doc.exists:
                tx_data = tx_doc.to_dict()
                if tx_data.get('laundryStatus', '') == 'Done':
                    is_done = True
        except Exception as e:
            pass

    if is_done:
        send_led_command(locker_id, LED_YELLOW)
    else:
        send_led_command(locker_id, LED_RED)

# --- LISTENERS ---
def on_settings_snapshot(col_snapshot, changes, read_time):
    global SHOP_NAME
    for change in changes:
        if change.type.name in ['ADDED', 'MODIFIED']:
            data = change.document.to_dict()
            name = data.get('laundryShopName', "CAJ LAUNDRY LOCKER CO.")
            SHOP_NAME = name.upper() 
            print(f"⚙️ Shop Name Updated: {SHOP_NAME}")

def on_locker_snapshot(col_snapshot, changes, read_time):
    for change in changes:
        if change.type.name in ['ADDED', 'MODIFIED']: 
            data = change.document.to_dict()
            locker_id = change.document.id
            process_locker_leds(locker_id, data)

            action = data.get('action')
            cmd_prefix = None
            if action:
                act = action.upper()
                if act == 'UNLOCK': cmd_prefix = 'u'
                elif act == 'LOCK': cmd_prefix = 'l'

            if arduino and cmd_prefix:
                try:
                    command = f"{cmd_prefix}{locker_id}\n"
                    arduino.write(command.encode('utf-8'))
                    print(f"📤 Action: {action} -> Sent: '{command.strip()}'")
                except Exception as e:
                    print(f"❌ Serial Write Error: {e}")

if db:
    print("🎧 Listening for Firebase updates...")
    try:
        db.collection('lockers').on_snapshot(on_locker_snapshot)
        db.collection('settings').document('general').on_snapshot(on_settings_snapshot)
        # ❌ REMOVED the transaction snapshot listener entirely so Firebase doesn't trigger duplicate SMS
    except Exception as e:
        print(f"Listener Error: {e}")


def consume_local_actions():
    if not arduino or not arduino.is_open:
        return

    if not os.path.exists(LOCKER_ACTIONS_FILE):
        return

    try:
        with open(LOCKER_ACTIONS_FILE, 'r') as f:
            commands = json.load(f)
    except Exception:
        return

    if not isinstance(commands, list) or len(commands) == 0:
        return

    remaining = []
    for cmd in commands:
        locker_id = str(cmd.get('lockerId', ''))
        action = str(cmd.get('action', '')).upper()
        
        # 🚀 NEW: Parses LED actions locally
        prefix = None
        if action == 'UNLOCK': prefix = 'u'
        elif action == 'LOCK': prefix = 'l'
        elif action == 'LED_RED': prefix = 'r'
        elif action == 'LED_GREEN': prefix = 'g'
        elif action == 'LED_YELLOW': prefix = 'y'

        if prefix and locker_id in ['1', '2', '3']:
            try:
                arduino.write(f"{prefix}{locker_id}\n".encode('utf-8'))
                print(f"📤 Local Action: {action} -> Locker {locker_id}")
            except Exception as e:
                print(f"❌ Local command failed: {e}")
                remaining.append(cmd)
        else:
            remaining.append(cmd)

    try:
        with open(LOCKER_ACTIONS_FILE, 'w') as f:
            json.dump(remaining, f)
    except Exception:
        pass


# 🚀 NEW: SMS Consumer Function
def consume_local_sms():
    if not gsm or not gsm.is_open:
        return

    if not os.path.exists(SMS_QUEUE_FILE):
        return

    try:
        with open(SMS_QUEUE_FILE, 'r') as f:
            sms_list = json.load(f)
    except Exception:
        return

    if not isinstance(sms_list, list) or len(sms_list) == 0:
        return

    remaining = []
    for sms in sms_list:
        phone = sms.get('phone')
        msg = sms.get('message')

        if phone and msg:
            log_gsm(f"📲 Sending Local SMS to {phone}")
            try:
                gsm.write(b'AT+CMGF=1\r\n')
                time.sleep(0.5)
                gsm.write(f'AT+CMGS="{phone}"\r\n'.encode())
                time.sleep(0.5)
                gsm.write(msg.encode())
                gsm.write(bytes([26])) 
                time.sleep(3)
                print(f"✅ SMS successfully sent to {phone}")
            except Exception as e:
                print(f"❌ SMS failed to send: {e}")
                remaining.append(sms) 
        else:
            pass

    try:
        with open(SMS_QUEUE_FILE, 'w') as f:
            json.dump(remaining, f)
    except Exception:
        pass


# --- MAIN LOOP ---
print("🚀 Hybrid Bridge Running...")
last_file_update = 0
last_heartbeat = time.time()
last_reconnect_attempt = 0

while True:
    arduino, last_reconnect_attempt = reconnect_arduino_if_needed(arduino, last_reconnect_attempt)
    
    consume_local_actions() # Hardware commands
    consume_local_sms()     # 🚀 NEW: Check SMS Queue

    if arduino and arduino.in_waiting:
        try:
            line = arduino.readline().decode('utf-8', errors='ignore').strip()
            
            if line.startswith("DATA"):
                last_heartbeat = time.time()
                
                # --- FILE UPDATE FOR UI ---
                if time.time() - last_file_update > UPDATE_INTERVAL:
                    state = { "raw_data": line, "timestamp": time.time() }
                    temp_file = STATE_FILE + ".tmp"
                    with open(temp_file, "w") as f:
                        json.dump(state, f)
                    os.replace(temp_file, STATE_FILE)
                    last_file_update = time.time()

                # --- PARSE LOCKER STATUS ---
                parts = line.split('|')
                for part in parts:
                    if part.startswith('L') and ':' in part:
                        try:
                            l_data = part.split(':')
                            l_id = l_data[0].replace('L', '') 
                            door_status = l_data[2]      
                            conn_flag = l_data[3].strip() if len(l_data) > 3 else None
                            
                            is_hw_connected = (conn_flag == "1") if conn_flag is not None else True
                            
                            if local_connection_states.get(l_id) != is_hw_connected:
                                conn_display = conn_flag if conn_flag is not None else "(missing)"
                                print(f"🔌 Locker {l_id} Status Change: Received Flag='{conn_display}' -> Connected={is_hw_connected}")
                                local_connection_states[l_id] = is_hw_connected
                                
                                if db:
                                    db.collection('lockers').document(l_id).update({
                                        'isConnected': is_hw_connected,
                                        'doorStatus': door_status if is_hw_connected else "OFFLINE"
                                    })

                            if is_hw_connected:
                                if local_door_states.get(l_id) != door_status:
                                    local_door_states[l_id] = door_status
                                    if db:
                                        print(f"🔄 Locker {l_id} Door -> {door_status}")
                                        db.collection('lockers').document(l_id).update({
                                            'doorStatus': door_status 
                                        })

                        except Exception as e:
                            pass 

            elif line.startswith("COIN_ADDED:"):
                try:
                    amount = int(line.split(":")[1])
                    print(f"💰 COIN INSERTED: {amount}")
                except ValueError:
                    pass

        except Exception as e:
            print(f"Serial Read Error: {e}")
            try:
                if arduino and arduino.is_open:
                    arduino.close()
            except Exception:
                pass

    # WATCHDOG
    if time.time() - last_heartbeat > 5.0:
        if local_connection_states["1"] != False: 
            print("⚠️ LOST CONNECTION TO MAIN CONTROLLER")
            for l_id in ["1", "2", "3"]:
                local_connection_states[l_id] = False
                local_door_states[l_id] = "OFFLINE"
                if db:
                    db.collection('lockers').document(l_id).update({'doorStatus': 'OFFLINE', 'isConnected': False})
        last_heartbeat = time.time() - 4.0 

    time.sleep(0.01)