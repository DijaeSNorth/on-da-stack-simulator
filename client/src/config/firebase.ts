import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth, type User } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  appId: string;
}

let warnedMissingFirebaseConfig = false;
let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedDatabase: Database | null = null;
let loggedFirebaseRecoveryStatus = false;
let anonymousAuthPromise: Promise<User | null> | null = null;

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
    logFirebaseRecoveryStatus(false, missing);
    if (((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ?? false) && !warnedMissingFirebaseConfig) {
      warnedMissingFirebaseConfig = true;
      console.warn('[firebase] multiplayer recovery disabled; missing VITE_FIREBASE_* config', { missing });
    }
    return null;
  }
  logFirebaseRecoveryStatus(true);
  return config;
}

function logFirebaseRecoveryStatus(enabled: boolean, missing: string[] = []): void {
  if (loggedFirebaseRecoveryStatus) return;
  loggedFirebaseRecoveryStatus = true;
  const debugEnabled = ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ?? false) ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('on-da-stack-debug') === '1');
  if (!debugEnabled) return;
  console.info('[firebase] multiplayer recovery status', {
    enabled,
    missing,
  });
}

export function isFirebaseRecoveryConfigured(): boolean {
  return getFirebaseClientConfig() !== null;
}

function getFirebaseApp(): FirebaseApp | null {
  if (cachedApp) return cachedApp;
  const config = getFirebaseClientConfig();
  if (!config) return null;
  cachedApp = getApps()[0] ?? initializeApp(config);
  return cachedApp;
}

export function getFirebaseAuthClient(): Auth | null {
  if (cachedAuth) return cachedAuth;
  const app = getFirebaseApp();
  if (!app) return null;
  cachedAuth = getAuth(app);
  return cachedAuth;
}

export async function ensureFirebaseAnonymousAuth(): Promise<User | null> {
  const auth = getFirebaseAuthClient();
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser;
  anonymousAuthPromise ??= signInAnonymously(auth)
    .then(credential => credential.user)
    .catch(() => null)
    .finally(() => {
      anonymousAuthPromise = null;
    });
  return anonymousAuthPromise;
}

export async function getFirebaseAuthUid(): Promise<string | null> {
  return (await ensureFirebaseAnonymousAuth())?.uid ?? null;
}

export function getFirebaseDatabase(): Database | null {
  if (cachedDatabase) return cachedDatabase;
  const app = getFirebaseApp();
  if (!app) return null;
  void ensureFirebaseAnonymousAuth();
  cachedDatabase = getDatabase(app);
  return cachedDatabase;
}
