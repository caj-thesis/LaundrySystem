# --- IMPORTS ---
import datetime
import json
import os
import sqlite3
import sys
import time

import serial
import serial.tools.list_ports

# FORCE FLUSHING OF LOGS
sys.stdout.reconfigure(line_buffering=True)

# --- CONFIGURATION ---
BAUD_RATE = 115200
LOG_FILE = "gsm_logs.log"
STATE_FILE = "sys_state.json"
LOCKER_ACTIONS_FILE = "locker_actions.json"
DB_FILE = "laundry.db"
UPDATE_INTERVAL = 0.2
RECONNECT_INTERVAL = 3.0
DATABASE_POLL_INTERVAL = 1.0

# --- LED COLOR DEFINITIONS ---
LED_OFF = 0
LED_RED = 1
LED_GREEN = 2
LED_BLUE = 3
LED_YELLOW = 4

# --- GLOBAL STATE ---
SHOP_NAME = "CAJ LAUNDRY LOCKER CO."
last_database_poll = 0.0
database_ready_logged = False

# --- LOGGING ---
def log_gsm(message):
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[GSM] {timestamp} {message}")
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(f"[{timestamp}] {message}\n")
    except Exception:
        pass


def get_db_connection():
    if not os.path.exists(DB_FILE):
        return None

    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    return connection


def valid_phone_number(value):
    return isinstance(value, str) and len(value) == 11 and value.startswith("09") and value.isdigit()


# --- DYNAMIC PORT DISCOVERY ---
def find_ports():
    print("[HW] Scanning serial ports...")
    ports = serial.tools.list_ports.comports()
    found_arduino = None
    found_gsm = None

    for port in ports:
        if "ttyAMA" in port.device:
            continue

        print(f"[HW] Testing {port.device}...")
        try:
            with serial.Serial(port.device, BAUD_RATE, timeout=1.5) as serial_handle:
                time.sleep(2)
                serial_handle.write(b"AT\r\n")
                time.sleep(0.5)
                response = serial_handle.read_all().decode("utf-8", errors="ignore")

                if "OK" in response:
                    print(f"[HW] GSM module detected on {port.device}")
                    found_gsm = port.device
                    continue

                start_time = time.time()
                while time.time() - start_time < 3.0:
                    line = serial_handle.readline().decode("utf-8", errors="ignore").strip()
                    if line.startswith("DATA"):
                        print(f"[HW] Arduino detected on {port.device}")
                        found_arduino = port.device
                        break
        except Exception as error:
            print(f"[HW] Could not read {port.device}: {error}")

    return found_arduino, found_gsm


def connect_hardware():
    print("[HW] Connecting to hardware...")
    arduino_path, gsm_path = find_ports()

    arduino_handle = None
    if arduino_path:
        try:
            print(f"[HW] Opening Arduino on {arduino_path}")
            arduino_handle = serial.Serial(arduino_path, BAUD_RATE, timeout=1)
            time.sleep(2)
            print("[HW] Arduino connected")
        except Exception as error:
            print(f"[HW] Arduino connection failed: {error}")
    else:
        print("[HW] Arduino not detected during scan")

    gsm_handle = None
    if gsm_path:
        try:
            print(f"[HW] Opening GSM on {gsm_path}")
            gsm_handle = serial.Serial(gsm_path, BAUD_RATE, timeout=1)
            gsm_handle.write(b"AT\r\n")
            time.sleep(0.5)
            print("[HW] GSM connected")
        except Exception as error:
            print(f"[HW] GSM connection failed: {error}")
    else:
        print("[HW] GSM module not detected during scan")

    return arduino_handle, gsm_handle


def reconnect_arduino_if_needed(current_arduino, last_attempt_ts):
    if current_arduino and current_arduino.is_open:
        return current_arduino, last_attempt_ts

    now = time.time()
    if now - last_attempt_ts < RECONNECT_INTERVAL:
        return current_arduino, last_attempt_ts

    print("[HW] Attempting Arduino reconnection...")
    new_arduino, _ = connect_hardware()
    if new_arduino and new_arduino.is_open:
        print("[HW] Arduino reconnected")
        return new_arduino, now

    return current_arduino, now


arduino, gsm = connect_hardware()

# --- STATE TRACKING ---
local_door_states = {"1": None, "2": None, "3": None}
local_connection_states = {"1": None, "2": None, "3": None}
last_led_states = {"1": None, "2": None, "3": None}


# --- LED CONTROL FUNCTIONS ---
def send_led_command(locker_id, color_code):
    action_char = None
    if color_code == LED_RED:
        action_char = "r"
    elif color_code == LED_GREEN:
        action_char = "g"
    elif color_code == LED_YELLOW:
        action_char = "y"
    elif color_code == LED_BLUE:
        action_char = "r"

    if arduino and arduino.is_open and action_char:
        try:
            command = f"{action_char}{locker_id}\n"
            arduino.write(command.encode("utf-8"))
        except Exception as error:
            print(f"[HW] LED write error: {error}")


