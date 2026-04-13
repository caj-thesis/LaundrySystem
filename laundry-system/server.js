import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const DB_FILE = path.join(__dirname, 'laundry.db');
const STATE_FILE = path.join(__dirname, 'sys_state.json');
const LOCAL_TRANSACTIONS_FILE = path.join(__dirname, 'local_transactions.json');
const LOCAL_SETTINGS_FILE = path.join(__dirname, 'local_settings.json');
const LOCKER_ACTIONS_FILE = path.join(__dirname, 'locker_actions.json');
const DIST_DIR = path.join(__dirname, 'dist');
const DIST_INDEX_FILE = path.join(DIST_DIR, 'index.html');

const TRANSACTION_STATUS = {
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

const DEFAULT_SETTINGS = {
  laundryShopName: 'Laundry Management System',
  clothesPrice: 25,
  bedSheetPrice: 50,
  minClothesPrice: 50,
  minBedSheetPrice: 50,
  overdueHours: 48,
  receiptFootnote: 'Thank you for using our service!',
};

let SYSTEM_SETTINGS = {
  overdueLimitMs: DEFAULT_SETTINGS.overdueHours * 60 * 60 * 1000,
};

let systemState = {
  l1: { door: 'CLOSED', weight: 0, status: 'available', action: 'lock', isConnected: true },
  l2: { door: 'CLOSED', weight: 0, status: 'available', action: 'lock', isConnected: true },
  l3: { door: 'CLOSED', weight: 0, status: 'available', action: 'lock', isConnected: true },
  credit: 0,
  lastUpdated: 0,
};

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`[LOCAL] Failed to read ${path.basename(filePath)}:`, error);
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`[LOCAL] Failed to write ${path.basename(filePath)}:`, error);
  }
}

function sanitizeWeight(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const safeValue = Math.max(0, parsed);
  return Math.round((safeValue + Number.EPSILON) * 100) / 100;
}

function normalizeTransactionStatus(status) {
  if (status === 'paid_pending' || status === 'processing' || status === 'occupied') {
    return TRANSACTION_STATUS.PENDING;
  }
  if (status === 'completed') return TRANSACTION_STATUS.COMPLETED;
  if (status === 'overdue_archived' || status === 'cancelled' || status === 'Archived') {
    return TRANSACTION_STATUS.ARCHIVED;
  }
  return status || TRANSACTION_STATUS.PENDING;
}

function normalizeLaundryType(type) {
  if (type === 'BedSheets') return 'Bed Sheets';
  return type || 'Clothes';
}

function normalizePhoneNumber(value) {
  const phone = String(value ?? '').trim();
  return /^09\d{9}$/.test(phone) ? phone : null;
}

function toIso(value = new Date()) {
  const dateValue = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dateValue.getTime()) ? new Date().toISOString() : dateValue.toISOString();
}

function toMillis(value) {
  if (!value) return null;
  const dateValue = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dateValue.getTime()) ? null : dateValue.getTime();
}

function boolToInt(value) {
  return value ? 1 : 0;
}

function intToBool(value) {
  return Boolean(Number(value));
}

const SQL = await initSqlJs({
  locateFile: (file) => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file),
});

const database = fs.existsSync(DB_FILE)
  ? new SQL.Database(fs.readFileSync(DB_FILE))
  : new SQL.Database();

function persistDatabase() {
  fs.writeFileSync(DB_FILE, Buffer.from(database.export()));
}

