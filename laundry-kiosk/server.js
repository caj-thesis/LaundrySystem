import { exec } from 'child_process';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- FIREBASE IMPORTS ---
import { db, auth } from './firebaseConfig.js'; 
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth"; 

// --- PATH SETUP ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// --- STATE STORAGE ---
// This is now synced from Firebase so the UI stays updated
let systemState = {
  l1: { door: 'CLOSED', weight: 0.0 }, 
  l2: { door: 'CLOSED', weight: 0.0 },
  credit: 0.0
};

// --- AUTHENTICATION & SYNC ---
signInAnonymously(auth).then(() => {
  console.log("✅ Authenticated to Firebase");
  
  // Listen to Firebase for hardware updates from the Python Bridge
  onSnapshot(doc(db, "kiosks", "main_unit"), (doc) => {
    if (doc.exists()) {
      const data = doc.data();
      // Parsing the raw_data string sent by the Python script
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
          if (part.startsWith('CREDIT:')) {
            systemState.credit = parseFloat(part.split(':')[1]) || 0;
          }
        });
      }
    }
  });
}).catch((error) => console.error("Firebase Auth Error:", error.message));

// --- API ENDPOINTS ---

// Get current status for React UI
app.get('/api/status', (req, res) => res.json(systemState));

// Modified Unlock: Now writes a command to Firebase for Python to execute
app.post('/api/unlock', async (req, res) => {
  const { lockerId } = req.body;
  try {
    await setDoc(doc(db, "commands", "latest"), {
      action: 'unlock',
      lockerId: lockerId,
      timestamp: new Date()
    });
    console.log(`[FIREBASE] Sent unlock command for Locker ${lockerId}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Modified Lock: Writes a command to Firebase
app.post('/api/lock', async (req, res) => {
  const { lockerId } = req.body;
  try {
    await setDoc(doc(db, "commands", "latest"), {
      action: 'lock',
      lockerId: lockerId,
      timestamp: new Date()
    });
    console.log(`[FIREBASE] Sent lock command for Locker ${lockerId}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Receipt Printing Logic (Stays in Node.js)
app.post('/api/print', (req, res) => {
  const { transactionId, pin, processType, weight, price } = req.body;

  const receiptText = `
      CAJ LAUNDRY LOCKER CO.
   --------------------------
   Date: ${new Date().toLocaleString()}
   Trans #: ${transactionId || 'N/A'}
   Service: ${processType.toUpperCase()}
   --------------------------
   Weight: ${Number(weight).toFixed(2)} kg
   Price:  PHP ${Number(price).toFixed(2)}
   --------------------------
   ${processType === 'dropoff' 
     ? `YOUR PIN: ${pin}\\n   Keep this PIN safe!` 
     : `Status: PAID\\n   Locker is now open`
   }
   --------------------------
   Thank you for using our
    Laundry Locker Service!
  `;

  exec(`printf "${receiptText}" > /dev/usb/lp0`, (error) => {
    if (error) return res.status(500).json({ success: false });
    res.json({ success: true });
  });
});

app.listen(3000, () => console.log('🚀 Server running on port 3000 (Hardware handled via Python)'));