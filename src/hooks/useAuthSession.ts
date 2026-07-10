import { useCallback, useEffect, useState } from 'react'
import {
  createAccountWithEmail,
  isFirebaseConfigured,
  signInWithEmail,
  signInWithGoogle,
  signOutOfFirebase,
  watchFirebaseUser,
} from '../services/firebase'
import type { SessionUser } from '../types'

const previewUser: SessionUser = {
  uid: 'preview-user',
  displayName: 'Preview user',
  email: 'preview@motioncue.local',
  photoURL: null,
  isPreview: true,
}

export function useAuthSession() {
  const [session, setSession] = useState<SessionUser | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setSession(previewUser)
      setIsReady(true)
      return
    }

    return watchFirebaseUser((user) => {
      setSession(
        user
          ? {
              uid: user.uid,
              displayName: user.displayName ?? user.email ?? 'MotionCue user',
              email: user.email ?? '',
              photoURL: user.photoURL,
              isPreview: false,
            }
          : null,
      )
      setIsReady(true)
    })
  }, [])

  const signIn = useCallback(async () => {
    setError('')

    if (!isFirebaseConfigured) {
      setSession(previewUser)
      return
    }

    try {
      await signInWithGoogle()
    } catch (signInError) {
      setError(formatAuthError(signInError))
    }
  }, [])

  const signInEmail = useCallback(async (email: string, password: string) => {
    setError('')

    try {
      await signInWithEmail(email, password)
    } catch (signInError) {
      setError(formatAuthError(signInError))
    }
  }, [])

  const createEmailAccount = useCallback(async (email: string, password: string) => {
    setError('')

    try {
      await createAccountWithEmail(email, password)
    } catch (signInError) {
      setError(formatAuthError(signInError))
    }
  }, [])

  const signOut = useCallback(async () => {
    setError('')

    if (!isFirebaseConfigured) {
      setSession(null)
      window.setTimeout(() => setSession(previewUser), 0)
      return
    }

    try {
      await signOutOfFirebase()
    } catch (signOutError) {
      setError(formatAuthError(signOutError))
    }
  }, [])

  return {
    session,
    isReady,
    error,
    isFirebaseConfigured,
    signIn,
    signInEmail,
    createEmailAccount,
    signOut,
  }
}

function formatAuthError(error: unknown) {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : ''

  const messages: Record<string, string> = {
    'auth/email-already-in-use': 'That email already has an account.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/missing-password': 'Enter a password.',
    'auth/weak-password': 'Use at least 6 characters for the password.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/user-not-found': 'No account was found for that email.',
    'auth/wrong-password': 'Email or password is incorrect.',
  }

  if (messages[code]) {
    return messages[code]
  }

  return error instanceof Error ? error.message : 'Authentication failed.'
}
