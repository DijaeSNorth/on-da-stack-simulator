import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  appId: string;
}

let warnedMissingFirebaseConfig = false;
let cachedDatabase: Database | null = null;

function env(name: string): string {
  return ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name] ?? '').trim();
}

export function getFirebaseClientConfig(): FirebaseClientConfig | null {
  const config = {
    apiKey: env('VITE_FIREBASE_API_KEY'),
    authDomain: env('VITE_FIREBASE_AUTH_DOMAIN'),
    databaseURL: env('VITE_FIREBASE_DATABASE_URL') || env('VITE_FIREBASE_RTDB_URL'),
    projectId: env('VITE_FIREBASE_PROJECT_ID'),
    appId: env('VITE_FIREBASE_APP_ID'),
  };
  const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    if (((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ?? false) && !warnedMissingFirebaseConfig) {
      warnedMissingFirebaseConfig = true;
      console.warn('[firebase] multiplayer recovery disabled; missing VITE_FIREBASE_* config', { missing });
    }
    return null;
  }
  return config;
}

export function isFirebaseRecoveryConfigured(): boolean {
  return getFirebaseClientConfig() !== null;
}

export function getFirebaseDatabase(): Database | null {
  if (cachedDatabase) return cachedDatabase;
  const config = getFirebaseClientConfig();
  if (!config) return null;
  const app: FirebaseApp = getApps()[0] ?? initializeApp(config);
  cachedDatabase = getDatabase(app);
  return cachedDatabase;
}
