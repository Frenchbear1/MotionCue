export function createPeerConnection() {
  return new RTCPeerConnection({
    iceServers: [],
  })
}

export function toSignalingDescription(description: RTCSessionDescription | null) {
  if (!description) {
    throw new Error('Missing session description.')
  }

  return {
    type: description.type,
    sdp: description.sdp,
  }
}

export function chooseRecordingMimeType() {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ]

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}
