type ChunkPayload = {
  pcm16Base64: string
  sampleRate: number
  durationMs: number
  rms: number
}

function floatToInt16(samples: Float32Array) {
  const output = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    output[index] = sample < 0 ? sample * 32768 : sample * 32767
  }
  return output
}

function toBase64(int16: Int16Array) {
  const bytes = new Uint8Array(int16.buffer)
  let binary = ''
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0)
  }
  return btoa(binary)
}

function resampleLinear(input: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) {
    return input
  }

  const duration = input.length / sourceRate
  const outputLength = Math.max(1, Math.round(duration * targetRate))
  const output = new Float32Array(outputLength)

  for (let index = 0; index < outputLength; index += 1) {
    const position = (index * sourceRate) / targetRate
    const left = Math.floor(position)
    const right = Math.min(left + 1, input.length - 1)
    const alpha = position - left
    output[index] = (input[left] ?? 0) * (1 - alpha) + (input[right] ?? 0) * alpha
  }

  return output
}

function concatChunks(chunks: Float32Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Float32Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

export class AudioCapture {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private pending: Float32Array[] = []

  private flushPending(options: {
    targetSampleRate: number
    chunkDurationMs: number
    onChunk: (payload: ChunkPayload) => void
  }) {
    if (!this.context || this.pending.length === 0) {
      return
    }

    const merged = concatChunks(this.pending)
    const minimumSourceSamples = Math.round(
      (this.context.sampleRate * options.chunkDurationMs) / 1000,
    )
    if (merged.length < minimumSourceSamples) {
      return
    }

    this.pending = []
    const resampled = resampleLinear(merged, this.context.sampleRate, options.targetSampleRate)
    const pcm16 = floatToInt16(resampled)
    const rms =
      Math.sqrt(resampled.reduce((sum, sample) => sum + sample * sample, 0) / resampled.length) || 0

    options.onChunk({
      pcm16Base64: toBase64(pcm16),
      sampleRate: options.targetSampleRate,
      durationMs: Math.round((resampled.length / options.targetSampleRate) * 1000),
      rms,
    })
  }

  private handleChunk(copy: Float32Array, options: {
    targetSampleRate: number
    chunkDurationMs: number
    onChunk: (payload: ChunkPayload) => void
    onLevel?: (rms: number) => void
  }) {
    this.pending.push(copy)

    const rms =
      Math.sqrt(copy.reduce((sum, sample) => sum + sample * sample, 0) / copy.length) || 0
    options.onLevel?.(rms)
    this.flushPending(options)
  }

  async start(options: {
    targetSampleRate: number
    chunkDurationMs: number
    onChunk: (payload: ChunkPayload) => void
    onLevel?: (rms: number) => void
  }) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    const AudioContextCtor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) {
      throw new Error('This browser does not support live microphone capture.')
    }

    this.context = new AudioContextCtor()
    this.source = this.context.createMediaStreamSource(this.stream)
    if (this.context.audioWorklet) {
      try {
        await this.context.audioWorklet.addModule(
          new URL('./audioCaptureWorklet.js', import.meta.url),
        )
        this.workletNode = new AudioWorkletNode(this.context, 'audio-capture-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
        })
        this.workletNode.port.onmessage = (event) => {
          const copy = new Float32Array(event.data as ArrayBuffer)
          this.handleChunk(copy, options)
        }
        this.source.connect(this.workletNode)
        this.workletNode.connect(this.context.destination)
        return
      } catch {
        this.workletNode?.disconnect()
        this.workletNode = null
      }
    }

    this.processor = this.context.createScriptProcessor(4096, 1, 1)
    this.processor.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0)
      const copy = new Float32Array(channel.length)
      copy.set(channel)
      this.handleChunk(copy, options)
    }

    this.source.connect(this.processor)
    this.processor.connect(this.context.destination)
  }

  async stop() {
    this.workletNode?.disconnect()
    this.processor?.disconnect()
    this.source?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    this.pending = []

    if (this.context) {
      await this.context.close()
    }

    this.workletNode = null
    this.processor = null
    this.source = null
    this.stream = null
    this.context = null
  }
}
