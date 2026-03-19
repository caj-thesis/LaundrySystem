import { exec } from 'child_process';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- FIREBASE IMPORTS ---
import { db, auth } from './firebaseConfig.js'; 
import { 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  onSnapshot, 
  updateDoc,    
  query,        
  where,        
  getDocs
} from "firebase/firestore";
import { signInAnonymously } from "firebase/auth"; 

const app = express();
app.use(cors());
app.use(express.json());

const STATE_FILE = 'sys_state.json';
const LOCAL_TRANSACTIONS_FILE = 'local_transactions.json';
const LOCAL_SETTINGS_FILE = 'local_settings.json';
const LOCKER_ACTIONS_FILE = 'locker_actions.json';

// --- DYNAMIC SETTINGS STATE ---
let SYSTEM_SETTINGS = {
    overdueLimitMs: 48 * 60 * 60 * 1000 // Default 48 hours
};

// --- LOCAL STATE CONTAINER ---
let systemState = {
  l1: { door: 'CLOSED', weight: 0.0, status: 'available', action: 'lock', isConnected: true }, 
  l2: { door: 'CLOSED', weight: 0.0, status: 'available', action: 'lock', isConnected: true },
  l3: { door: 'CLOSED', weight: 0.0, status: 'available', action: 'lock', isConnected: true },
  credit: 0.0,
  lastUpdated: 0
};

let firebaseReady = false;
let firebaseBootstrapped = false;
let authRetryTimer = null;

const TRANSACTION_STATUS = {
    PENDING: 'Pending',
    COMPLETED: 'Completed',
    ARCHIVED: 'Archived'
};

function normalizeTransactionStatus(status) {
    if (status === 'paid_pending' || status === 'processing' || status === 'occupied') return TRANSACTION_STATUS.PENDING;
    if (status === 'completed') return TRANSACTION_STATUS.COMPLETED;
    if (status === 'overdue_archived' || status === 'cancelled' || status === 'Archived') return TRANSACTION_STATUS.ARCHIVED;
    return status;
}

function normalizeLaundryType(type) {
    if (type === 'BedSheets') return 'Bed Sheets';
    return type;
}

function sanitizeWeight(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, parsed);
}

function toMillis(value) {
    if (!value) return null;
    if (value?.toDate) return value.toDate().getTime();
    const dateValue = value instanceof Date ? value : new Date(value);
    return Number.isNaN(dateValue.getTime()) ? null : dateValue.getTime();
}

function readJsonFile(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`[LOCAL] Failed to read ${filePath}:`, error);
        return fallback;
    }
}

function writeJsonFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error(`[LOCAL] Failed to write ${filePath}:`, error);
    }
}

function startResilientSnapshotListener(targetRef, label, onNext, retryDelayMs = 5000) {
    let unsubscribe = null;
    let retryTimer = null;

    const connect = () => {
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }

        unsubscribe = onSnapshot(
            targetRef,
            (snapshot) => {
                if (retryTimer) {
                    clearTimeout(retryTimer);
                    retryTimer = null;
                }
                onNext(snapshot);
            },
            (error) => {
                console.error(`[FIREBASE LISTENER] ${label} failed:`, error?.message || error);
                if (unsubscribe) {
                    unsubscribe();
                    unsubscribe = null;
                }
                if (!retryTimer) {
                    retryTimer = setTimeout(() => {
                        retryTimer = null;
                        console.log(`[FIREBASE LISTENER] Reconnecting ${label}...`);
                        connect();
                    }, retryDelayMs);
                }
            }
        );
    };

    connect();
}

const defaultSettingsSync = {
    settingsSynced: true,
    lastError: null,
    updatedAt: null
};

const defaultLocalSettings = {
    laundryShopName: 'Laundry Management System',
    clothesPrice: 25,
    bedSheetPrice: 50,
    minClothesPrice: 50,
    minBedSheetPrice: 50,
    overdueHours: 48,
    receiptFootnote: 'Thank you for using our service!',
    sync: defaultSettingsSync
};

function normalizeSettingsSync(sync = {}) {
    return {
        settingsSynced: sync?.settingsSynced !== undefined ? Boolean(sync.settingsSynced) : true,
        lastError: sync?.lastError || null,
        updatedAt: sync?.updatedAt || null
    };
}

function normalizeLocalSettings(raw = {}) {
    return {
        ...defaultLocalSettings,
        ...raw,
        sync: normalizeSettingsSync(raw?.sync)
    };
}

function buildSettingsFirebasePayload(settings = localSettings) {
    const { sync, ...payload } = normalizeLocalSettings(settings);
    return payload;
}

let localSettings = normalizeLocalSettings(readJsonFile(LOCAL_SETTINGS_FILE, defaultLocalSettings));
let localSettingsDirty = localSettings.sync.settingsSynced === false;
writeJsonFile(LOCAL_SETTINGS_FILE, localSettings);

function normalizeTransactionSync(tx = {}) {
    const normalizedStatus = normalizeTransactionStatus(tx?.status);
    return {
        transactionSynced: tx?.sync?.transactionSynced !== undefined
            ? Boolean(tx.sync.transactionSynced)
            : Boolean(tx?.firebaseDocId),
        pickupSynced: tx?.sync?.pickupSynced !== undefined
            ? Boolean(tx.sync.pickupSynced)
            : normalizedStatus !== TRANSACTION_STATUS.COMPLETED,
        lastError: tx?.sync?.lastError || null
    };
}

