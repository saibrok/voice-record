class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isRecording = false;
    this.formatSent = false;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg?.type === 'recording') {
        this.isRecording = !!msg.enabled;
        if (this.isRecording) {
          this.formatSent = false;
        }
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0) {
      return true;
    }

    // Пробрасываем вход на выход (ниже он будет заглушен нулевым Gain)
    if (output && output.length === input.length) {
      for (let c = 0; c < input.length; c++) {
        output[c].set(input[c]);
      }
    }

    if (!this.isRecording) {
      return true;
    }

    if (!this.formatSent) {
      this.port.postMessage({
        type: 'format',
        sampleRate,
        channelCount: input.length,
      });
      this.formatSent = true;
    }

    const frames = input[0].length;
    const chunk = new Array(input.length);
    for (let c = 0; c < input.length; c++) {
      const copy = new Float32Array(frames);
      copy.set(input[c]);
      chunk[c] = copy;
    }

    this.port.postMessage(
      {
        type: 'data',
        sampleRate,
        chunk,
      },
      chunk.map((buf) => buf.buffer),
    );

    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
