class AudioCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    const channel = input?.[0]
    if (channel && channel.length > 0) {
      const copy = new Float32Array(channel.length)
      copy.set(channel)
      this.port.postMessage(copy.buffer, [copy.buffer])
    }
    return true
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor)
