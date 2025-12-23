export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = clamp(float32[i], -1, 1);
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
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

export function encodeWavFromAudioBuffer(audioBuffer, { inSec, outSec } = {}) {
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

  const pcm16 = floatTo16BitPCM(trimmed);
  const dataBytes = pcm16.byteLength;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeWavHeader(view, { numChannels: numCh, sampleRate: sr, bitsPerSample: 16, dataByteLength: dataBytes });

  // Записываем PCM
  let offset = 44;
  for (let i = 0; i < pcm16.length; i++, offset += 2) view.setInt16(offset, pcm16[i], true);

  return new Blob([buffer], { type: 'audio/wav' });
}

export async function decodeRecordedBlob(blob) {
  const arr = await blob.arrayBuffer();
  // Используем отдельный контекст для декодирования с реальной частотой дискретизации
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await ctx.decodeAudioData(arr.slice(0));
  await ctx.close();
  return audioBuffer;
}

export function buildWavUrlFromBuffer(buffer, previousUrl, { inSec = 0, outSec = buffer.duration } = {}) {
  const wav = encodeWavFromAudioBuffer(buffer, { inSec, outSec });
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  return URL.createObjectURL(wav);
}
