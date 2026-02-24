import { initializeApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyARrGx7wbz8ZPPIxmG8hoMcLCwtjdzjr8w",
  authDomain: "caj-laundry-management-49191.firebaseapp.com",
  projectId: "caj-laundry-management-49191",
  storageBucket: "caj-laundry-management-49191.firebasestorage.app",
  messagingSenderId: "82008219104",
  appId: "1:82008219104:web:96ae4d2453248270899f85",
  measurementId: "G-HD7R1PKYLK"
};

const app = initializeApp(firebaseConfig);

function getFirestoreCacheModeForRuntime(runtime = globalThis) {
  const runtimeWindow = runtime?.window;
  if (!runtimeWindow) return "node";

  const hasIndexedDb = typeof runtimeWindow.indexedDB !== "undefined";
  if (!hasIndexedDb) return "memory";

  try {
    const storage = runtimeWindow.localStorage;
    if (!storage) return "memory";

    // Accessing length is enough to trigger security errors in restricted kiosk sessions.
    void storage.length;
    return "persistent";
  } catch {
    return "memory";
  }
}

function createBrowserDb() {
  const cacheMode = getFirestoreCacheModeForRuntime();

  if (cacheMode !== "persistent") {
    return initializeFirestore(app, { localCache: memoryLocalCache() });
  }

  return initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
}

// Node runtime (server.js) uses default Firestore client.
// Browser runtime chooses persistent cache only when browser storage APIs are available.
export const db = getFirestoreCacheModeForRuntime() === "node" ? getFirestore(app) : createBrowserDb();

export const auth = getAuth(app);
