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
    """
    Scans all available USB serial ports to identify which is the GSM module
    and which is the Arduino based on their responses.
    """
    print("🔎 Scanning ports for devices...")
    ports = serial.tools.list_ports.comports()
    found_arduino = None
    found_gsm = None

    for port in ports:
        # Skip internal Raspberry Pi Bluetooth/Serial ports
        if "ttyAMA" in port.device: 
            continue
        
        print(f"   👉 Testing {port.device}...")
        try:
            # Open port temporarily for testing
            with serial.Serial(port.device, BAUD_RATE, timeout=1.5) as s:
                time.sleep(2) # Wait for device reset (Arduino auto-resets on connect)
                
                # 1. TEST FOR GSM (Send AT command)
                s.write(b'AT\r\n')
                time.sleep(0.5)
                response = s.read_all().decode('utf-8', errors='ignore')
                
                if "OK" in response:
                    print(f"      📱 IDENTIFIED: GSM Module on {port.device}")
                    found_gsm = port.device
                    continue # Move to next port

                # 2. TEST FOR ARDUINO (Listen for data stream)
                # Arduino continuously sends "DATA|..."
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
    
    # 1. Find the correct ports dynamically
    ard_path, gsm_path = find_ports()
    
    # 2. Connect to Arduino
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

    # 3. Connect to GSM
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
    """
    Recover from transient serial disconnects (common when the USB device resets).
    Keeps the kiosk operational offline by restoring local DATA stream updates.
    """
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


# Initialize connections
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
    
    # If locker is disconnected, force RED LED
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

# 1. Settings Listener (Dynamic Shop Name)
def on_settings_snapshot(col_snapshot, changes, read_time):
    global SHOP_NAME
    for change in changes:
        if change.type.name in ['ADDED', 'MODIFIED']:
            data = change.document.to_dict()
            name = data.get('laundryShopName', "CAJ LAUNDRY LOCKER CO.")
            SHOP_NAME = name.upper() # Ensure it is uppercase for the receipt style
            print(f"⚙️ Shop Name Updated: {SHOP_NAME}")

# 2. Transaction Listener (SMS Logic)
def on_transaction_snapshot(col_snapshot, changes, read_time):
    for change in changes:
        if change.type.name in ['ADDED', 'MODIFIED']:
            data = change.document.to_dict()
            laundry_status = str(data.get('laundryStatus', '')).strip().lower()
            phone = data.get('phoneNumber')
            trans_id = data.get('transactionId', 'N/A')
            pin = data.get('pin', 'N/A')
            
            # 👇 ADD THIS: Get the locker ID from the transaction
            locker_id = data.get('lockerId')
            
            # Retrieve flags
            trigger_reminder = data.get('triggerReminder', False)
            reminder_sent_flag = data.get('reminderSent', False) 
            code_sms_sent = data.get('codeSmsSent', False)       
            done_sms_sent = data.get('doneSmsSent', False)       

            # Get Receipt Details
            weight = float(data.get('weight', 0))
            price = float(data.get('price', 0))
            current_time = datetime.datetime.now().strftime("%m/%d/%Y %H:%M")

            if not phone or not gsm: continue
            
            msg = ""
            updates = {} 

            is_dropoff_completed = laundry_status in ['dropped', 'pending']
            is_laundry_done = laundry_status == 'done'

            # A. Manual Reminder
            if trigger_reminder:
                msg = (
                    f"{SHOP_NAME}\n"
                    f"OVERDUE REMINDER: Your laundry is ready for pickup.\n"
                    f"Ref: {trans_id}\n"
                    f"Please claim it as soon as possible."
                )
                log_gsm(f"Triggering overdue reminder for {phone}")
                updates['triggerReminder'] = False
                updates['reminderSent'] = True

            # B. Dropoff Receipt (Standard)
            elif is_dropoff_completed:
                if not code_sms_sent:
                    msg = (
                        f"{SHOP_NAME}\n"
                        f"Date: {current_time}\n"
                        f"Trans #: {trans_id}\n"
                        f"Service: DROPOFF\n"
                        f"Weight: {weight:.2f} kg\n"
                        f"Price: PHP {price:.2f}\n"
                        f"----------------\n"
                        f"PIN: {pin}\n"
                        f"Keep this PIN safe!"
                    )
                    updates['codeSmsSent'] = True

            # C. Pickup/Ready Notification
            elif is_laundry_done:
                
                # 👇 ADD THIS: Force the LED to turn yellow immediately
                if locker_id:
                    send_led_command(str(locker_id), LED_YELLOW)

                if not done_sms_sent and not reminder_sent_flag:
                    msg = (
                        f"{SHOP_NAME}\n"
                        f"Date: {current_time}\n"
                        f"Trans #: {trans_id}\n"
                        f"Service: READY FOR PICKUP\n"
                        f"----------------\n"
                        f"Status: WASHING COMPLETE\n"
                        f"Please proceed to payment."
                    )
                    updates['doneSmsSent'] = True

            # D. Send SMS & Update DB
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
                    
                    if updates:
                        try:
                            change.document.reference.update(updates)
                            print(f"📝 Updated flags: {list(updates.keys())}")
                        except Exception as e:
                            log_gsm(f"Error updating DB flags: {e}")

                except Exception as e:
                    log_gsm(f"SMS Error: {e}")

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
        # Start Listeners
        db.collection('transactions').where('laundryStatus', 'in', ['Dropped', 'Pending', 'Done']).on_snapshot(on_transaction_snapshot)
        db.collection('lockers').on_snapshot(on_locker_snapshot)
        
        # New Settings Listener
        db.collection('settings').document('general').on_snapshot(on_settings_snapshot)
        
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
        prefix = 'u' if action == 'UNLOCK' else 'l' if action == 'LOCK' else None

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

# --- MAIN LOOP ---
print("🚀 Hybrid Bridge Running...")
last_file_update = 0
last_heartbeat = time.time()
last_reconnect_attempt = 0

while True:
    arduino, last_reconnect_attempt = reconnect_arduino_if_needed(arduino, last_reconnect_attempt)
    consume_local_actions()

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
                            
                            # Support both payload formats:
                            # 1) DATA|L1:1.2:OPEN:1 (with connectivity flag)
                            # 2) DATA|L1:1.2:OPEN   (legacy/no flag -> assume connected)
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