function normalizeLocalTransaction(tx = {}) {
    const normalizedStatus = normalizeTransactionStatus(tx?.status);
    return {
        ...tx,
        type: normalizeLaundryType(tx?.type),
        status: normalizedStatus,
        laundryStatus: tx?.laundryStatus || (normalizedStatus === TRANSACTION_STATUS.PENDING ? 'Dropped' : tx?.laundryStatus),
        droppedAt: tx?.droppedAt ? new Date(tx.droppedAt) : (tx?.timestamp ? new Date(tx.timestamp) : new Date()),
        sync: normalizeTransactionSync({ ...tx, status: normalizedStatus })
    };
}

let localTransactions = readJsonFile(LOCAL_TRANSACTIONS_FILE, []).map((tx) => normalizeLocalTransaction(tx));
writeJsonFile(LOCAL_TRANSACTIONS_FILE, localTransactions);

function persistLocalTransactions() {
    localTransactions = localTransactions.map((tx) => normalizeLocalTransaction(tx));
    writeJsonFile(LOCAL_TRANSACTIONS_FILE, localTransactions);
}

function persistLocalSettings() {
    localSettings = normalizeLocalSettings(localSettings);
    localSettingsDirty = localSettings.sync.settingsSynced === false;
    writeJsonFile(LOCAL_SETTINGS_FILE, localSettings);
}

function enqueueLockerAction(lockerId, action) {
    const commands = readJsonFile(LOCKER_ACTIONS_FILE, []);
    commands.push({ lockerId: String(lockerId), action: action.toUpperCase(), ts: Date.now() });
    writeJsonFile(LOCKER_ACTIONS_FILE, commands);
}

function markLockerAvailableAndLock(lockerId) {
    const key = `l${lockerId}`;
    if (systemState[key]) {
        systemState[key].status = 'available';
        systemState[key].action = 'lock';
    }
    enqueueLockerAction(lockerId, 'lock');
}

function getActiveTransactionByLocker(lockerId) {
    return localTransactions.find((tx) => tx.lockerId === Number(lockerId) && tx.status === TRANSACTION_STATUS.PENDING);
}

function getLocalLockers() {
    return [1, 2, 3].map((id) => {
        const key = `l${id}`;
        const hardware = systemState[key] || {};
        const active = getActiveTransactionByLocker(id);
        return {
            id,
            capacity: '20 kg',
            status: active ? 'occupied' : 'available',
            weight: sanitizeWeight(active ? active.weight : hardware.weight),
            price: active?.price,
            pin: active?.pin,
            laundryStatus: active?.laundryStatus,
            doorStatus: hardware.door || 'CLOSED',
            isConnected: hardware.isConnected !== undefined ? hardware.isConnected : true,
            currentTransactionId: active?.transactionId
        };
    });
}

function getActiveLocalTransactionsById() {
    return localTransactions.reduce((acc, tx) => {
        if (tx.status !== TRANSACTION_STATUS.PENDING) return acc;

        const transactionId = tx.transactionId || tx.firebaseDocId;
        if (!transactionId) return acc;

        const mapped = {
            id: transactionId,
            transactionDocId: tx.firebaseDocId || transactionId,
            pinCode: String(tx.pinCode ?? tx.pin ?? '0000'),
            price: Number(tx.price || 0),
            weight: Number(tx.weight || 0),
            laundryType: tx.type || 'N/A',
            laundryStatus: tx.laundryStatus || 'Dropped',
            reminderSent: Boolean(tx.reminderSent),
        };

        acc[transactionId] = mapped;
        if (mapped.transactionDocId) {
            acc[mapped.transactionDocId] = mapped;
        }
        return acc;
    }, {});
}

function getAdminOverview() {
    const lockers = getLocalLockers()
        .filter((locker) => locker.isConnected !== false)
        .map((locker) => ({
            id: String(locker.id),
            lockerNumber: Number(locker.id),
            isLocked: systemState[`l${locker.id}`]?.action !== 'unlock',
            isConnected: locker.isConnected !== false,
            status: locker.status === 'occupied' ? 'occupied' : 'available',
            currentTransactionId: locker.currentTransactionId || undefined,
        }))
        .sort((a, b) => a.lockerNumber - b.lockerNumber);

    return {
        lockers,
        transactionsById: getActiveLocalTransactionsById(),
    };
}

function buildPrintPayloadFromTransaction(tx) {
    return {
        transactionId: tx.transactionId,
        pin: tx.pinCode ?? tx.pin,
        processType: tx.status === TRANSACTION_STATUS.COMPLETED ? 'pickup' : 'dropoff',
        weight: tx.weight,
        price: tx.price,
        type: tx.type,
        shopName: (localSettings.laundryShopName || 'Laundry Management System').toUpperCase(),
        receiptFootnote: localSettings.receiptFootnote || 'Thank you for using our service!',
    };
}

function processPendingLocalPrints() {
    let hasChanges = false;

    localTransactions.forEach((tx) => {
        if (!tx.triggerPrint) return;

        executePrintCommand(buildPrintPayloadFromTransaction(tx));
        tx.triggerPrint = false;
        tx.updatedAt = new Date();
        tx.sync = { ...tx.sync, transactionSynced: false, lastError: null };
        hasChanges = true;
    });

    if (hasChanges) {
        persistLocalTransactions();
    }
}

function findLocalTransaction(transactionId) {
    return localTransactions.find((tx) => tx.transactionId === transactionId || tx.firebaseDocId === transactionId);
}