database.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    laundryShopName TEXT NOT NULL,
    clothesPrice REAL NOT NULL,
    bedSheetPrice REAL NOT NULL,
    minClothesPrice REAL NOT NULL,
    minBedSheetPrice REAL NOT NULL,
    overdueHours INTEGER NOT NULL,
    receiptFootnote TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lockers (
    id INTEGER PRIMARY KEY,
    capacity TEXT NOT NULL DEFAULT '20 kg',
    status TEXT NOT NULL DEFAULT 'available',
    action TEXT NOT NULL DEFAULT 'lock',
    currentTransactionId TEXT,
    adminCommand TEXT,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    transactionId TEXT PRIMARY KEY,
    lockerId INTEGER,
    pin TEXT,
    price REAL NOT NULL DEFAULT 0,
    weight REAL NOT NULL DEFAULT 0,
    pricePerKg REAL NOT NULL DEFAULT 0,
    phoneNumber TEXT,
    type TEXT NOT NULL DEFAULT 'Clothes',
    status TEXT NOT NULL,
    laundryStatus TEXT NOT NULL DEFAULT 'Dropped',
    triggerReminder INTEGER NOT NULL DEFAULT 0,
    reminderSent INTEGER NOT NULL DEFAULT 0,
    reminderSentAt TEXT,
    triggerPrint INTEGER NOT NULL DEFAULT 0,
    codeSmsSent INTEGER NOT NULL DEFAULT 0,
    doneSmsSent INTEGER NOT NULL DEFAULT 0,
    droppedAt TEXT NOT NULL,
    doneAt TEXT,
    pickedUpAt TEXT,
    paymentId TEXT,
    archivedAt TEXT,
    archivedFromLockerId INTEGER,
    note TEXT,
    updatedAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_locker_status
    ON transactions (lockerId, status);

  CREATE INDEX IF NOT EXISTS idx_transactions_status
    ON transactions (status, laundryStatus);

  CREATE INDEX IF NOT EXISTS idx_transactions_print
    ON transactions (triggerPrint);

  CREATE TABLE IF NOT EXISTS overdue_logs (
    logId TEXT PRIMARY KEY,
    originalTransactionId TEXT NOT NULL,
    archivedAt TEXT,
    reason TEXT,
    note TEXT,
    status TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'Clothes',
    price REAL NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_overdue_logs_transaction
    ON overdue_logs (originalTransactionId, status);
`);

database.run(`
  UPDATE transactions
  SET weight = ROUND(COALESCE(weight, 0), 2)
  WHERE ABS(COALESCE(weight, 0) - ROUND(COALESCE(weight, 0), 2)) > 0.000001
`);

persistDatabase();

function run(sql, ...params) {
  database.run(sql, params);
  persistDatabase();
}

function get(sql, ...params) {
  const statement = database.prepare(sql, params);
  try {
    if (!statement.step()) return undefined;
    return statement.getAsObject();
  } finally {
    statement.free();
  }
}

function all(sql, ...params) {
  const statement = database.prepare(sql, params);
  const rows = [];

  try {
    while (statement.step()) {
      rows.push(statement.getAsObject());
    }
  } finally {
    statement.free();
  }

  return rows;
}

function normalizeTransactionRecord(raw = {}) {
  const transactionId = raw.transactionId || raw.firebaseDocId;
  if (!transactionId) return null;

  const status = normalizeTransactionStatus(raw.status);
  const droppedAt = toIso(raw.droppedAt || raw.timestamp || Date.now());
  const doneAt = raw.doneAt ? toIso(raw.doneAt) : null;
  const pickedUpAt = raw.pickedUpAt ? toIso(raw.pickedUpAt) : null;
  const reminderSentAt = raw.reminderSentAt ? toIso(raw.reminderSentAt) : null;
  const archivedAt = raw.archivedAt ? toIso(raw.archivedAt) : null;
  const updatedAt = toIso(raw.updatedAt || raw.droppedAt || raw.timestamp || Date.now());

  return {
    transactionId,
    lockerId: raw.lockerId !== undefined && raw.lockerId !== null ? Number(raw.lockerId) : null,
    pin: String(raw.pinCode ?? raw.pin ?? '0000'),
    price: Number(raw.price || 0),
    weight: sanitizeWeight(raw.weight),
    pricePerKg: Number(raw.pricePerKg || 0),
    phoneNumber: normalizePhoneNumber(raw.phoneNumber),
    type: normalizeLaundryType(raw.type),
    status,
    laundryStatus: raw.laundryStatus || (status === TRANSACTION_STATUS.PENDING ? 'Dropped' : 'Done'),
    triggerReminder: boolToInt(Boolean(raw.triggerReminder)),
    reminderSent: boolToInt(Boolean(raw.reminderSent)),
    reminderSentAt,
    triggerPrint: boolToInt(Boolean(raw.triggerPrint)),
    codeSmsSent: boolToInt(Boolean(raw.codeSmsSent)),
    doneSmsSent: boolToInt(Boolean(raw.doneSmsSent)),
    droppedAt,
    doneAt,
    pickedUpAt,
    paymentId: raw.paymentId || null,
    archivedAt,
    archivedFromLockerId: raw.archivedFromLockerId !== undefined && raw.archivedFromLockerId !== null
      ? Number(raw.archivedFromLockerId)
      : null,
    note: raw.note || null,
    updatedAt,
  };
}

function insertTransaction(record) {
  run(
    `INSERT OR REPLACE INTO transactions (
      transactionId, lockerId, pin, price, weight, pricePerKg, phoneNumber, type,
      status, laundryStatus, triggerReminder, reminderSent, reminderSentAt, triggerPrint,
      codeSmsSent, doneSmsSent, droppedAt, doneAt, pickedUpAt, paymentId,
      archivedAt, archivedFromLockerId, note, updatedAt
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )`,
    record.transactionId,
    record.lockerId,
    record.pin,
    record.price,
    record.weight,
    record.pricePerKg,
    record.phoneNumber,
    record.type,
    record.status,
    record.laundryStatus,
    record.triggerReminder,
    record.reminderSent,
    record.reminderSentAt,
    record.triggerPrint,
    record.codeSmsSent,
    record.doneSmsSent,
    record.droppedAt,
    record.doneAt,
    record.pickedUpAt,
    record.paymentId,
    record.archivedAt,
    record.archivedFromLockerId,
    record.note,
    record.updatedAt,
  );
}

function getOverdueLogEntry(originalTransactionId) {
  return get(
    `SELECT *
     FROM overdue_logs
     WHERE originalTransactionId = ?`,
    originalTransactionId,
  );
}

function upsertOverdueLogForTransaction(transactionOrId, overrides = {}, options = {}) {
  const transaction = typeof transactionOrId === 'string'
    ? findTransaction(transactionOrId)
    : transactionOrId;

  if (!transaction) return;

  const current = getOverdueLogEntry(transaction.transactionId);
  if (!current && options.createIfMissing === false) {
    return;
  }

  const logId = current?.logId || `ODL-${transaction.transactionId}`;
  const reason = overrides.reason ?? current?.reason ?? 'Overdue transaction';
  const note = overrides.note ?? current?.note ?? transaction.note ?? null;
  const archivedAt = overrides.archivedAt ?? current?.archivedAt ?? transaction.archivedAt ?? null;
  const status = overrides.status ?? current?.status ?? transaction.status ?? TRANSACTION_STATUS.PENDING;
  const type = overrides.type ?? current?.type ?? transaction.type ?? 'Clothes';
  const price = Number(overrides.price ?? current?.price ?? transaction.price ?? 0);

  run(
    `INSERT OR REPLACE INTO overdue_logs (
      logId, originalTransactionId, archivedAt, reason, note, status, type, price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    logId,
    transaction.transactionId,
    archivedAt,
    reason,
    note,
    status,
    type,
    price,
  );
}

function isOverdueLaundryStatus(laundryStatus) {
  return laundryStatus === 'Done' || laundryStatus === 'Ready for Pick-up';
}

function hasOverdueSignal(transaction) {
  return intToBool(transaction?.reminderSent) || intToBool(transaction?.triggerReminder);
}

function syncOverdueLogForTransaction(transactionOrId, overrides = {}, options = {}) {
  const transaction = typeof transactionOrId === 'string'
    ? findTransaction(transactionOrId)
    : transactionOrId;

  if (!transaction) return;

  const current = getOverdueLogEntry(transaction.transactionId);
  const qualifiesByArchivedStatus = transaction.status === TRANSACTION_STATUS.ARCHIVED;
  const shouldCreate = options.createIfMissing
    ?? Boolean(current || hasOverdueSignal(transaction) || qualifiesByArchivedStatus);

  if (!shouldCreate && !current) {
    return;
  }

  upsertOverdueLogForTransaction(transaction, overrides, { createIfMissing: shouldCreate });
}

function reconcileOverdueLogsFromTransactions() {
  const rows = all(
    `SELECT DISTINCT t.*
     FROM transactions t
     LEFT JOIN overdue_logs o
       ON o.originalTransactionId = t.transactionId
     WHERE (
       (
         t.doneAt IS NOT NULL
         AND t.laundryStatus IN ('Done', 'Ready for Pick-up')
         AND (t.reminderSent = 1 OR t.triggerReminder = 1 OR o.logId IS NOT NULL)
       )
       OR (
         t.status = ?
         AND t.archivedAt IS NOT NULL
       )
     )`,
    TRANSACTION_STATUS.ARCHIVED,
  );

  for (const transaction of rows) {
    syncOverdueLogForTransaction(
      transaction,
      {
        status: transaction.status || TRANSACTION_STATUS.PENDING,
        archivedAt: transaction.status === TRANSACTION_STATUS.ARCHIVED ? transaction.archivedAt : null,
      },
      { createIfMissing: true },
    );
  }
}

function getOverdueLogsForAdmin() {
  return all(
    `SELECT
       o.logId,
       o.originalTransactionId,
       o.archivedAt,
       o.reason,
       o.note,
       o.status,
       o.type,
       o.price,
       t.lockerId,
       t.archivedFromLockerId,
       t.phoneNumber,
       t.paymentId,
       t.doneAt,
       t.laundryStatus,
       t.pin
     FROM overdue_logs o
     LEFT JOIN transactions t
       ON t.transactionId = o.originalTransactionId
     WHERE o.status IN (?, ?)
     ORDER BY
       CASE o.status
         WHEN 'Pending' THEN 0
         WHEN 'Archived' THEN 1
         ELSE 2
       END,
       COALESCE(o.archivedAt, t.doneAt) DESC`,
    TRANSACTION_STATUS.PENDING,
    TRANSACTION_STATUS.ARCHIVED,
  ).map((row) => ({
    id: row.originalTransactionId,
    transactionDocId: row.logId,
    lockerId: row.lockerId !== null && row.lockerId !== undefined ? Number(row.lockerId) : null,
    archivedFromLockerId: row.archivedFromLockerId !== null && row.archivedFromLockerId !== undefined
      ? Number(row.archivedFromLockerId)
      : null,
    pinCode: String(row.pin ?? '0000'),
    price: Number(row.price || 0),
    weight: 0,
    laundryType: row.type || 'Clothes',
    laundryStatus: row.laundryStatus || 'Done',
    reminderSent: true,
    status: row.status || TRANSACTION_STATUS.PENDING,
    phoneNumber: row.phoneNumber || '',
    paymentId: row.paymentId || '',
    droppedAt: null,
    doneAt: row.doneAt || null,
    pickedUpAt: null,
    note: row.note || row.reason || '',
    updatedAt: row.archivedAt || row.doneAt || null,
  }));
}

function getSettings() {
  const row = get(`SELECT * FROM settings WHERE id = 1`);
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    laundryShopName: row.laundryShopName,
    clothesPrice: Number(row.clothesPrice),
    bedSheetPrice: Number(row.bedSheetPrice),
    minClothesPrice: Number(row.minClothesPrice),
    minBedSheetPrice: Number(row.minBedSheetPrice),
    overdueHours: Number(row.overdueHours),
    receiptFootnote: row.receiptFootnote,
    updatedAt: row.updatedAt,
  };
}