def set_led_state(locker_id, color_code):
    if last_led_states.get(locker_id) == color_code:
        return

    last_led_states[locker_id] = color_code
    send_led_command(locker_id, color_code)


def process_locker_led(locker_id, locker_status, laundry_status):
    is_connected = local_connection_states.get(locker_id)
    if is_connected is False:
        set_led_state(locker_id, LED_RED)
        return

    if locker_status == "available":
        set_led_state(locker_id, LED_GREEN)
        return

    if str(laundry_status or "").strip().lower() == "done":
        set_led_state(locker_id, LED_YELLOW)
        return

    set_led_state(locker_id, LED_RED)


def send_sms(phone_number, message):
    if not gsm or not gsm.is_open:
        return False

    try:
        gsm.write(b"AT+CMGF=1\r\n")
        time.sleep(0.5)
        gsm.write(f'AT+CMGS="{phone_number}"\r\n'.encode("utf-8"))
        time.sleep(0.5)
        gsm.write(message.encode("utf-8"))
        gsm.write(bytes([26]))
        time.sleep(3)
        return True
    except Exception as error:
        log_gsm(f"SMS error for {phone_number}: {error}")
        return False


def process_database_state():
    global SHOP_NAME
    global last_database_poll
    global database_ready_logged

    now = time.time()
    if now - last_database_poll < DATABASE_POLL_INTERVAL:
        return

    last_database_poll = now
    connection = get_db_connection()
    if connection is None:
        if database_ready_logged:
            print("[DB] SQLite database unavailable")
            database_ready_logged = False
        return

    if not database_ready_logged:
        print("[DB] SQLite polling active")
        database_ready_logged = True

    try:
        settings_row = connection.execute(
            "SELECT laundryShopName FROM settings WHERE id = 1"
        ).fetchone()
        if settings_row and settings_row["laundryShopName"]:
            SHOP_NAME = str(settings_row["laundryShopName"]).upper()

        pending_transactions = connection.execute(
            """
            SELECT transactionId, lockerId, phoneNumber, pin, price, weight, laundryStatus,
                   triggerReminder, reminderSent, reminderSentAt, codeSmsSent, doneSmsSent
            FROM transactions
            WHERE status = 'Pending'
            ORDER BY updatedAt ASC
            """
        ).fetchall()

        locker_rows = connection.execute(
            """
            SELECT id, status, currentTransactionId
            FROM lockers
            ORDER BY id ASC
            """
        ).fetchall()

        transaction_by_id = {row["transactionId"]: row for row in pending_transactions}
        timestamp = datetime.datetime.now().strftime("%m/%d/%Y %H:%M")
        db_now = datetime.datetime.now().isoformat()

        for tx in pending_transactions:
            transaction_id = tx["transactionId"]
            phone = tx["phoneNumber"]
            laundry_status = str(tx["laundryStatus"] or "").strip().lower()
            trigger_reminder = bool(tx["triggerReminder"])
            reminder_sent = bool(tx["reminderSent"])
            code_sms_sent = bool(tx["codeSmsSent"])
            done_sms_sent = bool(tx["doneSmsSent"])

            if not valid_phone_number(phone):
                if trigger_reminder:
                    connection.execute(
                        """
                        UPDATE transactions
                        SET triggerReminder = 0, updatedAt = ?
                        WHERE transactionId = ?
                        """,
                        (db_now, transaction_id),
                    )
                    connection.commit()
                continue

            message = None
            updates = None

            if trigger_reminder:
                message = (
                    f"{SHOP_NAME}\n"
                    f"OVERDUE REMINDER: Your laundry is ready for pickup.\n"
                    f"Ref: {transaction_id}\n"
                    f"Please claim it as soon as possible."
                )
                updates = (
                    """
                    UPDATE transactions
                    SET triggerReminder = 0,
                        reminderSent = 1,
                        reminderSentAt = COALESCE(reminderSentAt, ?),
                        updatedAt = ?
                    WHERE transactionId = ?
                    """,
                    (db_now, db_now, transaction_id),
                )
            elif laundry_status in ["dropped", "pending"] and not code_sms_sent:
                message = (
                    f"{SHOP_NAME}\n"
                    f"Date: {timestamp}\n"
                    f"Trans #: {transaction_id}\n"
                    f"Service: DROPOFF\n"
                    f"Weight: {float(tx['weight'] or 0):.2f} kg\n"
                    f"Price: PHP {float(tx['price'] or 0):.2f}\n"
                    f"----------------\n"
                    f"PIN: {tx['pin']}\n"
                    f"Keep this PIN safe!"
                )
                updates = (
                    """
                    UPDATE transactions
                    SET codeSmsSent = 1, updatedAt = ?
                    WHERE transactionId = ?
                    """,
                    (db_now, transaction_id),
                )
            elif laundry_status == "done" and not done_sms_sent and not reminder_sent:
                message = (
                    f"{SHOP_NAME}\n"
                    f"Date: {timestamp}\n"
                    f"Trans #: {transaction_id}\n"
                    f"Service: READY FOR PICKUP\n"
                    f"----------------\n"
                    f"Status: WASHING COMPLETE\n"
                    f"Please proceed to payment."
                )
                updates = (
                    """
                    UPDATE transactions
                    SET doneSmsSent = 1, updatedAt = ?
                    WHERE transactionId = ?
                    """,
                    (db_now, transaction_id),
                )

            if message:
                log_gsm(f"Sending SMS to {phone} for {transaction_id}")
                if send_sms(phone, message):
                    connection.execute(updates[0], updates[1])
                    connection.commit()

        for locker in locker_rows:
            locker_id = str(locker["id"])
            current_transaction_id = locker["currentTransactionId"]
            transaction = transaction_by_id.get(current_transaction_id) if current_transaction_id else None
            laundry_status = transaction["laundryStatus"] if transaction else None
            process_locker_led(locker_id, locker["status"], laundry_status)

    except Exception as error:
        print(f"[DB] Polling error: {error}")
    finally:
        connection.close()