// --- 1. HARDWARE WATCHER ---
function updateStateFromFile() {
    if (!fs.existsSync(STATE_FILE)) return;
    try {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const data = JSON.parse(raw);
        if (data.raw_data && data.raw_data.startsWith('DATA')) {
            const parts = data.raw_data.split('|');
            parts.forEach(part => {
                if (part.startsWith('L1:')) {
                    const d = part.split(':');
                    systemState.l1.weight = sanitizeWeight(d[1]);
                    systemState.l1.door = d[2];
                }
                if (part.startsWith('L2:')) {
                    const d = part.split(':');
                    systemState.l2.weight = sanitizeWeight(d[1]);
                    systemState.l2.door = d[2];
                }
                if (part.startsWith('L3:')) {
                    const d = part.split(':');
                    systemState.l3.weight = sanitizeWeight(d[1]);
                    systemState.l3.door = d[2];
                }
                if (part.startsWith('CREDIT:')) {
                    const d = part.split(':');
                    systemState.credit = parseFloat(d[1]) || 0.0;
                }
            });
            systemState.lastUpdated = data.timestamp;
        }
    } catch (err) {}
}
setInterval(updateStateFromFile, 200);

// ==========================================================
// INITIALIZATION & SETTINGS
// ==========================================================

// --- 2. AUTO-INITIALIZE SETTINGS (MERGED) ---
async function initializeSettings() {
    try {
        const generalRef = doc(db, "settings", "general");
        const generalSnap = await getDoc(generalRef);
        const defaultSettings = buildSettingsFirebasePayload(defaultLocalSettings);

        if (!generalSnap.exists()) {
            console.log("⚙️  Initializing 'settings/general' with default prices...");
            await setDoc(generalRef, defaultSettings);
        } else {
            const data = generalSnap.data();
            const updates = {};
            
            if (data.clothesPrice === undefined || data.clothesPrice === null) updates.clothesPrice = defaultSettings.clothesPrice;
            if (data.bedSheetPrice === undefined || data.bedSheetPrice === null) updates.bedSheetPrice = defaultSettings.bedSheetPrice;
            if (data.minClothesPrice === undefined || data.minClothesPrice === null) updates.minClothesPrice = defaultSettings.minClothesPrice;
            if (data.minBedSheetPrice === undefined || data.minBedSheetPrice === null) updates.minBedSheetPrice = defaultSettings.minBedSheetPrice;
            if (data.overdueHours === undefined || data.overdueHours === null) updates.overdueHours = defaultSettings.overdueHours;
            if (data.laundryShopName === undefined || data.laundryShopName === null || data.laundryShopName === '') updates.laundryShopName = defaultSettings.laundryShopName;
            if (data.receiptFootnote === undefined || data.receiptFootnote === null || data.receiptFootnote === '') updates.receiptFootnote = defaultSettings.receiptFootnote; 

            if (Object.keys(updates).length > 0) {
                 console.log("⚙️  Patching 'settings/general' with new merged fields...", updates);
                 await setDoc(generalRef, updates, { merge: true });
            }
        }
        
        console.log("✅ Settings verification complete.");
    } catch (error) {
        console.error("❌ Error initializing settings:", error);
    }
}

// --- 3. INITIALIZE LOCKERS ---
async function initializeLockers() {
  const lockers = ['1', '2', '3'];
  
  for (const id of lockers) {
    const ref = doc(db, "lockers", id);
    const snap = await getDoc(ref);
    
    if (!snap.exists()) {
      console.log(`[INIT] Creating default doc for Locker ${id}`);
      await setDoc(ref, {
        lockerId: id,
        action: 'lock',      
        status: 'available', 
        isConnected: true,
        adminCommand: null, 
        updatedAt: new Date()
      });
    } else {
      const data = snap.data();
      if (data.adminCommand === undefined) {
          await updateDoc(ref, { adminCommand: null });
      }
    }
  }
}

// --- 4. SETTINGS LISTENER ---
function startSettingsListener() {
    console.log("🎧 Listening to 'settings/general'...");

    startResilientSnapshotListener(doc(db, "settings", "general"), "settings/general", (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();

            const remoteUpdatedAt = data.updatedAt?.toDate ? data.updatedAt.toDate() : (data.updatedAt ? new Date(data.updatedAt) : null);
            const localUpdatedAt = localSettings.sync.updatedAt ? new Date(localSettings.sync.updatedAt) : null;

            if (localSettingsDirty && localUpdatedAt && (!remoteUpdatedAt || remoteUpdatedAt.getTime() < localUpdatedAt.getTime())) {
                console.log('[SETTINGS] Skipping older remote snapshot because local settings are pending sync.');
                return;
            }

            localSettings = normalizeLocalSettings({
                ...localSettings,
                laundryShopName: data.laundryShopName || localSettings.laundryShopName,
                clothesPrice: data.clothesPrice !== undefined ? data.clothesPrice : localSettings.clothesPrice,
                bedSheetPrice: data.bedSheetPrice !== undefined ? data.bedSheetPrice : localSettings.bedSheetPrice,
                minClothesPrice: data.minClothesPrice !== undefined ? data.minClothesPrice : localSettings.minClothesPrice,     
                minBedSheetPrice: data.minBedSheetPrice !== undefined ? data.minBedSheetPrice : localSettings.minBedSheetPrice,
                overdueHours: data.overdueHours !== undefined ? data.overdueHours : localSettings.overdueHours,
                receiptFootnote: data.receiptFootnote !== undefined ? data.receiptFootnote : localSettings.receiptFootnote,
                sync: {
                    settingsSynced: true,
                    lastError: null,
                    updatedAt: remoteUpdatedAt ? remoteUpdatedAt.toISOString() : localSettings.sync.updatedAt
                }
            });
            persistLocalSettings();

            if (data.overdueMinutes !== undefined && Number(data.overdueMinutes) > 0) {
                 const mins = Number(data.overdueMinutes);
                 SYSTEM_SETTINGS.overdueLimitMs = mins * 60 * 1000;
                 console.log(`[CONFIG] 🧪 TEST MODE: Timer set to ${mins} MINUTES`);
            }
            else if (data.overdueHours !== undefined) {
                const hours = Number(data.overdueHours);
                SYSTEM_SETTINGS.overdueLimitMs = hours * 60 * 60 * 1000;
                console.log(`[CONFIG] Timer updated to: ${hours} hours`);
            }
        }
    });
}

