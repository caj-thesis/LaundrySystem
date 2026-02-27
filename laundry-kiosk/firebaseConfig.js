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

  apiKey: "AIzaSyCbRscvsw2FwgzdShLytikbb7Sw51ioLs4",

  authDomain: "laundrymanagementsystem-609a2.firebaseapp.com",

  projectId: "laundrymanagementsystem-609a2",

  storageBucket: "laundrymanagementsystem-609a2.firebasestorage.app",

  messagingSenderId: "614368527448",

  appId: "1:614368527448:web:1c59583754b6a47c3a762d",

  measurementId: "G-GYJKLMT5Q7"

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
