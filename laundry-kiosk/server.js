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
  addDoc,       
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

// --- 2. AUTO-INITIALIZE SETTINGS (MERGED) ---
// Now forces prices into 'settings/general'
async function initializeSettings() {
    try {
        const generalRef = doc(db, "settings", "general");
        const generalSnap = await getDoc(generalRef);

        const defaultSettings = {
            laundryShopName: "CAJ Laundry Locker System",
            overdueHours: 48,
            clothesPrice: 25,    // Merged price
            bedSheetPrice: 40    // Merged price
        };

        if (!generalSnap.exists()) {
            console.log("⚙️  Initializing 'settings/general' with default prices...");
            await setDoc(generalRef, defaultSettings);
        } else {
            // Patch missing fields if they don't exist
            const data = generalSnap.data();
            const updates = {};
            
            if (data.clothesPrice === undefined) updates.clothesPrice = defaultSettings.clothesPrice;
            if (data.bedSheetPrice === undefined) updates.bedSheetPrice = defaultSettings.bedSheetPrice;
            if (data.overdueHours === undefined) updates.overdueHours = defaultSettings.overdueHours;
            if (data.laundryShopName === undefined) updates.laundryShopName = defaultSettings.laundryShopName;

            if (Object.keys(updates).length > 0) {
                 console.log("⚙️  Patching 'settings/general' with new merged fields...", updates);
                 await setDoc(generalRef, updates, { merge: true });
            }
        }
        
        console.log("✅ Settings verification complete (General + Pricing merged).");
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
        timestamp: new Date()
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
    
    onSnapshot(doc(db, "settings", "general"), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // Timer Settings
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
            where("status", "in", ["paid_pending", "processing", "occupied"])
        );
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const batchPromises = querySnapshot.docs.map(async (docSnapshot) => {
                const transData = docSnapshot.data();
                await addDoc(collection(db, "overdue_logs"), {
                    ...transData,
                    originalTransactionId: docSnapshot.id,
                    archivedAt: new Date(),
                    reason: "ADMIN_RESET",
                    note: "Triggered via Admin Database Command"
                });
                await updateDoc(docSnapshot.ref, {
                    status: 'overdue_archived',
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
            timestamp: new Date()
        });
        console.log(`[OVERDUE] Locker ${lockerId} is now AVAILABLE.`);

    } catch (error) {
        console.error(`[OVERDUE ERROR] Locker ${lockerId}:`, error);
    }
}

function startOverdueListener() {
    console.log("🎧 Listening to 'overdue_logs'...");
    onSnapshot(collection(db, "overdue_logs"), (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'modified') {
                const data = change.doc.data();
                if (data.status === 'completed' && data.originalTransactionId) {
                    try {
                        const originalTransRef = doc(db, "transactions", data.originalTransactionId);
                        await updateDoc(originalTransRef, {
                            status: 'completed',
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
    const q = query(collection(db, "transactions"), where("status", "==", "paid_pending"));
    onSnapshot(q, (snapshot) => {
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
    try {
        const q = query(
            collection(db, "transactions"), 
            where("status", "==", "paid_pending"),
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
    onSnapshot(collection(db, "lockers"), (snapshot) => {
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
    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added' || change.type === 'modified') {
                const data = change.doc.data();
                const id = change.doc.id;
                
                let shopName = "CAJ LAUNDRY LOCKER CO.";
                try {
                    const generalSnap = await getDoc(doc(db, "settings", "general"));
                    if (generalSnap.exists() && generalSnap.data().laundryShopName) {
                        shopName = generalSnap.data().laundryShopName.toUpperCase();
                    }
                } catch (e) {}

                const context = (data.status === 'completed') ? 'pickup' : 'dropoff';
                const printPayload = {
                    transactionId: data.transactionId,
                    pin: data.pin,
                    processType: context,
                    weight: data.weight,
                    price: data.price,
                    type: data.type,
                    shopName: shopName
                };
                executePrintCommand(printPayload);
                try { await updateDoc(doc(db, "transactions", id), { triggerPrint: false }); } catch (e) {}
            }
        });
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

    const { transactionId, pin, processType, weight, price, shopName } = data;
    
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
   Thank you!



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

signInAnonymously(auth).then(async () => {
    console.log("✅ [FIREBASE] Authenticated");
    await initializeSettings();
    await initializeLockers();
    startDatabaseListener();      
    startSettingsListener();      
    startPrinterListener();       
    startLaundryStatusListener(); 
    startOverdueListener();       
    checkOverduePickups(); 
});

// ==========================================================
// API ENDPOINTS (Local & Offline Control)
// ==========================================================

app.get('/api/status', (req, res) => res.json(systemState));

// Local Unlock Command
app.post('/api/unlock', async (req, res) => {
    const { lockerId } = req.body;
    
    // 1. Instantly update local state for hardware to open NOW
    const key = `l${lockerId}`;
    if (systemState[key]) {
        systemState[key].action = 'unlock';
    }

    // 2. Try to update Firebase so the Admin app knows (caches if offline)
    try {
        await setDoc(doc(db, "lockers", String(lockerId)), { action: 'unlock', timestamp: new Date() }, { merge: true });
    } catch (e) {
        console.log("Offline: Unlock synced to cache, will upload later.");
    }
    
    res.json({ success: true });
});

// Local Lock Command
app.post('/api/lock', async (req, res) => {
    const { lockerId } = req.body;
    
    // 1. Instantly update local state for hardware to lock NOW
    const key = `l${lockerId}`;
    if (systemState[key]) {
        systemState[key].action = 'lock';
    }

    // 2. Try to update Firebase so the Admin app knows (caches if offline)
    try {
        await setDoc(doc(db, "lockers", String(lockerId)), { action: 'lock', timestamp: new Date() }, { merge: true });
    } catch (e) {
        console.log("Offline: Lock synced to cache, will upload later.");
    }

    res.json({ success: true });
});

// Local Print Command
app.post('/api/print', async (req, res) => {
    try {
        const data = req.body;
        
        let shopName = "CAJ LAUNDRY LOCKER CO.";
        try {
            const generalSnap = await getDoc(doc(db, "settings", "general"));
            if (generalSnap.exists() && generalSnap.data().laundryShopName) {
                shopName = generalSnap.data().laundryShopName.toUpperCase();
            }
        } catch (e) {
            console.log("⚠️ Offline: Using default shop name for receipt.");
        }

        data.shopName = shopName;
        executePrintCommand(data); // Calls your existing print function
        
        res.json({ success: true });
    } catch (error) {
        console.error("❌ Print API Error:", error);
        res.status(500).json({ error: "Failed to print" });
    }
});

app.listen(3000, () => console.log('🚀 Server running on 3000 with Hybrid Cloud/Local Control'));