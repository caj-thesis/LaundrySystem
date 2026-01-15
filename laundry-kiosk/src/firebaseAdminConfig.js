// Import Admin SDK functions
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "module";

// Helper to load JSON file in ES Modules
const require = createRequire(import.meta.url);

// LOAD THE KEY FILE
// Ensure 'serviceAccountKey.json' is in the same folder as this file
const serviceAccount = require("./serviceAccountKey.json");

// Initialize Firebase Admin with full privileges
const app = initializeApp({
  credential: cert(serviceAccount)
});

export const db = getFirestore(app);