// ==========================================================
// ADMIN & OVERDUE RECOVERY SYSTEM
// ==========================================================

async function processOverdueReset(lockerId) {
    console.log(`[OVERDUE] Received database command to reset Locker ${lockerId}...`);
    try {
        const transRef = collection(db, "transactions");
        const q = query(
            transRef, 
            where("lockerId", "==", Number(lockerId)), 
            where("status", "in", [TRANSACTION_STATUS.PENDING])
        );
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const batchPromises = querySnapshot.docs.map(async (docSnapshot) => {
                const transData = docSnapshot.data();
                const overdueTransactionId = transData.transactionId || `OVERDUE-${docSnapshot.id}-${Date.now()}`;
                await setDoc(doc(db, "overdue_logs", overdueTransactionId), {
                    ...transData,
                    originalTransactionId: docSnapshot.id,
                    archivedAt: new Date(),
                    reason: "ADMIN_RESET",
                    note: "Triggered via Admin Database Command"
                }, { merge: true });
                await updateDoc(docSnapshot.ref, {
                    status: TRANSACTION_STATUS.ARCHIVED,
                    lockerId: null, 
                    archivedAt: new Date()
                });
            });
            await Promise.all(batchPromises);
        } 

        const lockerRef = doc(db, "lockers", String(lockerId));
        await updateDoc(lockerRef, {
            status: 'available',
            action: 'lock',
            currentTransactionId: null,
            adminCommand: null, 
            updatedAt: new Date()
        });
        console.log(`[OVERDUE] Locker ${lockerId} is now AVAILABLE.`);

    } catch (error) {
        console.error(`[OVERDUE ERROR] Locker ${lockerId}:`, error);
    }
}

function startOverdueListener() {
    console.log("🎧 Listening to 'overdue_logs'...");
    startResilientSnapshotListener(collection(db, "overdue_logs"), "overdue_logs", (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'modified') {
                const data = change.doc.data();
                if (data.status === TRANSACTION_STATUS.COMPLETED && data.originalTransactionId) {
                    try {
                        const originalTransRef = doc(db, "transactions", data.originalTransactionId);
                        await updateDoc(originalTransRef, {
                            status: TRANSACTION_STATUS.COMPLETED,
                            paymentStatus: 'paid',
                            resolvedAt: new Date(),
                            method: 'manual_overdue_resolution',
                            note: 'Transaction completed via Overdue Admin Panel'
                        });
                        console.log(`[OVERDUE SYNC] Original TRX ${data.originalTransactionId} updated.`);
                    } catch (error) {}
                }
            }
        });
    });
}

// ==========================================================
// AUTOMATED REMINDER SYSTEM
// ==========================================================

function startLaundryStatusListener() {
    console.log("🎧 Listening to 'transactions' for 'Done' status...");
    const q = query(collection(db, "transactions"), where("status", "==", TRANSACTION_STATUS.PENDING));
    startResilientSnapshotListener(q, "transactions(Pending)", (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            const data = change.doc.data();
            if (change.type === 'added' || change.type === 'modified') {
                if (data.laundryStatus === 'Done' && !data.doneAt) {
                    try {
                        await updateDoc(change.doc.ref, {
                            doneAt: new Date(), 
                            reminderSent: false,    
                            triggerReminder: false
                        });
                        
                        // 👇 ADD THIS: Update the locker to trigger the Python LED listener
                        if (data.lockerId) {
                            await updateDoc(doc(db, "lockers", String(data.lockerId)), {
                                laundryFinishedAt: new Date()
                            });
                        }
                        
                    } catch (e) {}
                }
            }
        });
    });
}

async function checkOverduePickups() {
    const currentLimitMs = SYSTEM_SETTINGS.overdueLimitMs;
    const now = new Date();
    let hasLocalUpdates = false;

    for (const tx of localTransactions) {
        if (tx.status !== TRANSACTION_STATUS.PENDING || tx.laundryStatus !== 'Done' || !tx.doneAt || tx.reminderSent) {
            continue;
        }

        const doneTime = tx.doneAt instanceof Date ? tx.doneAt : new Date(tx.doneAt);
        const diffMs = now.getTime() - doneTime.getTime();
        if (diffMs <= currentLimitMs) {
            continue;
        }

        console.log(`      ⚡ OVERDUE! Queueing reminder for TRX ${tx.transactionId || tx.firebaseDocId || 'N/A'}...`);
        tx.triggerReminder = true;
        tx.reminderSent = true;
        tx.reminderSentAt = now;
        tx.note = 'Auto-reminder sent after overdue.';
        tx.updatedAt = now;
        tx.sync = { ...tx.sync, transactionSynced: false, lastError: null };
        hasLocalUpdates = true;

        if (firebaseReady) {
            try {
                await syncTransactionToFirebase(tx);
            } catch (error) {
                console.error('⚠️ Failed to sync overdue reminder update. Queued for retry:', error);
            }
        }
    }

    if (hasLocalUpdates) {
        persistLocalTransactions();
    }
}
setInterval(checkOverduePickups, 30 * 1000);

// ==========================================================
// CORE LISTENERS
// ==========================================================