def consume_local_actions():
    if not arduino or not arduino.is_open:
        return

    if not os.path.exists(LOCKER_ACTIONS_FILE):
        return

    try:
        with open(LOCKER_ACTIONS_FILE, "r", encoding="utf-8") as handle:
            commands = json.load(handle)
    except Exception:
        return

    if not isinstance(commands, list) or len(commands) == 0:
        return

    remaining = []
    for command in commands:
        locker_id = str(command.get("lockerId", ""))
        action = str(command.get("action", "")).upper()
        prefix = "u" if action == "UNLOCK" else "l" if action == "LOCK" else None

        if prefix and locker_id in ["1", "2", "3"]:
            try:
                arduino.write(f"{prefix}{locker_id}\n".encode("utf-8"))
                print(f"[HW] Local action {action} -> locker {locker_id}")
            except Exception as error:
                print(f"[HW] Local command failed: {error}")
                remaining.append(command)
        else:
            remaining.append(command)

    try:
        with open(LOCKER_ACTIONS_FILE, "w", encoding="utf-8") as handle:
            json.dump(remaining, handle)
    except Exception:
        pass


print("[BRIDGE] Local hardware bridge running with SQLite polling")
last_file_update = 0
last_heartbeat = time.time()
last_reconnect_attempt = 0

while True:
    arduino, last_reconnect_attempt = reconnect_arduino_if_needed(arduino, last_reconnect_attempt)
    consume_local_actions()
    process_database_state()

    if arduino and arduino.in_waiting:
        try:
            line = arduino.readline().decode("utf-8", errors="ignore").strip()

            if line.startswith("DATA"):
                last_heartbeat = time.time()

                if time.time() - last_file_update > UPDATE_INTERVAL:
                    state = {"raw_data": line, "timestamp": time.time()}
                    temp_file = STATE_FILE + ".tmp"
                    with open(temp_file, "w", encoding="utf-8") as handle:
                        json.dump(state, handle)
                    os.replace(temp_file, STATE_FILE)
                    last_file_update = time.time()

                parts = line.split("|")
                for part in parts:
                    if part.startswith("L") and ":" in part:
                        try:
                            locker_data = part.split(":")
                            locker_id = locker_data[0].replace("L", "")
                            door_status = locker_data[2]
                            conn_flag = locker_data[3].strip() if len(locker_data) > 3 else None
                            is_hw_connected = (conn_flag == "1") if conn_flag is not None else True

                            if local_connection_states.get(locker_id) != is_hw_connected:
                                local_connection_states[locker_id] = is_hw_connected
                                print(
                                    f"[HW] Locker {locker_id} connection -> {is_hw_connected}"
                                )

                            if local_door_states.get(locker_id) != door_status:
                                local_door_states[locker_id] = door_status
                                print(f"[HW] Locker {locker_id} door -> {door_status}")
                        except Exception:
                            pass

            elif line.startswith("COIN_ADDED:"):
                try:
                    amount = int(line.split(":")[1])
                    print(f"[HW] Coin inserted: {amount}")
                except ValueError:
                    pass

        except Exception as error:
            print(f"[HW] Serial read error: {error}")
            try:
                if arduino and arduino.is_open:
                    arduino.close()
            except Exception:
                pass

    if time.time() - last_heartbeat > 5.0:
        if local_connection_states["1"] is not False:
            print("[HW] Lost connection to main controller")
            for locker_id in ["1", "2", "3"]:
                local_connection_states[locker_id] = False
                local_door_states[locker_id] = "OFFLINE"
        last_heartbeat = time.time() - 4.0

    time.sleep(0.01)
