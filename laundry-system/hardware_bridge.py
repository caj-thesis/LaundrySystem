# --- IMPORTS ---
import datetime
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

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
BACKEND_SMS_ENDPOINT = os.environ.get(
    "BACKEND_SMS_ENDPOINT", "http://127.0.0.1:3000/api/bridge/sms-confirmed"
)
DEFAULT_SHOP_NAME_PLACEHOLDER = "Laundry Management System"
UPDATE_INTERVAL = 0.2
RECONNECT_INTERVAL = 3.0
DATABASE_POLL_INTERVAL = 1.0
CONTROLLER_SCAN_TIMEOUT = 20.0
# SIM900A sends can legitimately take longer than 35s when registration/prompt/final
# confirmation responses are slow, so keep the bridge from timing out too early.
ARDUINO_SMS_TIMEOUT = 70.0
SMS_RETRY_INTERVAL = 5.0
CONTROLLER_OPEN_SETTLE = 0.5
CONTROLLER_IDLE_TIMEOUT = 5.0
CONTROLLER_BUSY_TIMEOUT = 80.0
BACKEND_SYNC_RETRY_INTERVAL = 3.0

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
last_file_update = 0.0
last_heartbeat = time.time()
last_controller_activity = time.time()
last_known_credit = 0.0
local_door_states = {"1": None, "2": None, "3": None}
local_connection_states = {"1": None, "2": None, "3": None}
last_led_states = {"1": None, "2": None, "3": None}
locker_action_states = {"1": "lock", "2": "lock", "3": "lock"}
pending_sms_jobs = {}
active_sms_job = None
confirmed_sms_jobs = set()
pending_backend_sms_updates = {}


def build_offline_raw_data():
    return (
        "DATA|"
        "L1:0.0:OFFLINE:0|"
        "L2:0.0:OFFLINE:0|"
        "L3:0.0:OFFLINE:0|"
        f"CREDIT:{last_known_credit:.1f}"
    )


latest_raw_data = build_offline_raw_data()


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


def write_state_file(force=False):
    global last_file_update

    now = time.time()
    if not force and now - last_file_update <= UPDATE_INTERVAL:
        return

    state = {
        "raw_data": latest_raw_data,
        "timestamp": now,
        "locker_actions": locker_action_states,
    }
    temp_file = STATE_FILE + ".tmp"

    try:
        with open(temp_file, "w", encoding="utf-8") as handle:
            json.dump(state, handle)
        os.replace(temp_file, STATE_FILE)
        last_file_update = now
    except Exception as error:
        print(f"[STATE] Failed to write state file: {error}")


def read_json_file(file_path, fallback, error_prefix="[LOCAL] Failed to read"):
    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            raw = handle.read().strip()
    except FileNotFoundError:
        return fallback
    except Exception as error:
        print(f"{error_prefix} {os.path.basename(file_path)}: {error}")
        return fallback

    if not raw:
        return fallback

    try:
        return json.loads(raw)
    except Exception as error:
        print(f"{error_prefix} {os.path.basename(file_path)}: {error}")
        return fallback