function startDatabaseListener() {
    console.log("🎧 Listening to 'lockers' collection...");
    startResilientSnapshotListener(collection(db, "lockers"), "lockers", (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            const id = change.doc.id; 
            const key = `l${id}`;
            if (data.adminCommand === 'RESET_OVERDUE') {
                processOverdueReset(id);
                return; 
            }
            if (systemState[key]) {
                systemState[key].status = data.status || 'available'; 
                systemState[key].action = data.action || 'lock';
                systemState[key].isConnected = (data.isConnected !== undefined) ? data.isConnected : true;
            }
        });
    });
}

function startPrinterListener() {
    const q = query(collection(db, "transactions"), where("triggerPrint", "==", true));
    startResilientSnapshotListener(q, "transactions(triggerPrint)", (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added' || change.type === 'modified') {
                const data = change.doc.data();
                const id = change.doc.id;
                
                let shopName = "CAJ LAUNDRY LOCKER CO.";
                let receiptFootnote = "Thank you!"; 
                
                try {
                    const generalSnap = await getDoc(doc(db, "settings", "general"));
                    if (generalSnap.exists()) {
                        if (generalSnap.data().laundryShopName) {
                            shopName = generalSnap.data().laundryShopName.toUpperCase();
                        }
                        if (generalSnap.data().receiptFootnote) {
                            receiptFootnote = generalSnap.data().receiptFootnote;
                        }
                    }
                } catch (e) {}

                const context = (data.status === TRANSACTION_STATUS.COMPLETED) ? 'pickup' : 'dropoff';
                const printPayload = {
                    transactionId: data.transactionId,
                    pin: data.pin,
                    processType: context,
                    weight: data.weight,
                    price: data.price,
                    type: data.type,
                    shopName: shopName,
                    receiptFootnote: receiptFootnote 
                };
                executePrintCommand(printPayload);
                try { await updateDoc(doc(db, "transactions", id), { triggerPrint: false }); } catch (e) {}
            }
        });
    });
}

// --- REMOTE ADMIN SYNC LISTENER ---
function startRemoteTransactionSyncListener() {
    console.log("🎧 Listening to 'transactions' for remote Admin changes...");
    
    startResilientSnapshotListener(collection(db, "transactions"), "transactions_sync", (snapshot) => {
        let hasChanges = false;
        
        snapshot.docChanges().forEach((change) => {
            // We only care if an existing transaction was modified or deleted remotely
            if (change.type === 'modified' || change.type === 'removed') {
                const remoteTx = change.doc.data();
                const docId = change.doc.id;
                const txId = remoteTx.transactionId || docId;
                
                // See if this transaction is actively tracked by the local kiosk
                const localIndex = localTransactions.findIndex(tx => 
                    tx.transactionId === txId || tx.firebaseDocId === docId
                );

                if (localIndex !== -1) {
                    const localTx = localTransactions[localIndex];
                    const remoteUpdatedAt = remoteTx.updatedAt?.toDate ? remoteTx.updatedAt.toDate() : (remoteTx.updatedAt ? new Date(remoteTx.updatedAt) : null);
                    const localUpdatedAt = localTx.updatedAt ? new Date(localTx.updatedAt) : null;
                    const hasPendingLocalSync = localTx.sync && (!localTx.sync.transactionSynced || !localTx.sync.pickupSynced);

                    if (hasPendingLocalSync && localUpdatedAt && (!remoteUpdatedAt || remoteUpdatedAt.getTime() < localUpdatedAt.getTime())) {
                        console.log(`[SYNC] ⏭️ Skipping older remote snapshot for TRX ${txId} because local changes are pending sync.`);
                        return;
                    }
                    
                    const normalizedRemoteStatus = normalizeTransactionStatus(remoteTx.status);

                    // If the Admin changed the status (e.g., forced completion/archive)
                    if (normalizedRemoteStatus !== localTx.status) {
                        console.log(`[SYNC] 📥 Admin remotely changed TRX ${txId} status to: ${normalizedRemoteStatus}`);
                        
                        // Update the local database
                        localTransactions[localIndex] = normalizeLocalTransaction({ 
                            ...localTx, 
                            ...remoteTx,
                            status: normalizedRemoteStatus,
                            sync: { ...localTx.sync, transactionSynced: true, lastError: null } 
                        });
                        hasChanges = true;
                        
                        // If it's no longer pending, free up the physical locker on the UI!
                        if ([TRANSACTION_STATUS.COMPLETED, TRANSACTION_STATUS.ARCHIVED].includes(normalizedRemoteStatus)) {
                            const lockerKey = `l${localTx.lockerId}`;
                            if (systemState[lockerKey] && systemState[lockerKey].status === 'occupied') {
                                markLockerAvailableAndLock(localTx.lockerId);
                                console.log(`[SYNC] 🔓 Locker ${localTx.lockerId} forcefully marked as available.`);
                            }
                        }
                    } 
                    // Or if the Admin just updated the price, weight, or laundry status
                    else if (
                        remoteTx.price !== localTx.price || 
                        remoteTx.weight !== localTx.weight ||
                        remoteTx.laundryStatus !== localTx.laundryStatus ||
                        remoteTx.triggerReminder !== localTx.triggerReminder ||
                        remoteTx.reminderSent !== localTx.reminderSent ||
                        remoteTx.doneSmsSent !== localTx.doneSmsSent ||
                        toMillis(remoteTx.doneAt) !== toMillis(localTx.doneAt) ||
                        toMillis(remoteTx.reminderSentAt) !== toMillis(localTx.reminderSentAt)
                    ) {
                         console.log(`[SYNC] 📥 Admin remotely updated details for TRX ${txId}`);
                         localTransactions[localIndex] = normalizeLocalTransaction({ 
                             ...localTx, 
                             ...remoteTx, 
                             sync: { ...localTx.sync, transactionSynced: true, lastError: null } 
                         });
                         hasChanges = true;
                    }
                }
            }
        });

        // Save changes to the JSON file so they persist if the kiosk reboots
        if (hasChanges) {
            persistLocalTransactions();
        }
    });
}