function syncSystemSettingsFromDatabase() {
  const settings = getSettings();
  SYSTEM_SETTINGS.overdueLimitMs = Number(settings.overdueHours) * 60 * 60 * 1000;
  return settings;
}

function seedDatabase() {
  const settingsCount = get(`SELECT COUNT(*) AS count FROM settings`).count;
  if (!settingsCount) {
    const legacySettings = readJsonFile(LOCAL_SETTINGS_FILE, DEFAULT_SETTINGS);
    const initialSettings = {
      ...DEFAULT_SETTINGS,
      ...legacySettings,
      updatedAt: toIso(legacySettings.updatedAt || Date.now()),
    };
    run(
      `INSERT INTO settings (
        id, laundryShopName, clothesPrice, bedSheetPrice, minClothesPrice,
        minBedSheetPrice, overdueHours, receiptFootnote, updatedAt
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      initialSettings.laundryShopName,
      Number(initialSettings.clothesPrice ?? DEFAULT_SETTINGS.clothesPrice),
      Number(initialSettings.bedSheetPrice ?? DEFAULT_SETTINGS.bedSheetPrice),
      Number(initialSettings.minClothesPrice ?? DEFAULT_SETTINGS.minClothesPrice),
      Number(initialSettings.minBedSheetPrice ?? DEFAULT_SETTINGS.minBedSheetPrice),
      Number(initialSettings.overdueHours ?? DEFAULT_SETTINGS.overdueHours),
      initialSettings.receiptFootnote || DEFAULT_SETTINGS.receiptFootnote,
      initialSettings.updatedAt,
    );
  }

  const lockerCount = get(`SELECT COUNT(*) AS count FROM lockers`).count;
  if (!lockerCount) {
    const now = toIso();
    for (const id of [1, 2, 3]) {
      run(
        `INSERT INTO lockers (id, capacity, status, action, currentTransactionId, adminCommand, updatedAt)
         VALUES (?, '20 kg', 'available', 'lock', NULL, NULL, ?)`,
        id,
        now,
      );
    }
  }

  const transactionCount = get(`SELECT COUNT(*) AS count FROM transactions`).count;
  if (!transactionCount) {
    const legacyTransactions = readJsonFile(LOCAL_TRANSACTIONS_FILE, []);
    if (Array.isArray(legacyTransactions)) {
      for (const raw of legacyTransactions) {
        const record = normalizeTransactionRecord(raw);
        if (record) insertTransaction(record);
      }
    }
  }

  rebuildLockerOccupancy();
  syncSystemSettingsFromDatabase();
}

function rebuildLockerOccupancy() {
  const now = toIso();
  for (const id of [1, 2, 3]) {
    const pending = get(
      `SELECT transactionId
       FROM transactions
       WHERE lockerId = ? AND status = ?
       ORDER BY updatedAt DESC
       LIMIT 1`,
      id,
      TRANSACTION_STATUS.PENDING,
    );

    run(
      `UPDATE lockers
       SET status = ?, currentTransactionId = ?, updatedAt = ?
       WHERE id = ?`,
      pending ? 'occupied' : 'available',
      pending ? pending.transactionId : null,
      now,
      id,
    );
  }
}

function getActiveTransactionByLocker(lockerId) {
  return get(
    `SELECT *
     FROM transactions
     WHERE lockerId = ? AND status = ?
     ORDER BY updatedAt DESC
     LIMIT 1`,
    Number(lockerId),
    TRANSACTION_STATUS.PENDING,
  );
}

function findTransaction(transactionId) {
  return get(`SELECT * FROM transactions WHERE transactionId = ?`, transactionId);
}

function getPendingTransactions() {
  return all(
    `SELECT *
     FROM transactions
     WHERE status = ?
     ORDER BY updatedAt DESC`,
    TRANSACTION_STATUS.PENDING,
  );
}

function enqueueLockerAction(lockerId, action) {
  const queue = readJsonFile(LOCKER_ACTIONS_FILE, []);
  queue.push({
    lockerId: String(lockerId),
    action: String(action).toUpperCase(),
    ts: Date.now(),
  });
  writeJsonFile(LOCKER_ACTIONS_FILE, queue);
}

function updateLockerAction(lockerId, action) {
  const normalizedAction = String(action).toLowerCase() === 'unlock' ? 'unlock' : 'lock';
  const key = `l${lockerId}`;

  if (systemState[key]) {
    systemState[key].action = normalizedAction;
  }

  run(
    `UPDATE lockers
     SET action = ?, updatedAt = ?
     WHERE id = ?`,
    normalizedAction,
    toIso(),
    Number(lockerId),
  );
}

function setLockerOccupied(lockerId, transactionId) {
  const key = `l${lockerId}`;
  if (systemState[key]) {
    systemState[key].status = 'occupied';
  }

  run(
    `UPDATE lockers
     SET status = 'occupied', currentTransactionId = ?, updatedAt = ?
     WHERE id = ?`,
    transactionId,
    toIso(),
    Number(lockerId),
  );
}

function markLockerAvailableAndLock(lockerId) {
  const key = `l${lockerId}`;
  if (systemState[key]) {
    systemState[key].status = 'available';
    systemState[key].action = 'lock';
  }

  run(
    `UPDATE lockers
     SET status = 'available', action = 'lock', currentTransactionId = NULL, adminCommand = NULL, updatedAt = ?
     WHERE id = ?`,
    toIso(),
    Number(lockerId),
  );

  enqueueLockerAction(lockerId, 'lock');
}

function getLocalLockers() {
  return [1, 2, 3].map((id) => {
    const lockerRow = get(`SELECT * FROM lockers WHERE id = ?`, id) || {};
    const hardware = systemState[`l${id}`] || {};
    const active = getActiveTransactionByLocker(id);

    return {
      id,
      capacity: lockerRow.capacity || '20 kg',
      status: active ? 'occupied' : (lockerRow.status || 'available'),
      weight: sanitizeWeight(active ? active.weight : hardware.weight),
      price: active ? Number(active.price) : undefined,
      pin: active?.pin || undefined,
      laundryStatus: active?.laundryStatus || undefined,
      doorStatus: hardware.door || 'CLOSED',
      isConnected: hardware.isConnected !== undefined ? hardware.isConnected : true,
      currentTransactionId: active?.transactionId || lockerRow.currentTransactionId || undefined,
    };
  });
}

function getAdminOverview() {
  const transactionsById = {};
  for (const tx of getPendingTransactions()) {
    transactionsById[tx.transactionId] = {
      id: tx.transactionId,
      transactionDocId: tx.transactionId,
      pinCode: String(tx.pin ?? '0000'),
      price: Number(tx.price || 0),
      weight: sanitizeWeight(tx.weight),
      laundryType: tx.type || 'N/A',
      laundryStatus: tx.laundryStatus || 'Dropped',
      reminderSent: intToBool(tx.reminderSent),
    };
  }

  const lockers = getLocalLockers()
    .filter((locker) => locker.isConnected !== false)
    .map((locker) => ({
      id: String(locker.id),
      lockerNumber: locker.id,
      isLocked: (systemState[`l${locker.id}`]?.action || 'lock') !== 'unlock',
      isConnected: locker.isConnected !== false,
      status: locker.status === 'occupied' ? 'occupied' : 'available',
      currentTransactionId: locker.currentTransactionId,
    }))
    .sort((a, b) => a.lockerNumber - b.lockerNumber);

  reconcileOverdueLogsFromTransactions();
  const overdueTransactions = getOverdueLogsForAdmin();

  return { lockers, transactionsById, overdueTransactions };
}

function formatTransactionForAdmin(row) {
  return {
    transactionId: row.transactionId,
    lockerId: row.lockerId !== null && row.lockerId !== undefined ? Number(row.lockerId) : null,
    archivedFromLockerId: row.archivedFromLockerId !== null && row.archivedFromLockerId !== undefined
      ? Number(row.archivedFromLockerId)
      : null,
    pin: String(row.pin ?? '0000'),
    price: Number(row.price || 0),
    weight: sanitizeWeight(row.weight),
    pricePerKg: Number(row.pricePerKg || 0),
    phoneNumber: row.phoneNumber || '',
    type: row.type || 'Clothes',
    status: row.status || TRANSACTION_STATUS.PENDING,
    laundryStatus: row.laundryStatus || 'Dropped',
    reminderSent: intToBool(row.reminderSent),
    triggerReminder: intToBool(row.triggerReminder),
    droppedAt: row.droppedAt || null,
    doneAt: row.doneAt || null,
    pickedUpAt: row.pickedUpAt || null,
    paymentId: row.paymentId || '',
    archivedAt: row.archivedAt || null,
    note: row.note || '',
    updatedAt: row.updatedAt || null,
  };
}

function normalizeDateInput(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return normalized;
}

function buildStartDateIso(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return null;
  const dateValue = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(dateValue.getTime()) ? null : dateValue.toISOString();
}

function buildEndDateIso(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return null;
  const dateValue = new Date(`${normalized}T23:59:59.999`);
  return Number.isNaN(dateValue.getTime()) ? null : dateValue.toISOString();
}

function getFilteredTransactions({
  search = '',
  status = 'all',
  laundryStatus = 'all',
  type = 'all',
  lockerId = 'all',
  startDate = '',
  endDate = '',
} = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    const term = `%${String(search).trim().toLowerCase()}%`;
    conditions.push(`(
      LOWER(transactionId) LIKE ?
      OR LOWER(COALESCE(paymentId, '')) LIKE ?
      OR LOWER(COALESCE(phoneNumber, '')) LIKE ?
      OR LOWER(COALESCE(pin, '')) LIKE ?
      OR LOWER(COALESCE(type, '')) LIKE ?
    )`);
    params.push(term, term, term, term, term);
  }

  if (status !== 'all') {
    conditions.push(`status = ?`);
    params.push(String(status));
  }

  if (laundryStatus !== 'all') {
    conditions.push(`laundryStatus = ?`);
    params.push(String(laundryStatus));
  }

  if (type !== 'all') {
    conditions.push(`type = ?`);
    params.push(String(type));
  }

  if (lockerId !== 'all') {
    const parsedLockerId = Number(lockerId);
    if (Number.isFinite(parsedLockerId)) {
      conditions.push(`(lockerId = ? OR archivedFromLockerId = ?)`);
      params.push(parsedLockerId, parsedLockerId);
    }
  }

  const startIso = buildStartDateIso(startDate);
  if (startIso) {
    conditions.push(`droppedAt >= ?`);
    params.push(startIso);
  }

  const endIso = buildEndDateIso(endDate);
  if (endIso) {
    conditions.push(`droppedAt <= ?`);
    params.push(endIso);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = all(
    `SELECT *
     FROM transactions
     ${whereClause}
     ORDER BY droppedAt DESC, updatedAt DESC`,
    ...params,
  );

  return rows.map(formatTransactionForAdmin);
}

function getSalesSummary({ startDate = '', endDate = '' } = {}) {
  const conditions = [`status = ?`, `pickedUpAt IS NOT NULL`];
  const params = [TRANSACTION_STATUS.COMPLETED];

  const startIso = buildStartDateIso(startDate);
  if (startIso) {
    conditions.push(`pickedUpAt >= ?`);
    params.push(startIso);
  }

  const endIso = buildEndDateIso(endDate);
  if (endIso) {
    conditions.push(`pickedUpAt <= ?`);
    params.push(endIso);
  }

  const rows = all(
    `SELECT *
     FROM transactions
     WHERE ${conditions.join(' AND ')}
     ORDER BY pickedUpAt DESC, updatedAt DESC`,
    ...params,
  );

  const summary = {
    totalSales: 0,
    totalTransactions: rows.length,
    totalWeight: 0,
    averageSale: 0,
  };

  const byTypeMap = new Map();
  const dailySalesMap = new Map();

  for (const row of rows) {
    const price = Number(row.price || 0);
    const weight = sanitizeWeight(row.weight);
    const type = row.type || 'Clothes';
    const pickedUpAt = row.pickedUpAt || row.updatedAt || row.droppedAt;
    const pickedUpDate = String(pickedUpAt || '').slice(0, 10) || 'Unknown';

    summary.totalSales += price;
    summary.totalWeight = sanitizeWeight(summary.totalWeight + weight);

    const existingType = byTypeMap.get(type) || { type, totalSales: 0, totalTransactions: 0, totalWeight: 0 };
    existingType.totalSales += price;
    existingType.totalTransactions += 1;
    existingType.totalWeight = sanitizeWeight(existingType.totalWeight + weight);
    byTypeMap.set(type, existingType);

    const existingDay = dailySalesMap.get(pickedUpDate) || { date: pickedUpDate, totalSales: 0, totalTransactions: 0 };
    existingDay.totalSales += price;
    existingDay.totalTransactions += 1;
    dailySalesMap.set(pickedUpDate, existingDay);
  }

  summary.averageSale = summary.totalTransactions ? summary.totalSales / summary.totalTransactions : 0;

  return {
    summary,
    byType: Array.from(byTypeMap.values()).sort((a, b) => b.totalSales - a.totalSales),
    dailySales: Array.from(dailySalesMap.values()).sort((a, b) => String(b.date).localeCompare(String(a.date))),
    transactions: rows.map(formatTransactionForAdmin),
  };
}

function writeReceiptToPrinter(receiptText) {
  const printerPorts = ['/dev/usb/lp0', '/dev/usb/lp1', '/dev/usb/lp2'];
  const printerPath = printerPorts.find((candidate) => fs.existsSync(candidate));

  if (!printerPath) {
    console.error('[PRINT] No USB printer found in /dev/usb');
    return false;
  }

  fs.writeFile(printerPath, receiptText, (error) => {
    if (error) {
      console.error('[PRINT] Printer write failed:', error);
    } else {
      console.log(`[PRINT] Receipt sent to ${printerPath}`);
    }
  });

  return true;
}

function executePrintCommand(data) {
  const receiptText = `
   ${String(data.shopName || DEFAULT_SETTINGS.laundryShopName).toUpperCase()}
   --------------------------
   Date: ${new Date().toLocaleString()}
   Trans #: ${data.transactionId}
   Service: ${String(data.processType || 'dropoff').toUpperCase()}
   --------------------------
   Weight: ${sanitizeWeight(data.weight).toFixed(2)} kg
   Price:  ₱${Number(data.price || 0).toFixed(2)}
   --------------------------
   ${data.processType === 'dropoff' ? `PIN: ${data.pin}` : 'Status: PAID'}
   --------------------------
   ${data.receiptFootnote || 'Thank you!'}



`;

  return writeReceiptToPrinter(receiptText);
}

function processPendingPrints() {
  const settings = getSettings();
  const rows = all(
    `SELECT *
     FROM transactions
     WHERE triggerPrint = 1
     ORDER BY updatedAt ASC`,
  );

  for (const tx of rows) {
    executePrintCommand({
      transactionId: tx.transactionId,
      pin: tx.pin,
      processType: tx.status === TRANSACTION_STATUS.COMPLETED ? 'pickup' : 'dropoff',
      weight: tx.weight,
      price: tx.price,
      type: tx.type,
      shopName: settings.laundryShopName,
      receiptFootnote: settings.receiptFootnote,
    });

    run(
      `UPDATE transactions
       SET triggerPrint = 0, updatedAt = ?
       WHERE transactionId = ?`,
      toIso(),
      tx.transactionId,
    );
  }
}

function checkOverduePickups() {
  const thresholdMs = SYSTEM_SETTINGS.overdueLimitMs;
  const now = Date.now();

  const rows = all(
    `SELECT transactionId, doneAt, reminderSent
     FROM transactions
     WHERE status = ? AND laundryStatus = 'Done' AND doneAt IS NOT NULL AND reminderSent = 0`,
    TRANSACTION_STATUS.PENDING,
  );

  for (const tx of rows) {
    const doneAtMillis = toMillis(tx.doneAt);
    if (doneAtMillis === null || now - doneAtMillis <= thresholdMs) {
      continue;
    }

    run(
      `UPDATE transactions
       SET triggerReminder = 1,
           reminderSent = 1,
           reminderSentAt = ?,
           note = ?,
           updatedAt = ?
       WHERE transactionId = ?`,
      toIso(now),
      'Auto-reminder queued after overdue threshold.',
      toIso(now),
      tx.transactionId,
    );

    syncOverdueLogForTransaction(
      tx.transactionId,
      {
        status: TRANSACTION_STATUS.PENDING,
        reason: 'Overdue pickup',
        note: 'Auto-reminder queued after overdue threshold.',
      },
      { createIfMissing: true },
    );
  }
}

function updateStateFromFile() {
  if (!fs.existsSync(STATE_FILE)) return;

  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!data.raw_data || !String(data.raw_data).startsWith('DATA')) return;

    const parts = String(data.raw_data).split('|');
    for (const part of parts) {
      if (part.startsWith('L1:')) {
        const values = part.split(':');
        systemState.l1.weight = sanitizeWeight(values[1]);
        systemState.l1.door = values[2];
        systemState.l1.isConnected = values[3] !== undefined ? values[3].trim() === '1' : true;
      }
      if (part.startsWith('L2:')) {
        const values = part.split(':');
        systemState.l2.weight = sanitizeWeight(values[1]);
        systemState.l2.door = values[2];
        systemState.l2.isConnected = values[3] !== undefined ? values[3].trim() === '1' : true;
      }
      if (part.startsWith('L3:')) {
        const values = part.split(':');
        systemState.l3.weight = sanitizeWeight(values[1]);
        systemState.l3.door = values[2];
        systemState.l3.isConnected = values[3] !== undefined ? values[3].trim() === '1' : true;
      }
      if (part.startsWith('CREDIT:')) {
        const values = part.split(':');
        systemState.credit = Number.parseFloat(values[1]) || 0;
      }
    }

    systemState.lastUpdated = Number(data.timestamp) || Date.now();
  } catch (error) {
    console.error('[STATE] Failed to parse sys_state.json:', error);
  }
}

seedDatabase();
updateStateFromFile();
processPendingPrints();
checkOverduePickups();

setInterval(updateStateFromFile, 200);
setInterval(processPendingPrints, 5000);
setInterval(checkOverduePickups, 30 * 1000);

app.get('/api/status', (req, res) => {
  res.json(systemState);
});

app.get('/api/lockers', (req, res) => {
  res.json(getLocalLockers().filter((locker) => locker.isConnected !== false));
});

app.get('/api/settings', (req, res) => {
  res.json(getSettings());
});

app.get('/api/admin/overview', (req, res) => {
  res.json(getAdminOverview());
});

app.get('/api/admin/transactions', (req, res) => {
  const transactions = getFilteredTransactions({
    search: req.query.search,
    status: req.query.status,
    laundryStatus: req.query.laundryStatus,
    type: req.query.type,
    lockerId: req.query.lockerId,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
  });

  res.json({
    transactions,
    total: transactions.length,
  });
});

app.get('/api/admin/sales', (req, res) => {
  res.json(
    getSalesSummary({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    }),
  );
});

app.post('/api/settings', (req, res) => {
  const current = getSettings();
  const toNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const updatedSettings = {
    laundryShopName: typeof req.body.laundryShopName === 'string' && req.body.laundryShopName.trim()
      ? req.body.laundryShopName.trim()
      : current.laundryShopName,
    clothesPrice: toNumber(req.body.clothesPrice, current.clothesPrice),
    bedSheetPrice: toNumber(req.body.bedSheetPrice, current.bedSheetPrice),
    minClothesPrice: toNumber(req.body.minClothesPrice, current.minClothesPrice),
    minBedSheetPrice: toNumber(req.body.minBedSheetPrice, current.minBedSheetPrice),
    overdueHours: toNumber(req.body.overdueHours, current.overdueHours),
    receiptFootnote: typeof req.body.receiptFootnote === 'string'
      ? req.body.receiptFootnote
      : current.receiptFootnote,
    updatedAt: toIso(),
  };

  run(
    `UPDATE settings
     SET laundryShopName = ?, clothesPrice = ?, bedSheetPrice = ?, minClothesPrice = ?,
         minBedSheetPrice = ?, overdueHours = ?, receiptFootnote = ?, updatedAt = ?
     WHERE id = 1`,
    updatedSettings.laundryShopName,
    updatedSettings.clothesPrice,
    updatedSettings.bedSheetPrice,
    updatedSettings.minClothesPrice,
    updatedSettings.minBedSheetPrice,
    updatedSettings.overdueHours,
    updatedSettings.receiptFootnote,
    updatedSettings.updatedAt,
  );

  SYSTEM_SETTINGS.overdueLimitMs = Number(updatedSettings.overdueHours) * 60 * 60 * 1000;
  res.json({ success: true, settings: getSettings() });
});

app.post('/api/admin/transaction/status', (req, res) => {
  const { transactionId, laundryStatus } = req.body;
  const tx = findTransaction(transactionId);

  if (!tx || tx.status !== TRANSACTION_STATUS.PENDING) {
    return res.status(404).json({ success: false, message: 'Active transaction not found.' });
  }

  const now = toIso();
  const isDone = laundryStatus === 'Done';

  run(
    `UPDATE transactions
     SET laundryStatus = ?,
         doneAt = ?,
         reminderSent = ?,
         triggerReminder = 0,
         reminderSentAt = NULL,
         doneSmsSent = ?,
         updatedAt = ?
     WHERE transactionId = ?`,
    laundryStatus,
    isDone ? now : null,
    0,
    0,
    now,
    transactionId,
  );

  syncOverdueLogForTransaction(transactionId, {
    status: isDone ? TRANSACTION_STATUS.PENDING : tx.status,
  });

  res.json({ success: true, overview: getAdminOverview() });
});

app.post('/api/admin/transaction/reset', (req, res) => {
  const { lockerId, transactionId } = req.body;
  const tx = findTransaction(transactionId);

  if (!tx) {
    return res.status(404).json({ success: false, message: 'Transaction not found.' });
  }

  run(
    `UPDATE transactions
     SET status = ?, archivedFromLockerId = ?, lockerId = NULL, archivedAt = ?, note = ?, updatedAt = ?
     WHERE transactionId = ?`,
    TRANSACTION_STATUS.ARCHIVED,
    Number(lockerId),
    toIso(),
    'Archived by local admin reset',
    toIso(),
    transactionId,
  );

  if (hasOverdueSignal(tx) || getOverdueLogEntry(transactionId)) {
    syncOverdueLogForTransaction(
      transactionId,
      {
        status: TRANSACTION_STATUS.ARCHIVED,
        archivedAt: toIso(),
        reason: 'Archived overdue transaction',
        note: 'Archived by local admin reset',
      },
      { createIfMissing: true },
    );
  }

  markLockerAvailableAndLock(lockerId);
  res.json({ success: true, overview: getAdminOverview() });
});

app.post('/api/admin/transaction/print', (req, res) => {
  const { transactionId } = req.body;
  const tx = findTransaction(transactionId);

  if (!tx) {
    return res.status(404).json({ success: false, message: 'Transaction not found.' });
  }

  const settings = getSettings();
  executePrintCommand({
    transactionId: tx.transactionId,
    pin: tx.pin,
    processType: tx.status === TRANSACTION_STATUS.COMPLETED ? 'pickup' : 'dropoff',
    weight: tx.weight,
    price: tx.price,
    type: tx.type,
    shopName: settings.laundryShopName,
    receiptFootnote: settings.receiptFootnote,
  });

  res.json({ success: true });
});

app.post('/api/admin/transaction/mark-paid', (req, res) => {
  const { transactionId } = req.body;
  const tx = findTransaction(transactionId);

  if (!tx) {
    return res.status(404).json({ success: false, message: 'Transaction not found.' });
  }

  if (tx.status === TRANSACTION_STATUS.COMPLETED) {
    return res.json({ success: true, overview: getAdminOverview() });
  }

  const lockerId = tx.lockerId !== null && tx.lockerId !== undefined ? Number(tx.lockerId) : null;
  const now = toIso();
  const paymentId = tx.paymentId || `ADMIN-PAY-${Math.floor(Date.now() / 1000)}`;

  run(
    `UPDATE transactions
     SET status = ?,
         pickedUpAt = ?,
         paymentId = ?,
         reminderSent = 0,
         triggerReminder = 0,
         reminderSentAt = NULL,
         triggerPrint = 1,
         updatedAt = ?,
         note = ?
     WHERE transactionId = ?`,
    TRANSACTION_STATUS.COMPLETED,
    now,
    paymentId,
    now,
    'Marked paid by local admin overdue settlement',
    transactionId,
  );

  syncOverdueLogForTransaction(
    transactionId,
    {
      status: TRANSACTION_STATUS.COMPLETED,
      reason: 'Overdue transaction paid',
      note: 'Marked paid by local admin overdue settlement',
    },
    { createIfMissing: true },
  );

  if (lockerId !== null && Number.isFinite(lockerId)) {
    markLockerAvailableAndLock(lockerId);
  }

  processPendingPrints();
  res.json({ success: true, overview: getAdminOverview() });
});

app.post('/api/print-receipt', (req, res) => {
  const settings = getSettings();
  const { lockerUnit, weight, totalDue, date } = req.body || {};

  const receiptText = `
   ${String(settings.laundryShopName).toUpperCase()}
   --------------------------
   Date: ${date || new Date().toLocaleDateString('en-GB')}
   Locker: ${lockerUnit ?? 'N/A'}
   --------------------------
   Weight: ${sanitizeWeight(weight).toFixed(2)} kg
   Total:  ₱${Number(totalDue || 0).toFixed(2)}
   --------------------------
   ${settings.receiptFootnote || 'Thank you for using our service!'}



`;

  const printed = writeReceiptToPrinter(receiptText);
  if (!printed) {
    return res.status(503).json({ success: false, message: 'Printer unavailable.' });
  }

  res.json({ success: true });
});

app.post('/api/dropoff', (req, res) => {
  const droppedAt = toIso(req.body.droppedAt || Date.now());
  const transactionId = String(req.body.transactionId || `TRX-${Math.floor(Date.now() / 1000)}`);
  const lockerId = Number(req.body.lockerId);

  const record = normalizeTransactionRecord({
    transactionId,
    lockerId,
    pin: req.body.pin,
    price: req.body.price,
    weight: req.body.weight,
    pricePerKg: req.body.pricePerKg,
    phoneNumber: req.body.phoneNumber,
    type: req.body.type,
    status: TRANSACTION_STATUS.PENDING,
    laundryStatus: req.body.laundryStatus || 'Dropped',
    triggerReminder: false,
    reminderSent: false,
    triggerPrint: true,
    codeSmsSent: false,
    doneSmsSent: false,
    droppedAt,
    updatedAt: droppedAt,
    note: null,
  });

  insertTransaction(record);
  setLockerOccupied(lockerId, transactionId);
  processPendingPrints();

  res.json({ success: true, transactionId });
});

app.post('/api/pickup', (req, res) => {
  const lockerId = Number(req.body.lockerId);
  const paymentId = String(req.body.paymentId || `PAY-${Math.floor(Date.now() / 1000)}`);
  const now = toIso();

  const active = getActiveTransactionByLocker(lockerId);
  if (!active) {
    markLockerAvailableAndLock(lockerId);
    return res.json({ success: true });
  }

  run(
    `UPDATE transactions
     SET status = ?, pickedUpAt = ?, paymentId = ?, triggerPrint = 1, updatedAt = ?
     WHERE lockerId = ? AND status = ?`,
    TRANSACTION_STATUS.COMPLETED,
    now,
    paymentId,
    now,
    lockerId,
    TRANSACTION_STATUS.PENDING,
  );

  if (hasOverdueSignal(active) || getOverdueLogEntry(active.transactionId)) {
    syncOverdueLogForTransaction(
      active.transactionId,
      {
        status: TRANSACTION_STATUS.COMPLETED,
        reason: 'Overdue transaction paid',
        note: 'Picked up and paid from kiosk',
      },
      { createIfMissing: true },
    );
  }

  updateLockerAction(lockerId, 'unlock');
  run(
    `UPDATE lockers
     SET status = 'available', currentTransactionId = NULL, updatedAt = ?
     WHERE id = ?`,
    now,
    lockerId,
  );
  systemState[`l${lockerId}`].status = 'available';

  processPendingPrints();
  res.json({ success: true });
});

app.post('/api/unlock', (req, res) => {
  const lockerId = Number(req.body.lockerId);
  enqueueLockerAction(lockerId, 'unlock');
  updateLockerAction(lockerId, 'unlock');
  res.json({ success: true });
});

app.post('/api/lock', (req, res) => {
  const lockerId = Number(req.body.lockerId);
  enqueueLockerAction(lockerId, 'lock');
  updateLockerAction(lockerId, 'lock');
  res.json({ success: true });
});

if (fs.existsSync(DIST_INDEX_FILE)) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    // Always revalidate the SPA shell so rebuilt asset hashes are picked up.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(DIST_INDEX_FILE);
  });
} else {
  console.warn('[SERVER] Frontend build not found at dist/. Run "npm run build" before kiosk startup.');
}

app.listen(3000, () => {
  console.log(`[SERVER] Laundry kiosk backend running on port 3000 with SQLite at ${DB_FILE}`);
});
