type QueuedChunk = {
  samples: Float32Array
  sampleRate: number
}

function decodeBase64Pcm16(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  const pcm = new Int16Array(bytes.buffer)
  const samples = new Float32Array(pcm.length)
  for (let index = 0; index < pcm.length; index += 1) {
    samples[index] = pcm[index] / 32768
  }

  return samples
}

export class StreamAudioPlayer {
  private context: AudioContext | null = null
  private nextStartTime = 0
  private pending: QueuedChunk[] = []
  private bufferedSeconds = 0
  private hasStarted = false
  private readonly minBufferSeconds: number

  constructor(minBufferSeconds = 0.8) {
    this.minBufferSeconds = minBufferSeconds
  }

  async enqueueBase64Pcm16(
    base64: string,
    sampleRate: number,
    options: {
      autoplay: boolean
      forceStart?: boolean
    },
  ) {
    const chunk = {
      samples: decodeBase64Pcm16(base64),
      sampleRate,
    }

    this.pending.push(chunk)
    this.bufferedSeconds += chunk.samples.length / sampleRate

    if (
      options.autoplay &&
      (this.bufferedSeconds >= this.minBufferSeconds || options.forceStart === true)
    ) {
      await this.start()
    }
  }

  async start() {
    if (!this.context) {
      const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextCtor) {
        throw new Error('This browser does not support Web Audio playback.')
      }
      this.context = new AudioContextCtor()
    }

    await this.context.resume()
    this.flushPending()
  }

  private flushPending() {
    if (!this.context || this.pending.length === 0) {
      return
    }

    if (!this.hasStarted) {
      this.nextStartTime = this.context.currentTime + 0.05
      this.hasStarted = true
    }

    while (this.pending.length > 0) {
      const chunk = this.pending.shift()!
      const audioBuffer = this.context.createBuffer(1, chunk.samples.length, chunk.sampleRate)
      audioBuffer.getChannelData(0).set(chunk.samples)

      const source = this.context.createBufferSource()
      source.buffer = audioBuffer
      source.connect(this.context.destination)

      const startAt = Math.max(this.context.currentTime + 0.02, this.nextStartTime)
      source.start(startAt)
      this.nextStartTime = startAt + audioBuffer.duration
      this.bufferedSeconds = Math.max(0, this.bufferedSeconds - audioBuffer.duration)
    }
  }

  async stop() {
    this.pending = []
    this.bufferedSeconds = 0
    this.hasStarted = false
    this.nextStartTime = 0

    if (this.context) {
      await this.context.close()
      this.context = null
    }
  }
}
