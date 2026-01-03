// PCM Audio Worklet Processor
// Receives Float32 PCM data and outputs it to the audio graph

class PCMWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Ring buffer for audio data
    this.bufferSize = 48000 * 2 * 2; // 2 seconds of stereo audio
    this.buffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.bufferedSamples = 0;
    
    // Configuration
    this.channels = 2;
    this.isPlaying = false;
    this.targetLatency = 4096; // Target buffer size before starting playback
    
    // Message handling
    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };
    
    // Notify main thread we're ready
    this.port.postMessage({ type: 'ready' });
  }
  
  handleMessage(data) {
    switch (data.type) {
      case 'audio':
        this.addAudioData(data.samples);
        break;
      case 'config':
        if (data.channels) this.channels = data.channels;
        if (data.targetLatency) this.targetLatency = data.targetLatency;
        break;
      case 'clear':
        this.clearBuffer();
        break;
      case 'status':
        this.sendStatus();
        break;
    }
  }
  
  addAudioData(samples) {
    const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples);
    
    for (let i = 0; i < float32.length; i++) {
      this.buffer[this.writeIndex] = float32[i];
      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    }
    
    this.bufferedSamples = Math.min(this.bufferedSamples + float32.length, this.bufferSize);
    
    // Start playback once we have enough buffered
    if (!this.isPlaying && this.bufferedSamples >= this.targetLatency) {
      this.isPlaying = true;
      this.port.postMessage({ type: 'playbackStarted' });
    }
  }
  
  clearBuffer() {
    this.writeIndex = 0;
    this.readIndex = 0;
    this.bufferedSamples = 0;
    this.isPlaying = false;
    this.buffer.fill(0);
  }
  
  sendStatus() {
    this.port.postMessage({
      type: 'status',
      bufferedSamples: this.bufferedSamples,
      isPlaying: this.isPlaying,
      bufferUtilization: this.bufferedSamples / this.bufferSize
    });
  }
  
  process(inputs, outputs, parameters) {
    const output = outputs[0];
    
    if (!output || output.length === 0) {
      return true;
    }
    
    const framesPerChannel = output[0].length; // Usually 128 frames
    const totalSamples = framesPerChannel * this.channels;
    
    if (!this.isPlaying || this.bufferedSamples < totalSamples) {
      // Output silence if not enough data
      for (let channel = 0; channel < output.length; channel++) {
        output[channel].fill(0);
      }
      
      // Check if we ran out of data
      if (this.isPlaying && this.bufferedSamples < totalSamples) {
        this.port.postMessage({ type: 'underrun' });
      }
      
      return true;
    }
    
    // Deinterleave and output
    for (let frame = 0; frame < framesPerChannel; frame++) {
      for (let channel = 0; channel < Math.min(output.length, this.channels); channel++) {
        output[channel][frame] = this.buffer[this.readIndex];
        this.readIndex = (this.readIndex + 1) % this.bufferSize;
      }
      
      // Skip extra channels if mono input
      if (this.channels < output.length) {
        for (let c = this.channels; c < output.length; c++) {
          output[c][frame] = output[0][frame]; // Duplicate first channel
        }
      }
    }
    
    this.bufferedSamples = Math.max(0, this.bufferedSamples - totalSamples);
    
    return true;
  }
}

registerProcessor('pcm-worklet-processor', PCMWorkletProcessor);
