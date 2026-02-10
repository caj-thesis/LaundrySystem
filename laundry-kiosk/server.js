//
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

// --- 1. HARDWARE WATCHER (Reads Local File) ---
console.log(`👀 Watching local file: ${STATE_FILE}`);

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
    } catch (err) {
        // Ignore read errors
    }
}

setInterval(updateStateFromFile, 200);

// --- HELPER: PROCESS OVERDUE RESET ---
async function processOverdueReset(lockerId) {
    console.log(`[OVERDUE] Received database command to reset Locker ${lockerId}...`);

    try {
        // 1. Find and Archive the Active Transaction
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
            console.log(`[OVERDUE] Archived transaction(s) for Locker ${lockerId}`);
        } else {
            console.log(`[OVERDUE] No active transaction found for Locker ${lockerId}, proceeding to reset.`);
        }

        // 2. Reset the Locker & Reset the Command to NULL (Persist Field)
        const lockerRef = doc(db, "lockers", String(lockerId));
        await updateDoc(lockerRef, {
            status: 'available',
            action: 'lock',
            currentTransactionId: null,
            // CRITICAL FIX: Set to null instead of deleting it
            adminCommand: null, 
            timestamp: new Date()
        });

        console.log(`[OVERDUE] Locker ${lockerId} is now AVAILABLE.`);

    } catch (error) {
        console.error(`[OVERDUE ERROR] Locker ${lockerId}:`, error);
    }
}

// --- 2. DATABASE LISTENER ---
function startDatabaseListener() {
    console.log("🎧 Listening to 'lockers' collection...");
    
    onSnapshot(collection(db, "lockers"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            const id = change.doc.id; 
            const key = `l${id}`;

            // --- CHECK FOR ADMIN COMMANDS ---
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

// --- 3. OVERDUE LOGS LISTENER (Sync 'completed' status back to Transactions) ---
function startOverdueListener() {
    console.log("🎧 Listening to 'overdue_logs' collection...");
    
    onSnapshot(collection(db, "overdue_logs"), (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            // We only care if an existing log was modified (e.g., status changed to completed)
            if (change.type === 'modified') {
                const data = change.doc.data();
                
                // Check if the status is now 'completed' (paid behind the scenes)
                if (data.status === 'completed' && data.originalTransactionId) {
                    console.log(`[OVERDUE SYNC] Overdue Log ${change.doc.id} marked as COMPLETED.`);
                    
                    try {
                        const originalTransRef = doc(db, "transactions", data.originalTransactionId);
                        
                        // Update the original transaction to reflect the payment/completion
                        await updateDoc(originalTransRef, {
                            status: 'completed',
                            paymentStatus: 'paid', // Explicitly mark as paid
                            resolvedAt: new Date(),
                            method: 'manual_overdue_resolution',
                            note: 'Transaction completed via Overdue Admin Panel'
                        });

                        console.log(`[OVERDUE SYNC] Original Transaction ${data.originalTransactionId} updated to 'completed'.`);
                    } catch (error) {
                        console.error(`[OVERDUE SYNC ERROR] Could not update transaction ${data.originalTransactionId}:`, error);
                    }
                }
            }
        });
    });
}

// --- INITIALIZE LOCKERS ---
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
      // --- FIX: PATCH EXISTING LOCKERS ---
      const data = snap.data();
      if (data.adminCommand === undefined) {
          console.log(`[INIT] Patching Locker ${id}: Adding 'adminCommand' field...`);
          await updateDoc(ref, { 
              adminCommand: null 
          });
      }
    }
  }
}

// --- AUTH & STARTUP ---
signInAnonymously(auth).then(async () => {
    console.log("✅ [FIREBASE] Authenticated");
    await initializeLockers();   
    startDatabaseListener();
    startOverdueListener();     
});

// --- API ENDPOINTS ---
app.get('/api/status', (req, res) => res.json(systemState));

app.post('/api/unlock', async (req, res) => {
  const { lockerId, status } = req.body; 
  try {
    const updateData = {
      action: 'unlock',
      lockerId: lockerId,
      timestamp: new Date()
    };
    if (status) updateData.status = status;
    await setDoc(doc(db, "lockers", String(lockerId)), updateData, { merge: true });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/lock', async (req, res) => {
  const { lockerId, status } = req.body;
  try {
    const updateData = {
      action: 'lock',
      lockerId: lockerId,
      timestamp: new Date()
    };
    if (status) updateData.status = status; 
    await setDoc(doc(db, "lockers", String(lockerId)), updateData, { merge: true });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/print', (req, res) => {
  const { transactionId, pin, processType, weight, price } = req.body;
  const receiptText = `
      CAJ LAUNDRY LOCKER CO.
   --------------------------
   Date: ${new Date().toLocaleString()}
   Trans #: ${transactionId || 'N/A'}
   Service: ${processType ? processType.toUpperCase() : 'SERVICE'}
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
    if (error) {
        console.error("Printer Error:", error);
        return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
});

app.listen(3000, () => console.log('🚀 Server running on 3000'));