# MotionCue

MotionCue is now a LAN-first camera monitor. The laptop runs a tiny local HTTPS server, the monitor opens from that server, and the phone joins by scanning the QR code. Firebase is no longer needed for pairing, presence, signaling, settings, or motion events.

Video streams phone-to-laptop with WebRTC on the local network. Motion-triggered clips are saved on the recorder phone and uploaded to the laptop server so connected devices can view them in the Clips tab.

## Local Use

```bash
npm install
npm run local
```

Keep the terminal window open. It prints:

- `https://localhost:8787/` for the laptop monitor.
- A Wi-Fi URL like `https://192.168.0.168:8787/` for the phone.

Open the laptop URL, scan the QR code with the phone, then tap **Start camera** on the phone.

## HTTPS Note

Phone camera APIs require HTTPS. MotionCue generates a local self-signed certificate in `.local/`. The first phone visit may show a browser privacy warning for the laptop server; continue once, then the camera page can open over HTTPS.

## Clip Storage

Shared clips are stored on the laptop under `.local/clips/`. They do not use Firebase or cloud storage, so there is no cloud quota or storage bill. They do use laptop disk space, and MotionCue does not auto-delete them; delete clips from the Clips tab when you no longer need them.

## Scripts

```bash
npm run local
npm run local:server
npm run test
npm run build
```

`npm run local` builds and starts the local server. `npm run local:server` starts the server from the existing `dist/` build.

## Notes

- No Firebase Storage, Cloud Functions, Auth, or Firestore is required for the local version.
- Browser notifications work while the monitor page is open and permission is granted.
- Person detection is optional, local, and browser-side via TensorFlow.js/COCO-SSD.
- Live video is intended for devices on the same Wi-Fi/LAN.