def write_json_file_atomic(file_path, data, error_prefix="[LOCAL] Failed to write"):
    temp_file = f"{file_path}.{os.getpid()}.tmp"

    try:
        with open(temp_file, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        os.replace(temp_file, file_path)
        return True
    except Exception as error:
        print(f"{error_prefix} {os.path.basename(file_path)}: {error}")
        try:
            if os.path.exists(temp_file):
                os.remove(temp_file)
        except Exception:
            pass
        return False


def claim_local_action_queue():
    processing_file = f"{LOCKER_ACTIONS_FILE}.{os.getpid()}.processing"

    try:
        os.replace(LOCKER_ACTIONS_FILE, processing_file)
    except FileNotFoundError:
        return []
    except Exception as error:
        print(f"[LOCAL] Failed to claim {os.path.basename(LOCKER_ACTIONS_FILE)}: {error}")
        return []

    commands = read_json_file(processing_file, [])

    try:
        os.remove(processing_file)
    except FileNotFoundError:
        pass
    except Exception as error:
        print(f"[LOCAL] Failed to clean {os.path.basename(processing_file)}: {error}")

    return commands if isinstance(commands, list) else []


def requeue_local_actions(commands):
    if not commands:
        return

    existing_queue = read_json_file(LOCKER_ACTIONS_FILE, [])
    queue = existing_queue if isinstance(existing_queue, list) else []
    queue.extend(commands)
    write_json_file_atomic(LOCKER_ACTIONS_FILE, queue)


def write_arduino_command(command_text, error_prefix="[HW] Command write error"):
    if not arduino or not arduino.is_open:
        return False

    try:
        arduino.write(f"{command_text}\n".encode("utf-8"))
        return True
    except Exception as error:
        print(f"{error_prefix}: {error}")
        return False


def record_locker_action(locker_id, action):
    if locker_id not in locker_action_states:
        return

    previous = locker_action_states.get(locker_id)
    locker_action_states[locker_id] = action

    if previous != action:
        print(f"[HW] Locker {locker_id} action -> {action.upper()}")

    write_state_file(force=True)


def upsert_sms_job(kind, transaction_id, phone_number, message):
    job_key = f"{kind}:{transaction_id}"
    if job_key in confirmed_sms_jobs:
        return

    existing = pending_sms_jobs.get(job_key)

    if existing:
        existing["phone_number"] = phone_number
        existing["message"] = message
        return

    pending_sms_jobs[job_key] = {
        "key": job_key,
        "kind": kind,
        "transaction_id": transaction_id,
        "phone_number": phone_number,
        "message": message,
        "created_at": time.time(),
        "last_attempt_at": 0.0,
        "started_at": None,
        "attempts": 0,
    }


def post_backend_sms_update(job):
    payload = json.dumps(
        {
            "transactionId": job["transaction_id"],
            "kind": job["kind"],
            "phoneNumber": job["phone_number"],
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        BACKEND_SMS_ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=3) as response:
        return 200 <= response.status < 300


def queue_backend_sms_update(job):
    pending_backend_sms_updates[job["key"]] = {
        "job": {
            "key": job["key"],
            "kind": job["kind"],
            "transaction_id": job["transaction_id"],
            "phone_number": job["phone_number"],
        },
        "last_attempt_at": 0.0,
    }


def format_sms_debug_message(message):
    normalized = str(message or "").replace("\r\n", "\n").replace("\r", "\n")
    return normalized.replace("\\", "\\\\").replace("\n", "\\n")


def persist_sms_confirmation(job):
    now = datetime.datetime.now().isoformat()
    connection = get_db_connection()

    if connection is None:
        log_gsm(
            f"Local DB unavailable while persisting SMS confirmation for {job['transaction_id']}"
        )
        return False

    try:
        if job["kind"] == "reminder":
            connection.execute(
                """
                UPDATE transactions
                SET triggerReminder = 0,
                    reminderSent = 1,
                    reminderSentAt = COALESCE(reminderSentAt, ?),
                    updatedAt = ?
                WHERE transactionId = ?
                """,
                (now, now, job["transaction_id"]),
            )
        elif job["kind"] == "code":
            connection.execute(
                """
                UPDATE transactions
                SET codeSmsSent = 1,
                    updatedAt = ?
                WHERE transactionId = ?
                """,
                (now, job["transaction_id"]),
            )
        elif job["kind"] == "done":
            connection.execute(
                """
                UPDATE transactions
                SET doneSmsSent = 1,
                    updatedAt = ?
                WHERE transactionId = ?
                """,
                (now, job["transaction_id"]),
            )
        else:
            log_gsm(
                f"Skipping local DB SMS confirmation for unsupported kind {job['kind']}"
            )
            return False

        connection.commit()
        return True
    except Exception as error:
        log_gsm(
            f"Failed to persist SMS confirmation for {job['transaction_id']}: {error}"
        )
        return False
    finally:
        connection.close()


def prune_stale_pending_sms_jobs(valid_job_keys):
    active_key = active_sms_job["key"] if active_sms_job is not None else None

    for job_key in list(pending_sms_jobs.keys()):
        if job_key == active_key:
            continue

        if job_key not in valid_job_keys:
            pending_sms_jobs.pop(job_key, None)


def process_backend_sms_update_queue():
    now = time.time()

    for job_key, state in list(pending_backend_sms_updates.items()):
        if now - state["last_attempt_at"] < BACKEND_SYNC_RETRY_INTERVAL:
            continue

        state["last_attempt_at"] = now

        try:
            if post_backend_sms_update(state["job"]):
                pending_backend_sms_updates.pop(job_key, None)
        except urllib.error.URLError as error:
            log_gsm(
                f"Backend SMS sync retry pending for {state['job']['transaction_id']}: {error}"
            )
        except Exception as error:
            log_gsm(
                f"Unexpected backend SMS sync error for {state['job']['transaction_id']}: {error}"
            )


def confirm_sms_job(job):
    if job is None:
        return

    persist_sms_confirmation(job)
    confirmed_sms_jobs.add(job["key"])
    pending_sms_jobs.pop(job["key"], None)

    log_gsm(
        f"SMS confirmed by controller for {job['phone_number']} ({job['transaction_id']}, {job['kind']})"
    )
    queue_backend_sms_update(job)
    process_backend_sms_update_queue()


def finish_active_sms_job(success, reason=""):
    global active_sms_job

    if active_sms_job is None:
        return

    job = active_sms_job
    job["started_at"] = None
    active_sms_job = None

    if success:
        confirm_sms_job(job)
        return

    job["last_attempt_at"] = time.time()
    if reason:
        log_gsm(
            f"SMS attempt failed for {job['phone_number']} ({job['transaction_id']}, {job['kind']}): {reason}"
        )


def find_sms_job_for_confirmation(phone_number):
    if active_sms_job and active_sms_job["phone_number"] == phone_number:
        return active_sms_job

    matching_jobs = [
        job
        for job in pending_sms_jobs.values()
        if job is not active_sms_job and job["phone_number"] == phone_number
    ]

    if not matching_jobs:
        return None

    matching_jobs.sort(
        key=lambda job: (job["last_attempt_at"], job["created_at"]),
        reverse=True,
    )
    return matching_jobs[0]


def process_sms_queue():
    global active_sms_job

    if active_sms_job is not None:
        started_at = active_sms_job.get("started_at")
        if started_at and time.time() - started_at > ARDUINO_SMS_TIMEOUT:
            finish_active_sms_job(False, "controller confirmation timed out")
        return

    if not arduino or not arduino.is_open:
        return

    now = time.time()
    queued_jobs = sorted(
        pending_sms_jobs.values(), key=lambda job: (job["last_attempt_at"], job["created_at"])
    )

    for job in queued_jobs:
        if now - job["last_attempt_at"] < SMS_RETRY_INTERVAL:
            continue

        encoded_message = encode_sms_message(job["message"])
        debug_message = format_sms_debug_message(job["message"])
        command = f"sms|{job['phone_number']}|{encoded_message}"

        log_gsm(
            f"SMS debug -> tx={job['transaction_id']} kind={job['kind']} "
            f"raw_len={len(str(job['message'] or ''))} encoded_len={len(encoded_message)} "
            f"body={debug_message}"
        )

        if not write_arduino_command(command, "[GSM] SMS command write error"):
            job["last_attempt_at"] = now
            return

        job["attempts"] += 1
        job["last_attempt_at"] = now
        job["started_at"] = now
        active_sms_job = job
        log_gsm(
            f"Sending SMS to {job['phone_number']} for {job['transaction_id']} ({job['kind']}) via controller"
        )
        return


# --- DYNAMIC PORT DISCOVERY ---
def is_controller_line(line):
    return (
        line.startswith("DATA")
        or line.startswith("ACTION:")
        or line.startswith("COIN_ADDED:")
        or line.startswith("SMS_SENT:")
        or line.startswith("SMS_ERROR:")
    )


def get_candidate_ports():
    ports = list(serial.tools.list_ports.comports())

    def port_priority(port_info):
        device = str(port_info.device)
        if "ttyUSB" in device:
            return (0, device)
        if "ttyACM" in device:
            return (1, device)
        if "COM" in device.upper():
            return (2, device)
        if "ttyAMA" in device:
            return (99, device)
        if "ttyS" in device:
            return (50, device)
        return (10, device)

    return sorted(ports, key=port_priority)


def wait_for_controller_ready(serial_handle, timeout_seconds):
    deadline = time.time() + timeout_seconds

    while time.time() < deadline:
        try:
            raw_line = serial_handle.readline()
        except Exception as error:
            print(f"[HW] Serial read failed while probing {serial_handle.port}: {error}")
            return False

        if not raw_line:
            continue

        line = raw_line.decode("utf-8", errors="ignore").strip()
        if not line:
            continue

        if is_controller_line(line):
            return True

    return False


def find_controller_port():
    print("[HW] Scanning serial ports for controller...")
    ports = get_candidate_ports()

    for port in ports:
        if "ttyAMA" in port.device:
            continue

        if "ttyS" in port.device and any(
            ("ttyUSB" in candidate.device or "ttyACM" in candidate.device)
            for candidate in ports
        ):
            continue

        print(f"[HW] Testing {port.device}...")
        try:
            with serial.Serial(port.device, BAUD_RATE, timeout=1.0, write_timeout=1.0) as serial_handle:
                time.sleep(CONTROLLER_OPEN_SETTLE)
                serial_handle.reset_input_buffer()

                if wait_for_controller_ready(serial_handle, CONTROLLER_SCAN_TIMEOUT):
                    print(f"[HW] Controller detected on {port.device}")
                    return port.device

                print(
                    f"[HW] No valid controller data received from {port.device} within "
                    f"{CONTROLLER_SCAN_TIMEOUT:.0f}s"
                )
        except Exception as error:
            print(f"[HW] Could not read {port.device}: {error}")

    return None


def connect_hardware():
    print("[HW] Connecting to controller...")
    controller_path = find_controller_port()

    if not controller_path:
        print("[HW] Controller not detected during scan")
        return None

    try:
        print(f"[HW] Opening controller on {controller_path}")
        controller_handle = serial.Serial(
            controller_path,
            BAUD_RATE,
            timeout=1,
            write_timeout=1.0,
        )
        time.sleep(CONTROLLER_OPEN_SETTLE)
        controller_handle.reset_input_buffer()

        if not wait_for_controller_ready(controller_handle, CONTROLLER_SCAN_TIMEOUT):
            print(
                f"[HW] Controller open on {controller_path} succeeded but no valid data arrived "
                f"within {CONTROLLER_SCAN_TIMEOUT:.0f}s"
            )
            controller_handle.close()
            return None

        print("[HW] Controller connected")
        return controller_handle
    except Exception as error:
        print(f"[HW] Controller connection failed: {error}")
        return None


def reconnect_arduino_if_needed(current_arduino, last_attempt_ts):
    if current_arduino and current_arduino.is_open:
        return current_arduino, last_attempt_ts

    now = time.time()
    if now - last_attempt_ts < RECONNECT_INTERVAL:
        return current_arduino, last_attempt_ts

    print("[HW] Attempting controller reconnection...")
    new_arduino = connect_hardware()
    if new_arduino and new_arduino.is_open:
        print("[HW] Controller reconnected")
        return new_arduino, now

    return current_arduino, now


arduino = connect_hardware()


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

    if action_char and not write_arduino_command(
        f"{action_char}{locker_id}", "[HW] LED write error"
    ):
        return


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


def encode_sms_message(message):
    normalized = str(message or "").replace("\r\n", "\n").replace("\r", "\n")
    return normalized.replace("\\", "\\\\").replace("\n", "\\n")


def process_data_line(line):
    global last_heartbeat
    global last_controller_activity
    global last_known_credit
    global latest_raw_data

    now = time.time()
    last_heartbeat = now
    last_controller_activity = now

    parts = line.split("|")
    parsed_locker_state = False

    for part in parts:
        if part.startswith("L") and ":" in part:
            try:
                locker_data = part.split(":")
                if len(locker_data) < 3:
                    continue

                locker_id = locker_data[0].replace("L", "")
                door_status = locker_data[2]
                conn_flag = locker_data[3].strip() if len(locker_data) > 3 else None
                is_hw_connected = (conn_flag == "1") if conn_flag is not None else True
                parsed_locker_state = True

                if local_connection_states.get(locker_id) != is_hw_connected:
                    local_connection_states[locker_id] = is_hw_connected
                    print(f"[HW] Locker {locker_id} connection -> {is_hw_connected}")

                if local_door_states.get(locker_id) != door_status:
                    local_door_states[locker_id] = door_status
                    print(f"[HW] Locker {locker_id} door -> {door_status}")
            except Exception:
                pass
        elif part.startswith("CREDIT:"):
            try:
                last_known_credit = float(part.split(":", 1)[1])
            except ValueError:
                pass

    if parsed_locker_state:
        latest_raw_data = line

    write_state_file()


def process_action_line(line):
    action_payload = line.split(":", 1)[1].strip()

    if action_payload.startswith("LOCK_L"):
        locker_id = action_payload.replace("LOCK_L", "", 1)
        record_locker_action(locker_id, "lock")
    elif action_payload.startswith("UNLOCK_L"):
        locker_id = action_payload.replace("UNLOCK_L", "", 1)
        record_locker_action(locker_id, "unlock")


def handle_serial_line(line):
    global last_controller_activity

    if not line:
        return None, None

    last_controller_activity = time.time()

    if line.startswith("DATA"):
        process_data_line(line)
        return "data", line

    if line.startswith("COIN_ADDED:"):
        try:
            amount = int(line.split(":", 1)[1])
            print(f"[HW] Coin inserted: {amount}")
            return "coin", amount
        except ValueError:
            return "coin", None

    if line.startswith("ACTION:"):
        process_action_line(line)
        return "action", line

    if line.startswith("SMS_SENT:"):
        phone_number = line.split(":", 1)[1].strip()
        matched_job = find_sms_job_for_confirmation(phone_number)

        if matched_job is None:
            log_gsm(f"SMS confirmation arrived for unknown job: {phone_number}")
            return "sms_sent", phone_number

        if active_sms_job and matched_job is not active_sms_job:
            log_gsm(
                f"SMS confirmation matched earlier queued job for {phone_number} while active job is {active_sms_job['phone_number']}"
            )

        if matched_job is active_sms_job:
            finish_active_sms_job(True)
        else:
            confirm_sms_job(matched_job)
        return "sms_sent", phone_number

    if line.startswith("SMS_ERROR:"):
        reason = line.split(":", 1)[1].strip()
        finish_active_sms_job(False, reason)
        return "sms_error", reason

    return "other", line


def build_sms_job(tx, shop_name, timestamp):
    transaction_id = tx["transactionId"]
    laundry_status = str(tx["laundryStatus"] or "").strip().lower()
    trigger_reminder = bool(tx["triggerReminder"])
    reminder_sent = bool(tx["reminderSent"])
    code_sms_sent = bool(tx["codeSmsSent"])
    done_sms_sent = bool(tx["doneSmsSent"])

    if trigger_reminder:
        return (
            "reminder",
            (
                f"{shop_name}\n"
                f"OVERDUE REMINDER: Your laundry is ready for pickup.\n"
                f"Ref: {transaction_id}\n"
                f"Please claim it as soon as possible."
            ),
        )

    if laundry_status in ["dropped", "pending"] and not code_sms_sent:
        return (
            "code",
            (
                f"{shop_name}\n"
                f"Date: {timestamp}\n"
                f"Trans #: {transaction_id}\n"
                f"Service: DROPOFF\n"
                f"Weight: {float(tx['weight'] or 0):.2f} kg\n"
                f"Price: PHP {float(tx['price'] or 0):.2f}\n"
                f"----------------\n"
                f"PIN: {tx['pin']}\n"
                f"Keep this PIN safe!"
            ),
        )

    if laundry_status == "done" and not done_sms_sent and not reminder_sent:
        return (
            "done",
            (
                f"{shop_name}\n"
                f"Date: {timestamp}\n"
                f"Trans #: {transaction_id}\n"
                f"Service: READY FOR PICKUP\n"
                f"----------------\n"
                f"Status: WASHING COMPLETE\n"
                f"Please proceed to payment."
            ),
        )

    return None, None


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
            configured_shop_name = str(settings_row["laundryShopName"]).strip()
            if (
                configured_shop_name
                and configured_shop_name.lower() != DEFAULT_SHOP_NAME_PLACEHOLDER.lower()
            ):
                SHOP_NAME = configured_shop_name

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
        valid_job_keys = set()
        timestamp = datetime.datetime.now().strftime("%m/%d/%Y %H:%M")
        db_now = datetime.datetime.now().isoformat()

        for tx in pending_transactions:
            transaction_id = tx["transactionId"]
            phone = tx["phoneNumber"]
            trigger_reminder = bool(tx["triggerReminder"])

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

            sms_kind, message = build_sms_job(tx, SHOP_NAME, timestamp)

            if message and sms_kind:
                valid_job_keys.add(f"{sms_kind}:{transaction_id}")
                upsert_sms_job(sms_kind, transaction_id, phone, message)

        prune_stale_pending_sms_jobs(valid_job_keys)

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

    commands = claim_local_action_queue()
    if len(commands) == 0:
        return

    remaining = []
    for command in commands:
        locker_id = str(command.get("lockerId", ""))
        action = str(command.get("action", "")).upper()
        prefix = "u" if action == "UNLOCK" else "l" if action == "LOCK" else None

        if prefix and locker_id in ["1", "2", "3"]:
            if write_arduino_command(f"{prefix}{locker_id}", "[HW] Local command failed"):
                print(f"[HW] Local action {action} -> locker {locker_id}")
            else:
                remaining.append(command)
        else:
            remaining.append(command)

    requeue_local_actions(remaining)


print("[BRIDGE] Local hardware bridge running with SQLite polling and Arduino-backed SMS")
write_state_file(force=True)
last_reconnect_attempt = 0

while True:
    arduino, last_reconnect_attempt = reconnect_arduino_if_needed(arduino, last_reconnect_attempt)
    consume_local_actions()
    process_sms_queue()
    process_backend_sms_update_queue()
    process_database_state()

    if arduino and arduino.in_waiting:
        try:
            line = arduino.readline().decode("utf-8", errors="ignore").strip()
            handle_serial_line(line)
        except Exception as error:
            print(f"[HW] Serial read error: {error}")
            if active_sms_job is not None:
                finish_active_sms_job(False, f"serial read error: {error}")
            try:
                if arduino and arduino.is_open:
                    arduino.close()
            except Exception:
                pass

    offline_timeout = CONTROLLER_BUSY_TIMEOUT if active_sms_job is not None else CONTROLLER_IDLE_TIMEOUT
    if time.time() - last_controller_activity > offline_timeout:
        if local_connection_states["1"] is not False:
            print("[HW] Lost connection to main controller")
            if active_sms_job is not None and time.time() - last_heartbeat > CONTROLLER_BUSY_TIMEOUT:
                finish_active_sms_job(False, "controller heartbeat lost")
            latest_raw_data = build_offline_raw_data()
            for locker_id in ["1", "2", "3"]:
                local_connection_states[locker_id] = False
                local_door_states[locker_id] = "OFFLINE"
            write_state_file(force=True)
        last_controller_activity = time.time() - (offline_timeout - 1.0)

    time.sleep(0.01)
