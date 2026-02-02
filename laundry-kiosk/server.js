import { exec } from 'child_process';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- FIREBASE IMPORTS ---
import { db, auth } from './firebaseConfig.js'; 
import { doc, setDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth"; 

const app = express();
app.use(cors());
app.use(express.json());

const STATE_FILE = 'sys_state.json';

// --- LOCAL STATE CONTAINER ---
let systemState = {
  l1: { door: 'CLOSED', weight: 0.0 }, 
  l2: { door: 'CLOSED', weight: 0.0 },
  credit: 0.0,
  lastUpdated: 0
};

// --- FILE WATCHER (Replaces Firebase Read) ---
console.log(`👀 Watching local file: ${STATE_FILE}`);

function updateStateFromFile() {
    if (!fs.existsSync(STATE_FILE)) return;

    try {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const data = JSON.parse(raw);
        
        if (data.raw_data && data.raw_data.startsWith('DATA')) {
            // Expected: DATA|L1:5.2:OPEN|L2:0.0:CLOSED
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
            });
            systemState.lastUpdated = data.timestamp;
        }
    } catch (err) {
        // Ignore read errors (collision with python writing)
    }
}

// Poll file every 200ms (Fast & Free)
setInterval(updateStateFromFile, 200);

// --- AUTH (For Sending Commands) ---
signInAnonymously(auth).then(() => console.log("✅ [FIREBASE] Ready for commands"));

// --- API ENDPOINTS ---

// 1. Get Status (Reads from Local Memory)
app.get('/api/status', (req, res) => res.json(systemState));

// 2. Unlock (Writes to Firebase)
app.post('/api/unlock', async (req, res) => {
  const { lockerId } = req.body;
  try {
    // Write to Firebase -> Python detects this -> Arduino unlocks
    await setDoc(doc(db, "commands", "latest"), {
      action: 'unlock',
      lockerId: lockerId,
      timestamp: new Date()
    });
    console.log(`[REMOTE] Sent unlock command for Locker ${lockerId}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Lock (Writes to Firebase)
app.post('/api/lock', async (req, res) => {
  const { lockerId } = req.body;
  try {
    await setDoc(doc(db, "commands", "latest"), {
      action: 'lock',
      lockerId: lockerId,
      timestamp: new Date()
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Print (Local)
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

  // Direct print to USB printer
  exec(`printf "${receiptText}" > /dev/usb/lp0`, (error) => {
    if (error) {
        console.error("Printer Error:", error);
        return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
});

app.listen(3000, () => console.log('🚀 Server running on 3000 (Hybrid Mode)'));