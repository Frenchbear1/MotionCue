type Prediction = {
  class: string
  score: number
  bbox: [number, number, number, number]
}

type PersonModel = {
  detect: (source: HTMLVideoElement | HTMLCanvasElement) => Promise<Prediction[]>
}

type CocoModule = {
  load: (config?: { base?: string }) => Promise<PersonModel>
}

let modelPromise: Promise<PersonModel> | null = null

export type PersonDetectionResult = {
  supported: boolean
  detected: boolean
  score: number
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
}

export async function detectPersonInFrame(
  source: HTMLVideoElement | HTMLCanvasElement,
): Promise<PersonDetectionResult> {
  try {
    modelPromise ??= loadModel()
    const model = await modelPromise
    const predictions = await model.detect(source)
    const person = predictions
      .filter((prediction) => prediction.class === 'person')
      .sort((a, b) => b.score - a.score)[0]

    return {
      supported: true,
      detected: Boolean(person && person.score >= 0.45),
      score: person?.score ?? 0,
      status: 'ready',
    }
  } catch {
    return {
      supported: false,
      detected: false,
      score: 0,
      status: 'unavailable',
    }
  }
}

async function loadModel() {
  await import('@tensorflow/tfjs')
  const coco = (await import('@tensorflow-models/coco-ssd')) as CocoModule
  return coco.load({ base: 'lite_mobilenet_v2' })
}