function executePrintCommand(data) {
    // Dynamically find the printer port
    const printerPorts = ['/dev/usb/lp0', '/dev/usb/lp1', '/dev/usb/lp2'];
    const PRINTER_PATH = printerPorts.find(p => fs.existsSync(p));

    if (!PRINTER_PATH) {
        console.error("❌ No USB Printer detected in /dev/usb/");
        return;
    }

    // Extract receiptFootnote here
    const { transactionId, pin, processType, weight, price, shopName, receiptFootnote } = data;
    
    // We use actual empty lines at the bottom to feed the paper
    const receiptText = `
   ${shopName}
   --------------------------
   Date: ${new Date().toLocaleString()}
   Trans #: ${transactionId}
   Service: ${processType.toUpperCase()}
   --------------------------
   Weight: ${Number(weight).toFixed(2)} kg
   Price:  PHP ${Number(price).toFixed(2)}
   --------------------------
   ${processType === 'dropoff' ? `PIN: ${pin}` : 'Status: PAID'}
   --------------------------
   ${receiptFootnote || 'Thank you!'}



`;

    // 🚀 Use Node.js native file system to write directly to the printer
    fs.writeFile(PRINTER_PATH, receiptText, (error) => {
        if (error) {
            console.error("Printer Error:", error);
        } else {
            console.log(`📝 Printed directly to ${PRINTER_PATH}`);
        }
    });
}

// ==========================================================
// STARTUP
// ==========================================================

async function syncTransactionToFirebase(tx) {
    if (tx.sync?.transactionSynced) return;
    if (!firebaseReady) {
        throw new Error('Firebase unavailable. Transaction queued for retry.');
    }

    const payload = { ...tx };
    delete payload.sync;
    delete payload.firebaseDocId;
    payload.status = normalizeTransactionStatus(payload.status);
    payload.type = normalizeLaundryType(payload.type);
    if (payload.droppedAt) payload.droppedAt = new Date(payload.droppedAt);
    delete payload.timestamp;
    delete payload.archivedFromLockerId;
    const transactionDocId = tx.transactionId || tx.firebaseDocId;

    if (!transactionDocId) {
        throw new Error('Missing transactionId for Firebase setDoc transaction sync.');
    }

    try {
        // 1. Save the transaction itself
        await setDoc(doc(db, 'transactions', transactionDocId), payload, { merge: true });
        
        // 2. NEW: Update the locker document to show it is occupied by this transaction
        if (payload.status === TRANSACTION_STATUS.PENDING) {
             await setDoc(doc(db, 'lockers', String(tx.lockerId)), {
                 status: 'occupied',
                 currentTransactionId: transactionDocId,
                 updatedAt: new Date()
             }, { merge: true });
        }

        if (payload.status === TRANSACTION_STATUS.ARCHIVED && tx.archivedFromLockerId) {
            await setDoc(doc(db, 'lockers', String(tx.archivedFromLockerId)), {
                status: 'available',
                action: 'lock',
                currentTransactionId: null,
                updatedAt: new Date(),
                adminCommand: null
            }, { merge: true });
        }

        tx.firebaseDocId = transactionDocId;
        tx.sync = { ...tx.sync, transactionSynced: true, lastError: null };
        persistLocalTransactions();
    } catch (error) {
        tx.sync = { ...tx.sync, lastError: String(error?.message || error) };
        persistLocalTransactions();
        throw error;
    }
}

async function syncPickupToFirebase(tx) {
    if (tx.sync?.pickupSynced) return;
    if (!firebaseReady) {
        throw new Error('Firebase unavailable. Pickup sync queued for retry.');
    }

    try {
        // 1. Mark transaction as completed
        if (tx.firebaseDocId) {
            await updateDoc(doc(db, 'transactions', tx.firebaseDocId), {
                status: TRANSACTION_STATUS.COMPLETED,
                pickedUpAt: new Date(tx.pickedUpAt || Date.now()),
                paymentId: tx.paymentId,
                triggerPrint: Boolean(tx.triggerPrint)
            });
        } else {
            const q = query(
                collection(db, 'transactions'),
                where('lockerId', '==', Number(tx.lockerId)),
                where('status', '==', TRANSACTION_STATUS.PENDING)
            );

            const snapshot = await getDocs(q);
            const updates = snapshot.docs.map((remoteTx) => updateDoc(doc(db, 'transactions', remoteTx.id), {
                status: TRANSACTION_STATUS.COMPLETED,
                pickedUpAt: new Date(tx.pickedUpAt || Date.now()),
                paymentId: tx.paymentId,
                triggerPrint: Boolean(tx.triggerPrint)
            }));
            await Promise.all(updates);
        }

        // 2. Keep locker open for customer pickup; lock is triggered after Thank You timeout.
        await updateDoc(doc(db, 'lockers', String(tx.lockerId)), {
            status: 'available',
            action: 'unlock',
            currentTransactionId: null,
            updatedAt: new Date()
        });

        tx.sync = { ...tx.sync, pickupSynced: true, lastError: null };
        persistLocalTransactions();
    } catch (error) {
        tx.sync = { ...tx.sync, lastError: String(error?.message || error) };
        persistLocalTransactions();
        throw error;
    }
}

