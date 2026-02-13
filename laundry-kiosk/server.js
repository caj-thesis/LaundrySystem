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

// --- 2. DATABASE LISTENER ---
function startDatabaseListener() {
    console.log("🎧 Listening to 'lockers' collection...");
    onSnapshot(collection(db, "lockers"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            const id = change.doc.id; 
            const key = `l${id}`;
            
            // Handle Admin Overdue Reset
            if (data.adminCommand === 'RESET_OVERDUE') {
                processOverdueReset(id); // (Helper function assumed to be same as before)
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

// --- 3. PRINTER LISTENER (With Toggle Check) ---
function startPrinterListener() {
    console.log("🎧 Listening to 'transactions' for print jobs...");

    // Listen for transactions where triggerPrint is TRUE
    const q = query(collection(db, "transactions"), where("triggerPrint", "==", true));

    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added' || change.type === 'modified') {
                const data = change.doc.data();
                const id = change.doc.id;
                
                console.log(`🖨️  Print Trigger Detected: ${id}`);

                // 1. CHECK ADMIN TOGGLE
                let isPrintEnabled = true;
                try {
                    const settingsSnap = await getDoc(doc(db, "settings", "printer"));
                    if (settingsSnap.exists()) {
                        // If 'enabled' is false, we disable printing. Default is true.
                        if (settingsSnap.data().enabled === false) isPrintEnabled = false;
                    }
                } catch (e) {
                    console.error("Error reading printer settings:", e);
                }

                // 2. EXECUTE OR SKIP
                if (isPrintEnabled) {
                    const context = (data.status === 'completed') ? 'pickup' : 'dropoff';
                    const printPayload = {
                        transactionId: data.transactionId,
                        pin: data.pin,
                        processType: context,
                        weight: data.weight,
                        price: data.price,
                        type: data.type
                    };
                    executePrintCommand(printPayload);
                } else {
                    console.log("🚫 Printing Skipped (Disabled by Admin)");
                }

                // 3. RESET TRIGGER (Always do this to prevent loops)
                try {
                   await updateDoc(doc(db, "transactions", id), {
                       triggerPrint: false
                   });
                } catch (e) {
                   console.error("Error resetting triggerPrint:", e);
                }
            }
        });
    });
}

// --- HELPER: EXECUTE PRINT ---
function executePrintCommand(data) {
  const { transactionId, pin, processType, weight, price, type } = data;
  
  const receiptText = `
      CAJ LAUNDRY LOCKER CO.
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
    startDatabaseListener();
    startPrinterListener(); // <--- This handles printing now
    // startOverdueListener(); // Uncomment if you have the overdue listener function
});

// --- API ENDPOINTS (Legacy support only) ---
app.get('/api/status', (req, res) => res.json(systemState));
app.post('/api/unlock', async (req, res) => {
    // ... same unlock logic ...
    const { lockerId } = req.body;
    await setDoc(doc(db, "lockers", String(lockerId)), { action: 'unlock', timestamp: new Date() }, { merge: true });
    res.json({ success: true });
});
app.post('/api/lock', async (req, res) => {
    // ... same lock logic ...
    const { lockerId } = req.body;
    await setDoc(doc(db, "lockers", String(lockerId)), { action: 'lock', timestamp: new Date() }, { merge: true });
    res.json({ success: true });
});

app.listen(3000, () => console.log('🚀 Server running on 3000'));