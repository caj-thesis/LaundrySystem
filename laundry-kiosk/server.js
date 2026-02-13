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

// --- 2. AUTO-INITIALIZE SETTINGS ---
async function initializeSettings() {
    try {
        const generalRef = doc(db, "settings", "general");
        const generalSnap = await getDoc(generalRef);

        if (!generalSnap.exists()) {
            console.log("⚙️  Initializing 'settings/general'...");
            await setDoc(generalRef, {
                laundryShopName: "CAJ Laundry Locker System",
                overdueHours: 48
            });
        } else {
            if (generalSnap.data().overdueHours === undefined) {
                await setDoc(generalRef, { overdueHours: 48 }, { merge: true });
            }
        }

        const pricingRef = doc(db, "settings", "pricing");
        const pricingSnap = await getDoc(pricingRef);

        if (!pricingSnap.exists()) {
            await setDoc(pricingRef, { clothesPrice: 25, bedSheetPrice: 40 });
        }
        
        console.log("✅ Settings verification complete.");
    } catch (error) {
        console.error("❌ Error initializing settings:", error);
    }
}

// --- 3. SETTINGS LISTENER (Dynamic Timer) ---
function startSettingsListener() {
    console.log("🎧 Listening to 'settings/general'...");
    
    onSnapshot(doc(db, "settings", "general"), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // 1. Check 'overdueMinutes' (Testing Priority)
            if (data.overdueMinutes !== undefined && Number(data.overdueMinutes) > 0) {
                 const mins = Number(data.overdueMinutes);
                 SYSTEM_SETTINGS.overdueLimitMs = mins * 60 * 1000;
                 console.log(`[CONFIG] 🧪 TEST MODE: Timer set to ${mins} MINUTES`);
            } 
            // 2. Check 'overdueHours' (Default)
            else if (data.overdueHours !== undefined) {
                const hours = Number(data.overdueHours);
                SYSTEM_SETTINGS.overdueLimitMs = hours * 60 * 60 * 1000;
                console.log(`[CONFIG] Timer updated to: ${hours} hours`);
            }
        }
    });
}

// ==========================================================
// NEW FEATURE: DYNAMIC REMINDER SYSTEM (Debugged)
// ==========================================================

// --- 4. LAUNDRY STATUS LISTENER ---
function startLaundryStatusListener() {
    console.log("🎧 Listening to 'transactions' for 'Done' status...");
    
    const q = query(collection(db, "transactions"), where("status", "==", "paid_pending"));

    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            const data = change.doc.data();
            
            // FIX: Listen to 'added' events too! 
            // This catches items that are ALREADY 'Done' when server starts.
            if (change.type === 'added' || change.type === 'modified') {
                if (data.laundryStatus === 'Done') {
                    // Only update if 'doneAt' is missing
                    if (!data.doneAt) {
                        console.log(`[STATUS] Found DONE transaction ${data.transactionId} without timestamp. Fixing...`);
                        try {
                            await updateDoc(change.doc.ref, {
                                doneAt: new Date(), 
                                reminderSent: false,    
                                triggerReminder: false
                            });
                        } catch (e) {
                            console.error("Error setting doneAt:", e);
                        }
                    }
                }
            }
        });
    });
}

// --- 5. OVERDUE POLLER (With Debug Logs) ---
async function checkOverduePickups() {
    const currentLimitMs = SYSTEM_SETTINGS.overdueLimitMs;
    const now = new Date();

    // Debug Log to confirm what the server sees as the limit
    const limitMins = (currentLimitMs / 60000).toFixed(1);
    console.log(`\n⏰ [POLL] Checking for overdue items (Limit: ${limitMins} mins)...`);

    try {
        const q = query(
            collection(db, "transactions"), 
            where("status", "==", "paid_pending"),
            where("laundryStatus", "==", "Done")
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            console.log("   -> No active 'Done' transactions found.");
        }

        snapshot.forEach(async (docSnap) => {
            const data = docSnap.data();

            if (data.doneAt) {
                const doneTime = data.doneAt.toDate();
                const diffMs = now.getTime() - doneTime.getTime();
                const diffMins = (diffMs / 60000).toFixed(2);

                if (!data.reminderSent) {
                    console.log(`   -> TRX ${data.transactionId}: ${diffMins} mins elapsed / Target: ${limitMins} mins`);
                    
                    // CHECK: Time passed?
                    if (diffMs > currentLimitMs) {
                        console.log(`      ⚡ OVERDUE! Sending reminder...`);

                        await updateDoc(docSnap.ref, {
                            triggerReminder: true,  
                            reminderSent: true,     
                            reminderSentAt: new Date(),
                            note: `Auto-reminder sent after ${limitMins} mins.`
                        });
                        console.log(`      ✅ Reminder Sent Flag Updated.`);
                    }
                } else {
                    // console.log(`   -> TRX ${data.transactionId}: Reminder already sent.`);
                }
            } else {
                console.log(`   -> TRX ${data.transactionId}: 'Done' but missing 'doneAt' timestamp (Waiting for Listener fix...)`);
            }
        });
    } catch (error) {
        console.error("Error checking overdue pickups:", error);
    }
}