async function syncLocalSettingsToFirebase() {
    if (localSettings.sync?.settingsSynced) return;
    if (!firebaseReady) {
        throw new Error('Firebase unavailable. Settings queued for retry.');
    }

    try {
        const payload = buildSettingsFirebasePayload(localSettings);
        payload.updatedAt = new Date(localSettings.sync.updatedAt || Date.now());
        await setDoc(doc(db, 'settings', 'general'), payload, { merge: true });

        localSettings = normalizeLocalSettings({
            ...localSettings,
            sync: {
                settingsSynced: true,
                lastError: null,
                updatedAt: payload.updatedAt.toISOString()
            }
        });
        persistLocalSettings();
    } catch (error) {
        localSettings = normalizeLocalSettings({
            ...localSettings,
            sync: {
                ...localSettings.sync,
                settingsSynced: false,
                lastError: String(error?.message || error),
                updatedAt: localSettings.sync.updatedAt || new Date().toISOString()
            }
        });
        persistLocalSettings();
        throw error;
    }
}

async function reconcileLocalTransactions() {
    for (const tx of localTransactions) {
        try {
            await syncTransactionToFirebase(tx);
            if (tx.status === TRANSACTION_STATUS.COMPLETED) {
                await syncPickupToFirebase(tx);
            }
        } catch (error) {
            // Keep local-first behavior; retry on next interval
        }
    }

    try {
        await syncLocalSettingsToFirebase();
    } catch (error) {
        // Keep local-first behavior; retry on next interval
    }
}

async function bootstrapFirebaseServices() {
    if (firebaseBootstrapped) return;

    firebaseBootstrapped = true;
    await initializeSettings();
    await initializeLockers();
    startDatabaseListener();
    startSettingsListener();
    startPrinterListener();
    startLaundryStatusListener();
    startOverdueListener();
    startRemoteTransactionSyncListener();
    checkOverduePickups();
}

async function connectFirebaseAuth() {
    try {
        await signInAnonymously(auth);
        firebaseReady = true;

        if (authRetryTimer) {
            clearTimeout(authRetryTimer);
            authRetryTimer = null;
        }

        console.log('✅ [FIREBASE] Authenticated');
        await bootstrapFirebaseServices();
        await syncLocalSettingsToFirebase();
        await reconcileLocalTransactions();
    } catch (error) {
        firebaseReady = false;
        console.error('⚠️ [FIREBASE] Running in offline-first mode:', error?.message || error);

        if (!authRetryTimer) {
            authRetryTimer = setTimeout(() => {
                authRetryTimer = null;
                console.log('🔁 [FIREBASE] Retrying anonymous auth...');
                connectFirebaseAuth();
            }, 15000);
        }
    }
}

connectFirebaseAuth();

// ==========================================================
// API ENDPOINTS
// ==========================================================

app.get('/api/status', (req, res) => res.json(systemState));
app.get('/api/lockers', (req, res) => res.json(getLocalLockers()));
app.get('/api/settings', (req, res) => res.json(localSettings));
app.get('/api/admin/overview', (req, res) => res.json(getAdminOverview()));
app.post('/api/settings', async (req, res) => {
    const toNumber = (value, fallback) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const updatedAt = new Date().toISOString();
    localSettings = normalizeLocalSettings({
        ...localSettings,
        laundryShopName: typeof req.body.laundryShopName === 'string' && req.body.laundryShopName.trim()
            ? req.body.laundryShopName.trim()
            : localSettings.laundryShopName,
        clothesPrice: toNumber(req.body.clothesPrice, localSettings.clothesPrice),
        bedSheetPrice: toNumber(req.body.bedSheetPrice, localSettings.bedSheetPrice),
        minClothesPrice: toNumber(req.body.minClothesPrice, localSettings.minClothesPrice),
        minBedSheetPrice: toNumber(req.body.minBedSheetPrice, localSettings.minBedSheetPrice),
        overdueHours: toNumber(req.body.overdueHours, localSettings.overdueHours),
        receiptFootnote: typeof req.body.receiptFootnote === 'string'
            ? req.body.receiptFootnote
            : localSettings.receiptFootnote,
        sync: {
            settingsSynced: false,
            lastError: null,
            updatedAt
        }
    });

    persistLocalSettings();
    SYSTEM_SETTINGS.overdueLimitMs = Number(localSettings.overdueHours) * 60 * 60 * 1000;

    if (!firebaseReady) {
        localSettings = normalizeLocalSettings({
            ...localSettings,
            sync: {
                ...localSettings.sync,
                settingsSynced: false,
                lastError: 'Firebase unavailable',
                updatedAt
            }
        });
        persistLocalSettings();
        return res.json({ success: true, settings: localSettings, syncedToFirebase: false });
    }

    try {
        await syncLocalSettingsToFirebase();
        return res.json({ success: true, settings: localSettings, syncedToFirebase: localSettings.sync.settingsSynced });
    } catch (error) {
        console.error('⚠️ Failed to sync settings to Firebase:', error);
        return res.json({ success: true, settings: localSettings, syncedToFirebase: localSettings.sync.settingsSynced });
    }
});
app.post('/api/admin/transaction/status', async (req, res) => {
    const { transactionId, laundryStatus } = req.body;
    const tx = findLocalTransaction(transactionId);

    if (!tx || tx.status !== TRANSACTION_STATUS.PENDING) {
        return res.status(404).json({ success: false, message: 'Active transaction not found.' });
    }

    tx.laundryStatus = laundryStatus;
    tx.updatedAt = new Date();
    tx.sync = { ...tx.sync, transactionSynced: false, lastError: null };

    if (laundryStatus === 'Done') {
        tx.doneAt = new Date();
        tx.reminderSent = false;
        tx.triggerReminder = false;
        tx.reminderSentAt = null;
        tx.doneSmsSent = false;
    } else {
        tx.doneAt = null;
        tx.reminderSent = false;
        tx.triggerReminder = false;
        tx.reminderSentAt = null;
        tx.doneSmsSent = false;
    }

    persistLocalTransactions();

    try {
        await syncTransactionToFirebase(tx);
    } catch (error) {
        console.error('⚠️ Failed to sync local transaction status to Firebase. Queued for retry:', error);
    }

    res.json({ success: true, overview: getAdminOverview() });
});

