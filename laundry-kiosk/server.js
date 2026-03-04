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
const SMS_QUEUE_FILE = 'sms_queue.json'; // 🚀 NEW: SMS Queue File

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

// 🚀 NEW: Local SMS Queuing Function
function enqueueSMS(phone, message) {
    if (!phone) return;
    const queue = readJsonFile(SMS_QUEUE_FILE, []);
    queue.push({ phone, message, ts: Date.now() });
    writeJsonFile(SMS_QUEUE_FILE, queue);
    console.log(`[SMS QUEUE] Queued message for ${phone}`);
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

let localSettings = readJsonFile(LOCAL_SETTINGS_FILE, {
    laundryShopName: 'CAJ Laundry Locker System',
    clothesPrice: 25,
    bedSheetPrice: 40,
    minClothesPrice: 50,
    minBedSheetPrice: 50,
    receiptFootnote: 'Thank you for using our service!'
});
writeJsonFile(LOCAL_SETTINGS_FILE, localSettings);

let localTransactions = readJsonFile(LOCAL_TRANSACTIONS_FILE, []).map((tx) => {
    const normalizedStatus = normalizeTransactionStatus(tx?.status);
    return {
        ...tx,
        type: normalizeLaundryType(tx?.type),
        status: normalizedStatus,
        droppedAt: tx?.droppedAt ? new Date(tx.droppedAt) : (tx?.timestamp ? new Date(tx.timestamp) : new Date()),
        sync: {
            transactionSynced: Boolean(tx?.sync?.transactionSynced || tx?.firebaseDocId),
            pickupSynced: Boolean(tx?.sync?.pickupSynced || normalizedStatus === TRANSACTION_STATUS.COMPLETED),
            lastError: tx?.sync?.lastError || null
        }
    };
});
writeJsonFile(LOCAL_TRANSACTIONS_FILE, localTransactions);

function persistLocalTransactions() {
    writeJsonFile(LOCAL_TRANSACTIONS_FILE, localTransactions);
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
            weight: active ? active.weight : (hardware.weight || 0),
            price: active?.price,
            pin: active?.pin,
            laundryStatus: active?.laundryStatus,
            doorStatus: hardware.door || 'CLOSED',
            isConnected: hardware.isConnected !== undefined ? hardware.isConnected : true,
            currentTransactionId: active?.transactionId
        };
    });
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
                    systemState.l1.weight = parseFloat(d[1]) || 0;
                    systemState.l1.door = d[2];
                }
                if (part.startsWith('L2:')) {
                    const d = part.split(':');
                    systemState.l2.weight = parseFloat(d[1]) || 0;
                    systemState.l2.door = d[2];
                }
                if (part.startsWith('L3:')) {
                    const d = part.split(':');
                    systemState.l3.weight = parseFloat(d[1]) || 0;
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

async function initializeSettings() {
    try {
        const generalRef = doc(db, "settings", "general");
        const generalSnap = await getDoc(generalRef);

        const defaultSettings = {
            laundryShopName: "CAJ Laundry Locker System",
            overdueHours: 48,
            clothesPrice: 25,  
            bedSheetPrice: 40,
            minClothesPrice: 50,   
            minBedSheetPrice: 50,
            receiptFootnote: "Thank you for using our service!" 
        };

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

function startSettingsListener() {
    console.log("🎧 Listening to 'settings/general'...");

    startResilientSnapshotListener(doc(db, "settings", "general"), "settings/general", (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();

            localSettings = {
                ...localSettings,
                laundryShopName: data.laundryShopName || localSettings.laundryShopName,
                clothesPrice: data.clothesPrice !== undefined ? data.clothesPrice : localSettings.clothesPrice,
                bedSheetPrice: data.bedSheetPrice !== undefined ? data.bedSheetPrice : localSettings.bedSheetPrice,
                minClothesPrice: data.minClothesPrice !== undefined ? data.minClothesPrice : localSettings.minClothesPrice,     
                minBedSheetPrice: data.minBedSheetPrice !== undefined ? data.minBedSheetPrice : localSettings.minBedSheetPrice,
                receiptFootnote: data.receiptFootnote !== undefined ? data.receiptFootnote : localSettings.receiptFootnote
            };
            writeJsonFile(LOCAL_SETTINGS_FILE, localSettings);

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
    try {
        const q = query(
            collection(db, "transactions"), 
            where("status", "==", TRANSACTION_STATUS.PENDING),
            where("laundryStatus", "==", "Done")
        );
        const snapshot = await getDocs(q);
        snapshot.forEach(async (docSnap) => {
            const data = docSnap.data();
            if (data.doneAt) {
                const doneTime = data.doneAt.toDate();
                const diffMs = now.getTime() - doneTime.getTime();
                if (!data.reminderSent && diffMs > currentLimitMs) {
                    console.log(`      ⚡ OVERDUE! Sending reminder...`);
                    
                    // 🚀 NEW: Queue overdue SMS locally
                    const smsMsg = `${localSettings.laundryShopName || 'CAJ LAUNDRY LOCKER CO.'}
                    OVERDUE REMINDER: Your laundry is ready for pickup.
                    Ref: ${data.transactionId || docSnap.id}
                    Please claim it as soon as possible.`;
                    enqueueSMS(data.phoneNumber, smsMsg);

                    await updateDoc(docSnap.ref, {
                        triggerReminder: true,  
                        reminderSent: true,     
                        reminderSentAt: new Date(),
                        note: `Auto-reminder sent after overdue.`
                    });
                }
            }
        });
    } catch (error) {}
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
    console.log("🎧 Listening to 'transactions' for remote Admin print commands...");
    const q = query(collection(db, "transactions"), where("triggerPrint", "==", true));
    
    startResilientSnapshotListener(q, "transactions(triggerPrint)", (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added' || change.type === 'modified') {
                const data = change.doc.data();
                const id = change.doc.id;
                
                let shopName = localSettings.laundryShopName || "CAJ LAUNDRY LOCKER CO.";
                let receiptFootnote = localSettings.receiptFootnote || "Thank you!"; 

                const context = (data.status === TRANSACTION_STATUS.COMPLETED) ? 'pickup' : 'dropoff';
                
                // Print locally
                executePrintCommand({
                    transactionId: data.transactionId || id,
                    pin: data.pin || 'N/A',
                    processType: context,
                    weight: data.weight || 0,
                    price: data.price || 0,
                    type: data.type || 'N/A',
                    shopName: shopName,
                    receiptFootnote: receiptFootnote 
                });

                // Immediately turn the flag off in Firebase so it doesn't print again
                try { 
                    await updateDoc(doc(db, "transactions", id), { triggerPrint: false }); 
                } catch (e) {}
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
            if (change.type === 'modified' || change.type === 'removed') {
                const remoteTx = change.doc.data();
                const docId = change.doc.id;
                const txId = remoteTx.transactionId || docId;
                
                const localIndex = localTransactions.findIndex(tx => 
                    tx.transactionId === txId || tx.firebaseDocId === docId
                );

                if (localIndex !== -1) {
                    const localTx = localTransactions[localIndex];
                    const normalizedRemoteStatus = normalizeTransactionStatus(remoteTx.status);

                    if (normalizedRemoteStatus !== localTx.status) {
                        console.log(`[SYNC] 📥 Admin remotely changed TRX ${txId} status to: ${normalizedRemoteStatus}`);
                        localTransactions[localIndex] = { 
                            ...localTx, 
                            ...remoteTx,
                            status: normalizedRemoteStatus,
                            sync: { ...localTx.sync, transactionSynced: true } 
                        };
                        hasChanges = true;
                        
                        if ([TRANSACTION_STATUS.COMPLETED, TRANSACTION_STATUS.ARCHIVED].includes(normalizedRemoteStatus)) {
                            const lockerKey = `l${localTx.lockerId}`;
                            if (systemState[lockerKey] && systemState[lockerKey].status === 'occupied') {
                                markLockerAvailableAndLock(localTx.lockerId);
                                console.log(`[SYNC] 🔓 Locker ${localTx.lockerId} forcefully marked as available.`);
                            }
                        }
                    } 
                    else if (
                        remoteTx.price !== localTx.price || 
                        remoteTx.weight !== localTx.weight ||
                        remoteTx.laundryStatus !== localTx.laundryStatus
                    ) {
                         console.log(`[SYNC] 📥 Admin remotely updated details for TRX ${txId}`);
                         
                         // 🚀 NEW: Trigger Ready SMS and LED if Admin marked 'Done'
                         if (remoteTx.laundryStatus === 'Done' && localTx.laundryStatus !== 'Done') {
                             const smsMsg = `${localSettings.laundryShopName || 'CAJ LAUNDRY LOCKER CO.'}
                            Date: ${new Date().toLocaleString()}
                            Trans #: ${txId}
                            Service: READY FOR PICKUP
                            ----------------
                            Status: WASHING COMPLETE
                            Please proceed to payment.`;
                             enqueueSMS(remoteTx.phoneNumber, smsMsg);
                             enqueueLockerAction(localTx.lockerId, 'LED_YELLOW'); // Update LED locally
                         }

                         localTransactions[localIndex] = { 
                             ...localTx, 
                             ...remoteTx, 
                             sync: { ...localTx.sync, transactionSynced: true } 
                         };
                         hasChanges = true;
                    }
                }
            }
        });

        if (hasChanges) persistLocalTransactions();
    });
}

function executePrintCommand(data) {
    const printerPorts = ['/dev/usb/lp0', '/dev/usb/lp1', '/dev/usb/lp2'];
    const PRINTER_PATH = printerPorts.find(p => fs.existsSync(p));

    if (!PRINTER_PATH) {
        console.error("❌ No USB Printer detected in /dev/usb/");
        return;
    }

    const { transactionId, pin, processType, weight, price, shopName, receiptFootnote } = data;
    
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
    if (!firebaseReady) throw new Error('Firebase unavailable. Transaction queued for retry.');

    const payload = { ...tx };
    delete payload.sync;
    delete payload.firebaseDocId;
    payload.status = normalizeTransactionStatus(payload.status);
    payload.type = normalizeLaundryType(payload.type);
    if (payload.droppedAt) payload.droppedAt = new Date(payload.droppedAt);
    delete payload.timestamp;
    const transactionDocId = tx.transactionId || tx.firebaseDocId;

    if (!transactionDocId) throw new Error('Missing transactionId for Firebase setDoc transaction sync.');

    try {
        await setDoc(doc(db, 'transactions', transactionDocId), payload, { merge: true });
        if (payload.status === TRANSACTION_STATUS.PENDING) {
             await setDoc(doc(db, 'lockers', String(tx.lockerId)), {
                 status: 'occupied',
                 currentTransactionId: transactionDocId,
                 updatedAt: new Date()
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
    if (!firebaseReady) throw new Error('Firebase unavailable. Pickup sync queued for retry.');

    try {
        if (tx.firebaseDocId) {
            await updateDoc(doc(db, 'transactions', tx.firebaseDocId), {
                status: TRANSACTION_STATUS.COMPLETED,
                pickedUpAt: new Date(tx.pickedUpAt || Date.now()),
                paymentId: tx.paymentId
                // triggerPrint: true // ❌ REMOVED so it doesn't double-print on reconnect
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
                paymentId: tx.paymentId
                // triggerPrint: true // ❌ REMOVED
            }));
            await Promise.all(updates);
        }

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

async function reconcileLocalTransactions() {
    for (const tx of localTransactions) {
        try {
            await syncTransactionToFirebase(tx);
            if (tx.status === TRANSACTION_STATUS.COMPLETED) await syncPickupToFirebase(tx);
        } catch (error) { }
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
        if (authRetryTimer) { clearTimeout(authRetryTimer); authRetryTimer = null; }
        console.log('✅ [FIREBASE] Authenticated');
        await bootstrapFirebaseServices();
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

// 🚀 NEW: Standalone Print Endpoint (Called by React UI when payment completes)
app.post('/api/print-receipt', (req, res) => {
    const { lockerUnit, weight, totalDue, date } = req.body;
    
    executePrintCommand({
        transactionId: `TX-${Date.now()}`, 
        pin: 'PAID', 
        processType: 'pickup',
        weight: weight,
        price: totalDue,
        shopName: localSettings.laundryShopName || "CAJ LAUNDRY LOCKER CO.",
        receiptFootnote: localSettings.receiptFootnote || "Thank you!"
    });

    res.json({ success: true });
});

app.post('/api/dropoff', (req, res) => {
    const payload = {
        ...req.body,
        status: TRANSACTION_STATUS.PENDING,
        type: normalizeLaundryType(req.body.type),
        droppedAt: req.body.droppedAt ? new Date(req.body.droppedAt) : new Date()
    };

    const key = `l${payload.lockerId}`;
    if (systemState[key]) {
        systemState[key].status = 'occupied';
    }

    // 🚀 NEW: IMMEDIATELY LOCK AND TURN LED RED LOCALLY
    enqueueLockerAction(payload.lockerId, 'lock');
    enqueueLockerAction(payload.lockerId, 'LED_RED');

    // 🚀 NEW: IMMEDIATELY PRINT DROPOFF RECEIPT LOCALLY
    executePrintCommand({
        transactionId: payload.transactionId || `TX-${Date.now()}`,
        pin: payload.pin || 'N/A',
        processType: 'dropoff',
        weight: payload.weight,
        price: payload.price,
        type: payload.type,
        shopName: localSettings.laundryShopName || "CAJ LAUNDRY LOCKER CO.",
        receiptFootnote: localSettings.receiptFootnote || "Thank you!"
    });

    // 🚀 NEW: IMMEDIATELY QUEUE LOCAL SMS
    if (payload.phoneNumber) {
        const smsMsg = `${localSettings.laundryShopName || 'CAJ LAUNDRY LOCKER CO.'}
        Date: ${new Date().toLocaleString()}
        Trans #: ${payload.transactionId}
        Service: DROPOFF
        Weight: ${Number(payload.weight).toFixed(2)} kg
        Price: PHP ${Number(payload.price).toFixed(2)}
        ----------------
        PIN: ${payload.pin}
        Keep this PIN safe!`;
        enqueueSMS(payload.phoneNumber, smsMsg);
    }

    const savedTx = { ...payload, sync: { transactionSynced: false, pickupSynced: false, lastError: null } };
    localTransactions.push(savedTx);
    persistLocalTransactions();

    syncTransactionToFirebase(savedTx).catch(() => {
        console.error('⚠️ Transaction queued for Firebase retry.');
    });

    res.json({ success: true });
});

app.post('/api/pickup', (req, res) => {
    const { lockerId, paymentId } = req.body;

    // 🚀 NEW: IMMEDIATELY UNLOCK AND TURN LED GREEN LOCALLY
    enqueueLockerAction(lockerId, 'unlock');
    enqueueLockerAction(lockerId, 'LED_GREEN');

    localTransactions = localTransactions.map((tx) => {
        if (tx.lockerId === Number(lockerId) && tx.status === TRANSACTION_STATUS.PENDING) {
            return {
                ...tx,
                status: TRANSACTION_STATUS.COMPLETED,
                pickedUpAt: new Date(),
                paymentId,
                sync: { ...tx.sync, pickupSynced: false }
            };
        }
        return tx;
    });
    persistLocalTransactions();

    const completedTransactions = localTransactions.filter((tx) =>
        tx.lockerId === Number(lockerId) &&
        tx.status === TRANSACTION_STATUS.COMPLETED &&
        !tx.sync?.pickupSynced
    );

    completedTransactions.forEach((completedTx) => {
        syncPickupToFirebase(completedTx).catch(() => {
            console.error('⚠️ Pickup sync queued for Firebase retry.');
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