// Run check every 30 seconds for faster testing
setInterval(checkOverduePickups, 30 * 1000);

// ==========================================================

// --- 6. DATABASE LISTENER (Lockers) ---
function startDatabaseListener() {
    console.log("🎧 Listening to 'lockers' collection...");
    onSnapshot(collection(db, "lockers"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            const id = change.doc.id; 
            const key = `l${id}`;
            
            if (data.adminCommand === 'RESET_OVERDUE') return; 

            if (systemState[key]) {
                systemState[key].status = data.status || 'available'; 
                systemState[key].action = data.action || 'lock';
                systemState[key].isConnected = (data.isConnected !== undefined) ? data.isConnected : true;
            }
        });
    });
}

// --- 7. PRINTER LISTENER ---
function startPrinterListener() {
    console.log("🎧 Listening to 'transactions' for print jobs...");
    const q = query(collection(db, "transactions"), where("triggerPrint", "==", true));

    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added' || change.type === 'modified') {
                const data = change.doc.data();
                const id = change.doc.id;
                console.log(`🖨️  Print Trigger Detected: ${id}`);

                let isPrintEnabled = true;
                let shopName = "CAJ LAUNDRY LOCKER CO.";
                try {
                    const printerSnap = await getDoc(doc(db, "settings", "printer"));
                    if (printerSnap.exists() && printerSnap.data().enabled === false) isPrintEnabled = false;
                    const generalSnap = await getDoc(doc(db, "settings", "general"));
                    if (generalSnap.exists() && generalSnap.data().laundryShopName) shopName = generalSnap.data().laundryShopName.toUpperCase();
                } catch (e) {}

                if (isPrintEnabled) {
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
                } else {
                    console.log("🚫 Printing Skipped");
                }
                try { await updateDoc(doc(db, "transactions", id), { triggerPrint: false }); } catch (e) {}
            }
        });
    });
}

// --- HELPER: EXECUTE PRINT ---
function executePrintCommand(data) {
  const { transactionId, pin, processType, weight, price, type, shopName } = data;
  const receiptText = `
      ${shopName || "CAJ LAUNDRY LOCKER CO."}
   --------------------------
   Date: ${new Date().toLocaleString()}
   Trans #: ${transactionId || 'N/A'}
   Service: ${processType ? processType.toUpperCase() : 'SERVICE'}
   Type: ${type || 'Standard'}
   --------------------------
   Weight: ${Number(weight).toFixed(2)} kg
   Price:  PHP ${Number(price).toFixed(2)}
   --------------------------
   ${processType === 'dropoff' 
     ? `YOUR PIN: ${pin}\\n   Keep this PIN safe!` 
     : `Status: PAID\\n   Locker is now open`
   }
   --------------------------
   Thank you!
  `;

  exec(`printf "${receiptText}" > /dev/usb/lp0`, (error) => {
    if (error) console.error("❌ Printer Error:", error);
    else console.log("✅ Print job sent");
  });
}

// --- AUTH & STARTUP ---
signInAnonymously(auth).then(async () => {
    console.log("✅ [FIREBASE] Authenticated");
    await initializeSettings();

    startDatabaseListener();
    startSettingsListener(); 
    startPrinterListener(); 
    startLaundryStatusListener();
    
    checkOverduePickups(); 
});

// --- API ENDPOINTS ---
app.get('/api/status', (req, res) => res.json(systemState));
app.post('/api/unlock', async (req, res) => {
    const { lockerId } = req.body;
    await setDoc(doc(db, "lockers", String(lockerId)), { action: 'unlock', timestamp: new Date() }, { merge: true });
    res.json({ success: true });
});
app.post('/api/lock', async (req, res) => {
    const { lockerId } = req.body;
    await setDoc(doc(db, "lockers", String(lockerId)), { action: 'lock', timestamp: new Date() }, { merge: true });
    res.json({ success: true });
});

app.listen(3000, () => console.log('🚀 Server running on 3000'));