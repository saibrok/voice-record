export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = clamp(float32[i], -1, 1);
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

function floatTo24BitPCM(float32) {
  const out = new Uint8Array(float32.length * 3);
  let offset = 0;
  for (let i = 0; i < float32.length; i++) {
    const s = clamp(float32[i], -1, 1);
    const v = s < 0 ? Math.round(s * 0x800000) : Math.round(s * 0x7fffff);
    out[offset++] = v & 0xff;
    out[offset++] = (v >> 8) & 0xff;
    out[offset++] = (v >> 16) & 0xff;
  }
  return out;
}

function writeWavHeader(view, { numChannels, sampleRate, bitsPerSample, dataByteLength }) {
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const riffChunkSize = 36 + dataByteLength;

  let p = 0;
  const writeStr = (s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i));
  };
  const u32 = (v) => {
    view.setUint32(p, v, true);
    p += 4;
  };
  const u16 = (v) => {
    view.setUint16(p, v, true);
    p += 2;
  };

  writeStr('RIFF');
  u32(riffChunkSize);
  writeStr('WAVE');
  writeStr('fmt ');
  u32(16); // PCM
  u16(1); // формат аудио = PCM
  u16(numChannels);
  u32(sampleRate);
  u32(byteRate);
  u16(blockAlign);
  u16(bitsPerSample);
  writeStr('data');
  u32(dataByteLength);
}

export function encodeWavFromAudioBuffer(audioBuffer, { inSec, outSec, bitsPerSample = 16 } = {}) {
  const sr = audioBuffer.sampleRate;
  const numCh = audioBuffer.numberOfChannels;

  const start = Math.floor(clamp(inSec ?? 0, 0, audioBuffer.duration) * sr);
  const end = Math.floor(clamp(outSec ?? audioBuffer.duration, 0, audioBuffer.duration) * sr);
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  const frameCount = Math.max(0, b - a);

  // Создаем обрезанный буфер в памяти (Float32), интерливинг по каналам
  let trimmed;
  if (numCh === 1) {
    const ch0 = audioBuffer.getChannelData(0);
    trimmed = ch0.slice(a, b);
  } else {
    // Интерливинг после среза каждого канала
    const slices = [];
    for (let c = 0; c < numCh; c++) slices.push(audioBuffer.getChannelData(c).slice(a, b));
    trimmed = new Float32Array(frameCount * numCh);
    let idx = 0;
    for (let i = 0; i < frameCount; i++) {
      for (let c = 0; c < numCh; c++) trimmed[idx++] = slices[c][i];
    }
  }

  const use24 = bitsPerSample === 24;
  const pcmData = use24 ? floatTo24BitPCM(trimmed) : floatTo16BitPCM(trimmed);
  const dataBytes = pcmData.byteLength;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeWavHeader(view, {
    numChannels: numCh,
    sampleRate: sr,
    bitsPerSample: use24 ? 24 : 16,
    dataByteLength: dataBytes,
  });

  // Записываем PCM
  if (use24) {
    new Uint8Array(buffer, 44).set(pcmData);
  } else {
    let offset = 44;
    for (let i = 0; i < pcmData.length; i++, offset += 2) view.setInt16(offset, pcmData[i], true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
