class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Circular buffer: 2 seconds at 24kHz = 48000 samples
    this.bufferSize = 96000;
    this.buffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.readyToPlay = false;

    this.port.onmessage = (event) => {
      const data = event.data;
      for (let i = 0; i < data.length; i++) {
        this.buffer[this.writeIndex] = data[i];
        this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
      }
      
      // Delay playback until we have a substantial buffer
      if (!this.readyToPlay && (this.writeIndex - this.readIndex + this.bufferSize) % this.bufferSize > 4096) {
        this.readyToPlay = true;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const channel = output[0]; // Assuming mono

    for (let i = 0; i < channel.length; i++) {
      if (this.readyToPlay && this.readIndex !== this.writeIndex) {
        channel[i] = this.buffer[this.readIndex];
        this.readIndex = (this.readIndex + 1) % this.bufferSize;
      } else {
        channel[i] = 0; // Silence or could add comfort noise
      }
    }
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
