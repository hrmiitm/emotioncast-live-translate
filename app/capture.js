class Capture extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.size = 16 * (o.processorOptions.chunk || 40);
    this.buf = new Int16Array(this.size);
    this.n = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
  }
  process(inputs) {
    const ch = inputs[0];
    if (!ch?.length) return true;
    for (let i = 0; i < ch[0].length; i++) {
      let x = 0;
      for (const c of ch) x += c[i] / ch.length;
      this.sum += x;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        this.buf[this.n++] = Math.max(
          -32768,
          Math.min(32767, Math.round((this.sum / this.count) * 32767)),
        );
        this.sum = 0;
        this.count = 0;
        if (this.n === this.size) {
          this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
          this.buf = new Int16Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("capture", Capture);