app.post('/api/admin/transaction/reset', async (req, res) => {
    const { lockerId, transactionId } = req.body;
    const tx = findLocalTransaction(transactionId);

    if (!tx) {
        return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }

    tx.status = TRANSACTION_STATUS.ARCHIVED;
    tx.archivedFromLockerId = Number(lockerId);
    tx.lockerId = null;
    tx.archivedAt = new Date();
    tx.note = 'Archived by local admin reset';
    tx.updatedAt = new Date();
    tx.sync = { ...tx.sync, transactionSynced: false, lastError: null };
    persistLocalTransactions();

    markLockerAvailableAndLock(lockerId);

    try {
        await syncTransactionToFirebase(tx);
    } catch (error) {
        console.error('⚠️ Failed to sync local reset to Firebase. Queued for retry:', error);
    }

    res.json({ success: true, overview: getAdminOverview() });
});

app.post('/api/admin/transaction/print', (req, res) => {
    const { transactionId } = req.body;
    const tx = findLocalTransaction(transactionId);

    if (!tx) {
        return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }

    executePrintCommand({
        transactionId: tx.transactionId,
        pin: tx.pinCode ?? tx.pin,
        processType: tx.status === TRANSACTION_STATUS.COMPLETED ? 'pickup' : 'dropoff',
        weight: tx.weight,
        price: tx.price,
        type: tx.type,
        shopName: localSettings.laundryShopName || 'Laundry Management System',
        receiptFootnote: localSettings.receiptFootnote || 'Thank you for using our service!',
    });

    res.json({ success: true });
});

app.post('/api/dropoff', (req, res) => {
    const payload = {
        ...req.body,
        status: TRANSACTION_STATUS.PENDING,
        laundryStatus: req.body.laundryStatus || 'Dropped',
        type: normalizeLaundryType(req.body.type),
        droppedAt: req.body.droppedAt ? new Date(req.body.droppedAt) : new Date()
    };

    const key = `l${payload.lockerId}`;
    if (systemState[key]) {
        systemState[key].status = 'occupied';
    }

    const savedTx = normalizeLocalTransaction({
        ...payload,
        updatedAt: payload.droppedAt,
        sync: { transactionSynced: false, pickupSynced: true, lastError: null }
    });
    localTransactions.push(savedTx);
    persistLocalTransactions();
    processPendingLocalPrints();

    syncTransactionToFirebase(savedTx).catch(() => {
        console.error('⚠️ Transaction queued for Firebase retry.');
    });

    res.json({ success: true });
});

app.post('/api/pickup', (req, res) => {
    const { lockerId, paymentId } = req.body;
    const lockerKey = `l${lockerId}`;
    if (systemState[lockerKey]) {
        systemState[lockerKey].status = 'available';
        systemState[lockerKey].action = 'unlock';
    }

    localTransactions = localTransactions.map((tx) => {
        if (tx.lockerId === Number(lockerId) && tx.status === TRANSACTION_STATUS.PENDING) {
            return normalizeLocalTransaction({
                ...tx,
                status: TRANSACTION_STATUS.COMPLETED,
                pickedUpAt: new Date(),
                paymentId,
                triggerPrint: true,
                updatedAt: new Date(),
                sync: { ...tx.sync, transactionSynced: false, pickupSynced: false, lastError: null }
            });
        }
        return tx;
    });
    persistLocalTransactions();
    processPendingLocalPrints();

    const completedTransactions = localTransactions.filter((tx) =>
        tx.lockerId === Number(lockerId) &&
        tx.status === TRANSACTION_STATUS.COMPLETED &&
        !tx.sync?.pickupSynced
    );

    completedTransactions.forEach((completedTx) => {
        syncTransactionToFirebase(completedTx)
            .catch(() => {
                console.error('⚠️ Transaction completion queued for Firebase retry.');
            })
            .finally(() => {
                syncPickupToFirebase(completedTx).catch(() => {
                    console.error('⚠️ Pickup sync queued for Firebase retry.');
                });
            });
    });

    res.json({ success: true });
});

app.post('/api/unlock', (req, res) => {
    const { lockerId } = req.body;
    enqueueLockerAction(lockerId, 'unlock');

    if (firebaseReady) {
        setDoc(doc(db, 'lockers', String(lockerId)), { action: 'unlock', updatedAt: new Date() }, { merge: true }).catch((error) => {
            console.error('⚠️ Remote unlock command not sent to Firebase:', error);
        });
    }

    res.json({ success: true });
});

app.post('/api/lock', (req, res) => {
    const { lockerId } = req.body;
    enqueueLockerAction(lockerId, 'lock');

    if (firebaseReady) {
        setDoc(doc(db, 'lockers', String(lockerId)), { action: 'lock', updatedAt: new Date() }, { merge: true }).catch((error) => {
            console.error('⚠️ Remote lock command not sent to Firebase:', error);
        });
    }

    res.json({ success: true });
});

setInterval(() => {
    reconcileLocalTransactions().catch(() => {});
}, 30 * 1000);

app.listen(3000, () => console.log('🚀 Server running on 3000'));
