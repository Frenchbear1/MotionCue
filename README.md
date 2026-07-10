# MotionCue

MotionCue is a local-first PWA for using a phone as a motion-triggered camera and a laptop as the monitor. It uses Firebase Authentication and Cloud Firestore for account sync, room pairing, presence, WebRTC signaling, settings, and lightweight motion-event metadata.

Video and motion-triggered clips stay on the recording phone in IndexedDB. The app does not use Firebase Storage, Cloud Functions, or any paid relay service.

## Local Development

```bash
npm install
npm run dev
```

The Firebase config is in `.env.local`. Deploy `firestore.rules` to the Firebase project before using a hosted app.

For GitHub Pages deployment, add these repository secrets before running the included workflow:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID
```

## Notes

- Camera APIs require HTTPS on phones, except for `localhost` during development.
- Same-Wi-Fi live viewing uses WebRTC with Firestore signaling. It may not connect across some networks without a TURN relay, which is intentionally omitted to avoid recurring charges.
- Browser notifications are shown only while MotionCue is open and notification permission is granted.
- Person detection is optional, local, and browser-side via TensorFlow.js/COCO-SSD.

## Scripts

```bash
npm run test
npm run build
```
