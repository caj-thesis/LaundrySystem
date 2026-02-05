import { exec } from 'child_process';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- FIREBASE IMPORTS ---
import { db, auth } from './firebaseConfig.js'; 
import { doc, setDoc, getDoc, collection, onSnapshot } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth"; 

const app = express();
app.use(cors());
app.use(express.json());

const STATE_FILE = 'sys_state.json';

// --- LOCAL STATE CONTAINER (Added L3) ---
let systemState = {
  l1: { door: 'CLOSED', weight: 0.0, status: 'available', action: 'lock', isConnected: true }, 
  l2: { door: 'CLOSED', weight: 0.0, status: 'available', action: 'lock', isConnected: true },
  l3: { door: 'CLOSED', weight: 0.0, status: 'available', action: 'lock', isConnected: true }, // <--- ADDED
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
                // L1 Logic
                if (part.startsWith('L1:')) {
                    const d = part.split(':');
                    systemState.l1.weight = parseFloat(d[1]) || 0;
                    systemState.l1.door = d[2];
                }
                // L2 Logic
                if (part.startsWith('L2:')) {
                    const d = part.split(':');
                    systemState.l2.weight = parseFloat(d[1]) || 0;
                    systemState.l2.door = d[2];
                }
                // L3 Logic (THIS WAS MISSING)
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

// --- 2. DATABASE LISTENER ---
function startDatabaseListener() {
    console.log("🎧 Listening to 'lockers' collection...");
    
    onSnapshot(collection(db, "lockers"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            const id = change.doc.id; // "1", "2", or "3"
            const key = `l${id}`;

            if (systemState[key]) {
                systemState[key].status = data.status || 'available'; 
                systemState[key].action = data.action || 'lock';
                systemState[key].isConnected = (data.isConnected !== undefined) ? data.isConnected : true;

                // console.log(`[SYNC] Locker ${id}: ${systemState[key].status.toUpperCase()}`);
            }
        });
    });
}

// --- INITIALIZE LOCKERS ---
async function initializeLockers() {
  const lockers = ['1', '2', '3']; // <--- ADDED '3' HERE
  
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
        timestamp: new Date()
      });
    }
  }
}

// --- AUTH & STARTUP ---
signInAnonymously(auth).then(async () => {
    console.log("✅ [FIREBASE] Authenticated");
    await initializeLockers();   
    startDatabaseListener();     
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