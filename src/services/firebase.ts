import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics'
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId,
)

type FirebaseServices = {
  app: FirebaseApp
  auth: Auth
  db: Firestore
}

let services: FirebaseServices | null = null
let authPersistencePromise: Promise<void> | null = null
let analyticsStarted = false

export function getFirebaseServices() {
  if (!isFirebaseConfigured) {
    return null
  }

  if (!services) {
    const app = getApps()[0] ?? initializeApp(firebaseConfig)
    const auth = getAuth(app)
    const db = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    })

    services = { app, auth, db }
    startAnalytics(app)
  }

  return services
}

export async function prepareAuthPersistence() {
  const firebase = getFirebaseServices()

  if (!firebase) {
    return
  }

  authPersistencePromise ??= setPersistence(firebase.auth, browserLocalPersistence)
  await authPersistencePromise
}

export function watchFirebaseUser(onUser: (user: User | null) => void) {
  const firebase = getFirebaseServices()

  if (!firebase) {
    window.setTimeout(() => onUser(null), 0)
    return () => undefined
  }

  return onAuthStateChanged(firebase.auth, onUser)
}

export async function signInWithGoogle() {
  const firebase = getFirebaseServices()

  if (!firebase) {
    throw new Error('Firebase is not configured yet.')
  }

  await prepareAuthPersistence()
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })

  try {
    await signInWithPopup(firebase.auth, provider)
    return
  } catch (error) {
    if (!shouldFallBackToRedirect(error)) {
      throw error
    }
  }

  await signInWithRedirect(firebase.auth, provider)
}

export async function signInWithEmail(email: string, password: string) {
  const firebase = getFirebaseServices()

  if (!firebase) {
    throw new Error('Firebase is not configured yet.')
  }

  await prepareAuthPersistence()
  await signInWithEmailAndPassword(firebase.auth, email.trim(), password)
}

export async function createAccountWithEmail(email: string, password: string) {
  const firebase = getFirebaseServices()

  if (!firebase) {
    throw new Error('Firebase is not configured yet.')
  }

  await prepareAuthPersistence()
  await createUserWithEmailAndPassword(firebase.auth, email.trim(), password)
}

export async function signOutOfFirebase() {
  const firebase = getFirebaseServices()

  if (firebase) {
    await firebaseSignOut(firebase.auth)
  }
}

function startAnalytics(app: FirebaseApp) {
  if (analyticsStarted) {
    return
  }

  analyticsStarted = true
  void isAnalyticsSupported().then((supported) => {
    if (supported) {
      getAnalytics(app)
    }
  })
}

function shouldFallBackToRedirect(error: unknown) {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : ''

  return [
    'auth/cancelled-popup-request',
    'auth/operation-not-supported-in-this-environment',
    'auth/popup-blocked',
  ].includes(code)
}
