import { buildWavUrlFromBuffer, clamp, decodeRecordedBlob, encodeWavFromAudioBuffer } from './audio.js';

export function setupRecorder() {
  // ---------- DOM-узлы ----------
  const els = {
    status: document.getElementById('status'),
    sr: document.getElementById('sr'),
    ch: document.getElementById('ch'),
    dur: document.getElementById('dur'),
    deviceSelect: document.getElementById('deviceSelect'),
    preferSR: document.getElementById('preferSR'),
    channels: document.getElementById('channels'),
    ec: document.getElementById('ec'),
    ns: document.getElementById('ns'),
    agc: document.getElementById('agc'),
    recordMode: document.getElementById('recordMode'),
    mime: document.getElementById('mime'),
    btnInit: document.getElementById('btnInit'),
    btnDisable: document.getElementById('btnDisable'),
    btnStart: document.getElementById('btnStart'),
    btnStop: document.getElementById('btnStop'),
    btnClear: document.getElementById('btnClear'),

    scope: document.getElementById('scope'),
    vizMode: document.getElementById('vizMode'),
    inPoint: document.getElementById('inPoint'),
    outPoint: document.getElementById('outPoint'),
    inLabel: document.getElementById('inLabel'),
    outLabel: document.getElementById('outLabel'),
    btnPlay: document.getElementById('btnPlay'),
    btnExportWav: document.getElementById('btnExportWav'),
    btnCut: document.getElementById('btnCut'),
    player: document.getElementById('player'),

    compat: document.getElementById('compat'),
    log: document.getElementById('log'),

    meterLabelL: document.getElementById('meterLabelL'),
    meterLabelR: document.getElementById('meterLabelR'),
    meterRowR: document.getElementById('meterRowR'),
    meterFillL: document.getElementById('meterFillL'),
    meterFillR: document.getElementById('meterFillR'),
    meterDbL: document.getElementById('meterDbL'),
    meterDbR: document.getElementById('meterDbR'),
  };

  const MODE_PCM = 'pcm';
  const MODE_COMPRESSED = 'compressed';

  // ---------- Состояние ----------
  let stream = null;
  let audioCtx = null;
  let sourceNode = null;
  let analyser = null;
  let rafId = null;

  let meterSplitter = null;
  let meterAnalyserL = null;
  let meterAnalyserR = null;
  let meterChannelCount = 1;

  let workletNode = null;
  let workletGain = null;
  let workletReady = false;
  let workletConnected = false;

  let mediaRecorder = null;
  let recordedChunks = [];
  let skipDecodeOnStop = false;

  let pcmRecording = false;
  let discardOnStop = false;
  let pcmChunks = [];
  let pcmFormat = null;
  let totalFrames = 0;

  let decodedBuffer = null; // AudioBuffer для редактирования/экспорта
  let playbackUrl = null;

  // ---------- Утилиты ----------
  const log = (s) => {
    els.log.style.display = 'block';
    els.log.textContent = String(s);
  };

  const setStatus = (s) => {
    els.status.textContent = s;
  };

  const showCompat = (type, msg) => {
    els.compat.style.display = 'block';
    els.compat.className = 'msg ' + (type || 'warn');
    els.compat.textContent = msg;
  };

  const hideCompat = () => {
    els.compat.style.display = 'none';
    els.compat.textContent = '';
  };

  function formatSec(sec) {
    if (!Number.isFinite(sec)) return '—';
    return sec.toFixed(2) + 's';
  }

  function getSupportedMimes() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4', // иногда Safari
    ];
    const supported = [];
    if (!('MediaRecorder' in window)) return supported;
    for (const c of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(c)) supported.push(c);
      } catch {}
    }
    // Если ничего не найдено, оставляем пустую опцию (по умолчанию браузера)
    return supported.length ? supported : [''];
  }

  function populateMime() {
    const supported = getSupportedMimes();
    els.mime.innerHTML = '';
    const preferred = 'audio/webm;codecs=opus';
    supported.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m ? m : '(по умолчанию браузера)';
      els.mime.appendChild(opt);
    });
    if (supported.includes(preferred)) {
      els.mime.value = preferred;
    }
  }

  function updateModeUI() {
    hideCompat();
    const mode = els.recordMode.value;
    const canPcm = 'AudioWorkletNode' in window;
    const canCompressed = 'MediaRecorder' in window;

    if (mode === MODE_PCM) {
      els.mime.disabled = true;
      if (!canPcm) {
        showCompat('bad', 'AudioWorklet не поддерживается в этом браузере.');
      }
      return;
    }

    els.mime.disabled = false;
    populateMime();
    if (!canCompressed) {
      showCompat('bad', 'MediaRecorder не поддерживается в этом браузере.');
    }
  }

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      els.deviceSelect.innerHTML = '';
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Список устройств недоступен';
      els.deviceSelect.appendChild(opt);
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    els.deviceSelect.innerHTML = '';
    for (const d of inputs) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Микрофон (${d.deviceId.slice(0, 6)}…)`;
      els.deviceSelect.appendChild(opt);
    }
    if (!inputs.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Устройства не найдены';
      els.deviceSelect.appendChild(opt);
    }
  }

  function stopLiveViz() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function drawLive() {
    if (!analyser) return;
    const canvas = els.scope;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);

    // Фон
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(16,20,27,0.85)';
    ctx.fillRect(0, 0, w, h);

    // Линия по центру
    ctx.strokeStyle = 'rgba(39,48,67,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Волна
    ctx.strokeStyle = 'rgba(140,255,179,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const slice = w / data.length;
    for (let i = 0; i < data.length; i++) {
      const v = data[i] / 128.0; // 0..2
      const y = (v * h) / 2;
      const x = i * slice;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    updateMeters();
    rafId = requestAnimationFrame(drawLive);
  }

  function drawStaticWave(buffer, inSec, outSec) {
    const canvas = els.scope;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(16,20,27,0.85)';
    ctx.fillRect(0, 0, w, h);

    // Сетка
    ctx.strokeStyle = 'rgba(39,48,67,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    if (!buffer) return;

    const ch0 = buffer.getChannelData(0);
    const len = ch0.length;

    // Пики на пиксель
    const step = Math.max(1, Math.floor(len / w));
    ctx.strokeStyle = 'rgba(140,255,179,0.95)';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = 0; x < w; x++) {
      const start = x * step;
      let min = 1;
      let max = -1;
      for (let i = start; i < start + step && i < len; i++) {
        const v = ch0[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y1 = (1 - (max + 1) / 2) * h;
      const y2 = (1 - (min + 1) / 2) * h;
      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);
    }
    ctx.stroke();

    // Подсветка выделения
    const dur = buffer.duration;
    const a = clamp(inSec, 0, dur);
    const b = clamp(outSec, 0, dur);
    const x1 = Math.floor((Math.min(a, b) / dur) * w);
    const x2 = Math.floor((Math.max(a, b) / dur) * w);

    ctx.fillStyle = 'rgba(255,211,107,0.18)';
    ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h);

    ctx.strokeStyle = 'rgba(255,211,107,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x1 + 1, 1, Math.max(1, x2 - x1) - 2, h - 2);
  }

  function updateInOutUI() {
    if (!decodedBuffer) return;
    const dur = decodedBuffer.duration;
    const inV = Number(els.inPoint.value);
    const outV = Number(els.outPoint.value);
    els.inLabel.textContent = formatSec(inV);
    els.outLabel.textContent = formatSec(outV);
    els.dur.textContent = formatSec(dur);
    drawStaticWave(decodedBuffer, inV, outV);
  }

  function resetEditedState() {
    decodedBuffer = null;
    els.player.style.display = 'none';
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    playbackUrl = null;

    els.inPoint.disabled = true;
    els.outPoint.disabled = true;
    els.btnPlay.disabled = true;
    els.btnExportWav.disabled = true;
    els.btnCut.disabled = true;

    els.inPoint.value = 0;
    els.outPoint.value = 0;
    els.inPoint.max = 0;
    els.outPoint.max = 0;
    els.inLabel.textContent = '0.00s';
    els.outLabel.textContent = '0.00s';
    els.dur.textContent = '—';
    els.vizMode.textContent = 'live';

    // Чистим холст
    const ctx = els.scope.getContext('2d');
    ctx.clearRect(0, 0, els.scope.width, els.scope.height);
    ctx.fillStyle = 'rgba(16,20,27,0.85)';
    ctx.fillRect(0, 0, els.scope.width, els.scope.height);

    resetMeterUI();
  }

  function resetMeterUI() {
    if (els.meterLabelL) els.meterLabelL.textContent = 'Mono';
    if (els.meterRowR) els.meterRowR.style.display = 'none';
    if (els.meterFillL) els.meterFillL.style.width = '0%';
    if (els.meterFillR) els.meterFillR.style.width = '0%';
    if (els.meterDbL) els.meterDbL.textContent = '-inf dB';
    if (els.meterDbR) els.meterDbR.textContent = '-inf dB';
  }

  function setupMeters(channelCount) {
    if (!audioCtx || !sourceNode) return;
    meterChannelCount = channelCount;

    meterSplitter = audioCtx.createChannelSplitter(2);
    meterAnalyserL = audioCtx.createAnalyser();
    meterAnalyserR = audioCtx.createAnalyser();
    meterAnalyserL.fftSize = 2048;
    meterAnalyserR.fftSize = 2048;

    sourceNode.connect(meterSplitter);
    meterSplitter.connect(meterAnalyserL, 0);
    if (channelCount > 1) {
      meterSplitter.connect(meterAnalyserR, 1);
    }

    if (els.meterLabelL) {
      els.meterLabelL.textContent = channelCount > 1 ? 'L' : 'Mono';
    }
    if (els.meterRowR) {
      els.meterRowR.style.display = channelCount > 1 ? 'grid' : 'none';
    }
  }

  function updateMeters() {
    if (!meterAnalyserL || !els.meterFillL || !els.meterDbL) return;
    updateMeterFromAnalyser(meterAnalyserL, els.meterFillL, els.meterDbL);
    if (meterChannelCount > 1 && meterAnalyserR && els.meterFillR && els.meterDbR) {
      updateMeterFromAnalyser(meterAnalyserR, els.meterFillR, els.meterDbR);
    }
  }

  function updateMeterFromAnalyser(analyserNode, fillEl, labelEl) {
    const len = analyserNode.fftSize;
    const buf = new Float32Array(len);
    if (analyserNode.getFloatTimeDomainData) {
      analyserNode.getFloatTimeDomainData(buf);
    } else {
      const tmp = new Uint8Array(len);
      analyserNode.getByteTimeDomainData(tmp);
      for (let i = 0; i < len; i++) buf[i] = (tmp[i] - 128) / 128;
    }

    let sum = 0;
    for (let i = 0; i < len; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / len) || 0;
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

    const dbClamped = Math.max(-60, Math.min(0, db));
    const percent = ((dbClamped + 60) / 60) * 100;

    let color = '#8cffb3';
    if (db > -6) color = '#ff6b6b';
    else if (db > -18) color = '#ffd36b';

    fillEl.style.width = `${percent.toFixed(1)}%`;
    fillEl.style.backgroundColor = color;
    labelEl.textContent = Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-inf dB';
  }

  function resetPcmState() {
    pcmChunks = [];
    pcmFormat = null;
    totalFrames = 0;
  }

  function setButtons({ canRecord = false, isRecording = false, hasClip = false }) {
    els.btnInit.disabled = false;
    els.btnDisable.disabled = !canRecord;
    els.btnStart.disabled = !(canRecord && !isRecording);
    els.btnStop.disabled = !isRecording;
    els.btnClear.disabled = !(canRecord || hasClip);
    els.recordMode.disabled = isRecording;
    els.mime.disabled = isRecording || els.recordMode.value !== MODE_COMPRESSED;

    els.inPoint.disabled = !hasClip;
    els.outPoint.disabled = !hasClip;
    els.btnPlay.disabled = !hasClip;
    els.btnExportWav.disabled = !hasClip;
    els.btnCut.disabled = !hasClip;
  }

  async function disableMic() {
    hideCompat();
    if (pcmRecording) {
      stopRecording({ discard: true });
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      skipDecodeOnStop = true;
      try {
        mediaRecorder.stop();
      } catch {}
    }
    mediaRecorder = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    stopLiveViz();
    if (audioCtx) {
      try {
        await audioCtx.close();
      } catch {}
      audioCtx = null;
    }
    meterSplitter = null;
    meterAnalyserL = null;
    meterAnalyserR = null;
    meterChannelCount = 1;
    workletNode = null;
    workletGain = null;
    workletReady = false;
    workletConnected = false;
    resetEditedState();
    resetPcmState();
    resetMeterUI();
    setStatus('не инициализировано');
    setButtons({ canRecord: false, isRecording: false, hasClip: false });
  }

  function handleWorkletMessage(event) {
    const msg = event.data;
    if (!msg) return;

    if (msg.type === 'format') {
      pcmFormat = {
        sampleRate: msg.sampleRate,
        channelCount: msg.channelCount,
      };
      pcmChunks = Array.from({ length: msg.channelCount }, () => []);
      return;
    }

    if (msg.type === 'data' && pcmRecording) {
      if (!pcmFormat) {
        pcmFormat = {
          sampleRate: msg.sampleRate,
          channelCount: msg.chunk.length,
        };
        pcmChunks = Array.from({ length: pcmFormat.channelCount }, () => []);
      }

      for (let c = 0; c < msg.chunk.length; c++) {
        pcmChunks[c].push(msg.chunk[c]);
      }
      totalFrames += msg.chunk[0]?.length || 0;
    }
  }

  async function ensureWorkletNode() {
    if (!audioCtx) throw new Error('AudioContext не инициализирован');
    if (workletReady) return;

    if (!audioCtx.audioWorklet) {
      throw new Error('AudioWorklet не поддерживается');
    }

    await audioCtx.audioWorklet.addModule(new URL('./worklets/pcm-processor.js', import.meta.url));
    workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
    });
    workletNode.port.onmessage = handleWorkletMessage;

    workletGain = audioCtx.createGain();
    workletGain.gain.value = 0;
    workletNode.connect(workletGain).connect(audioCtx.destination);

    workletReady = true;
  }

  function connectWorkletIfNeeded() {
    if (!sourceNode || !workletNode || workletConnected) return;
    sourceNode.connect(workletNode);
    workletConnected = true;
  }

  async function getUserMediaWithFallback(constraints) {
    try {
      return { stream: await navigator.mediaDevices.getUserMedia(constraints), usedFallback: false };
    } catch (e) {
      const isConstraintError = e?.name === 'OverconstrainedError' || e?.name === 'ConstraintNotSatisfiedError';
      if (!isConstraintError) throw e;

      // Ослабляем требования по частоте/каналам, если устройство их не поддерживает
      const relaxed = { audio: { ...constraints.audio } };
      delete relaxed.audio.sampleRate;
      delete relaxed.audio.channelCount;
      return { stream: await navigator.mediaDevices.getUserMedia(relaxed), usedFallback: true };
    }
  }

  function applyClipBuffer(buffer) {
    decodedBuffer = buffer;

    const dur = decodedBuffer.duration;
    els.inPoint.max = String(dur);
    els.outPoint.max = String(dur);
    els.inPoint.value = '0';
    els.outPoint.value = String(dur);

    els.sr.textContent = String(decodedBuffer.sampleRate);
    els.ch.textContent = String(decodedBuffer.numberOfChannels);
    els.dur.textContent = formatSec(dur);

    els.vizMode.textContent = 'static';
    updateInOutUI();

    playbackUrl = buildWavUrlFromBuffer(decodedBuffer, playbackUrl);
    els.player.src = playbackUrl;
    els.player.style.display = 'block';

    setStatus('готово (клип загружен)');
    setButtons({ canRecord: true, isRecording: false, hasClip: true });
  }

  // ---------- Инициализация микрофона ----------
  async function initMic() {
    hideCompat();

    if (!navigator.mediaDevices?.getUserMedia) {
      showCompat(
        'bad',
        'Этот браузер не поддерживает getUserMedia(). Нужен современный Chrome/Edge/Firefox/Safari.',
      );
      return;
    }

    if (pcmRecording) {
      stopRecording({ discard: true });
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      skipDecodeOnStop = true;
      try {
        mediaRecorder.stop();
      } catch {}
    }
    mediaRecorder = null;

    // Останавливаем старый поток
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    stopLiveViz();
    if (audioCtx) {
      try {
        await audioCtx.close();
      } catch {}
      audioCtx = null;
    }
    meterSplitter = null;
    meterAnalyserL = null;
    meterAnalyserR = null;
    meterChannelCount = 1;
    workletNode = null;
    workletGain = null;
    workletReady = false;
    workletConnected = false;
    resetEditedState();
    resetPcmState();

    const deviceId = els.deviceSelect.value || undefined;
    const preferSR = els.preferSR.value ? Number(els.preferSR.value) : undefined;
    const channelCount = Number(els.channels.value) || 1;

    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: { ideal: channelCount },
        sampleRate: preferSR ? { ideal: preferSR } : undefined,
        echoCancellation: !!els.ec.checked,
        noiseSuppression: !!els.ns.checked,
        autoGainControl: !!els.agc.checked,
      },
    };

    try {
      setStatus('запрашиваем доступ…');
      const result = await getUserMediaWithFallback(constraints);
      stream = result.stream;
      if (result.usedFallback) {
        showCompat('warn', 'Не удалось применить частоту/каналы. Используются параметры устройства.');
      }

      if (preferSR) {
        const track = stream.getAudioTracks()[0];
        const settings = track?.getSettings?.();
        const actualSR = settings?.sampleRate;
        if (actualSR && actualSR !== preferSR) {
          showCompat(
            'warn',
            `Запрошенная частота ${preferSR} Hz не применена. Скорее всего в ОС задана другая частота, фактическая запись будет ${actualSR} Hz.`,
          );
        }
      }

      // Контекст для визуализации и PCM-режима
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sourceNode = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      sourceNode.connect(analyser);

      if (els.recordMode.value === MODE_PCM) {
        await ensureWorkletNode();
        connectWorkletIfNeeded();
      }

      const track = stream.getAudioTracks()[0];
      const settings = track?.getSettings?.();
      const actualChannels = settings?.channelCount || channelCount;

      setupMeters(actualChannels);

      els.sr.textContent = String(audioCtx.sampleRate);
      els.ch.textContent = String(actualChannels);

      setStatus('готово');
      els.vizMode.textContent = 'live';
      drawLive();

      // Заполняем имена устройств после разрешения
      await refreshDevices();

      setButtons({ canRecord: true, isRecording: false, hasClip: false });
    } catch (e) {
      console.error(e);
      setStatus('ошибка');
      showCompat('bad', 'Не удалось получить доступ к микрофону или инициализировать запись.');
      log(e?.message || String(e));
      setButtons({ canRecord: false, isRecording: false, hasClip: false });
    }
  }

  // ---------- Запись ----------
  async function startRecording() {
    if (!stream) return;

    const mode = els.recordMode.value;

    if (mode === MODE_PCM) {
      if (!audioCtx) return;
      try {
        await ensureWorkletNode();
        connectWorkletIfNeeded();
      } catch (e) {
        showCompat('bad', 'AudioWorklet недоступен. Переключись на сжатую запись.');
        log(e?.message || String(e));
        return;
      }

      resetPcmState();
      pcmRecording = true;
      discardOnStop = false;
      workletNode.port.postMessage({ type: 'recording', enabled: true });

      setStatus('запись…');
      setButtons({ canRecord: true, isRecording: true, hasClip: false });
      els.vizMode.textContent = 'live';
      return;
    }

    recordedChunks = [];
    const mimeType = els.mime.value || undefined;

    try {
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      console.error(e);
      showCompat('bad', 'Не удалось создать MediaRecorder с выбранным mimeType. Попробуй другой вариант кодека.');
      return;
    }

    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) recordedChunks.push(ev.data);
    };

    mediaRecorder.onerror = (ev) => {
      console.error(ev);
      showCompat('bad', 'Ошибка MediaRecorder во время записи.');
    };

    mediaRecorder.onstart = () => {
      setStatus('запись…');
      setButtons({ canRecord: true, isRecording: true, hasClip: false });
      els.vizMode.textContent = 'live';
    };

    mediaRecorder.onstop = async () => {
      if (skipDecodeOnStop) {
        skipDecodeOnStop = false;
        setStatus(stream ? 'готово' : 'не инициализировано');
        setButtons({ canRecord: !!stream, isRecording: false, hasClip: false });
        if (analyser) drawLive();
        return;
      }

      setStatus('обработка…');
      setButtons({ canRecord: true, isRecording: false, hasClip: false });
      stopLiveViz();

      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });

      try {
        const buffer = await decodeRecordedBlob(blob);
        applyClipBuffer(buffer);
      } catch (e) {
        console.error(e);
        setStatus('ошибка');
        showCompat('bad', 'Не удалось декодировать запись для редактирования. Попробуй другой кодек.');
        log(e?.message || String(e));
        setButtons({ canRecord: true, isRecording: false, hasClip: false });
        if (analyser) drawLive();
      }
    };

    try {
      mediaRecorder.start(250); // чанки каждые 250 мс
    } catch (e) {
      console.error(e);
      showCompat('bad', 'Не удалось стартовать запись.');
      log(e?.message || String(e));
    }
  }

  function finalizePcmRecording() {
    if (!pcmFormat || totalFrames === 0) {
      showCompat('warn', 'Запись пуста. Проверь микрофон и уровень сигнала.');
      setStatus('готово');
      setButtons({ canRecord: true, isRecording: false, hasClip: false });
      if (analyser) drawLive();
      return;
    }

    const buffer = audioCtx.createBuffer(pcmFormat.channelCount, totalFrames, pcmFormat.sampleRate);
    for (let c = 0; c < pcmFormat.channelCount; c++) {
      const channelData = buffer.getChannelData(c);
      let offset = 0;
      for (const chunk of pcmChunks[c]) {
        channelData.set(chunk, offset);
        offset += chunk.length;
      }
    }

    applyClipBuffer(buffer);
  }

  function stopRecording({ discard = false } = {}) {
    const mode = els.recordMode.value;

    if (mode === MODE_PCM) {
      if (!pcmRecording) return;
      pcmRecording = false;
      discardOnStop = discard;
      workletNode?.port.postMessage({ type: 'recording', enabled: false });

      if (discardOnStop) {
        discardOnStop = false;
        resetPcmState();
        setStatus(stream ? 'готово' : 'не инициализировано');
        setButtons({ canRecord: !!stream, isRecording: false, hasClip: false });
        if (analyser) drawLive();
        return;
      }

      setStatus('обработка…');
      setButtons({ canRecord: true, isRecording: false, hasClip: false });
      stopLiveViz();
      finalizePcmRecording();
      return;
    }

    if (!mediaRecorder) return;
    if (mediaRecorder.state === 'recording') mediaRecorder.stop();
  }

  // ---------- Редактирование: обрезка/вырезание ----------
  async function playTrim() {
    if (!decodedBuffer) return;
    const inSec = Number(els.inPoint.value);
    const outSec = Number(els.outPoint.value);
    const a = Math.min(inSec, outSec);
    const b = Math.max(inSec, outSec);

    // Создаем WAV для предпросмотра выделенного участка
    playbackUrl = buildWavUrlFromBuffer(decodedBuffer, playbackUrl, { inSec: a, outSec: b });
    els.player.src = playbackUrl;
    els.player.style.display = 'block';
    await els.player.play().catch(() => {});
  }

  async function cutSelectionAndReplace() {
    if (!decodedBuffer) return;

    const sr = decodedBuffer.sampleRate;
    const numCh = decodedBuffer.numberOfChannels;
    const inSec = Number(els.inPoint.value);
    const outSec = Number(els.outPoint.value);
    const a = Math.min(inSec, outSec);
    const b = Math.max(inSec, outSec);

    const start = Math.floor(clamp(a, 0, decodedBuffer.duration) * sr);
    const end = Math.floor(clamp(b, 0, decodedBuffer.duration) * sr);

    if (end <= start) return;

    const newLength = decodedBuffer.length - (end - start);
    if (newLength <= 0) {
      showCompat('warn', 'Нельзя удалить весь клип целиком. Выдели меньший диапазон.');
      return;
    }
    hideCompat();

    // Создаем новый AudioBuffer
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: sr });
    const outBuf = ctx.createBuffer(numCh, newLength, sr);

    for (let c = 0; c < numCh; c++) {
      const src = decodedBuffer.getChannelData(c);
      const dst = outBuf.getChannelData(c);

      // копируем [0..start)
      dst.set(src.slice(0, start), 0);

      // копируем [end..]
      dst.set(src.slice(end), start);
    }

    decodedBuffer = outBuf;

    const dur = decodedBuffer.duration;
    els.inPoint.max = String(dur);
    els.outPoint.max = String(dur);
    els.inPoint.value = '0';
    els.outPoint.value = String(dur);

    els.dur.textContent = formatSec(dur);
    els.vizMode.textContent = 'static';
    updateInOutUI();

    playbackUrl = buildWavUrlFromBuffer(decodedBuffer, playbackUrl);
    els.player.src = playbackUrl;
    els.player.style.display = 'block';

    // Закрываем временный контекст
    try {
      await ctx.close();
    } catch {}
  }

  // ---------- Привязка интерфейса ----------
  updateModeUI();

  // Первичный список устройств (названия могут быть пустыми до разрешения)
  if (navigator.mediaDevices?.enumerateDevices) {
    refreshDevices().catch(() => {});
  }

  els.recordMode.addEventListener('change', () => {
    updateModeUI();
  });

  els.btnInit.addEventListener('click', initMic);
  els.btnDisable.addEventListener('click', disableMic);
  els.btnStart.addEventListener('click', () => {
    startRecording();
  });
  els.btnStop.addEventListener('click', () => stopRecording());

  els.btnClear.addEventListener('click', async () => {
    hideCompat();
    resetEditedState();
    resetPcmState();
    if (pcmRecording) {
      stopRecording({ discard: true });
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      skipDecodeOnStop = true;
      try {
        mediaRecorder.stop();
      } catch {}
    }
    mediaRecorder = null;
    setStatus(stream ? 'готово' : 'не инициализировано');
    if (analyser) drawLive();
    setButtons({ canRecord: !!stream, isRecording: false, hasClip: false });
  });

  els.inPoint.addEventListener('input', updateInOutUI);
  els.outPoint.addEventListener('input', updateInOutUI);

  els.btnPlay.addEventListener('click', playTrim);

  els.btnExportWav.addEventListener('click', () => {
    if (!decodedBuffer) return;
    const inSec = Number(els.inPoint.value);
    const outSec = Number(els.outPoint.value);
    const a = Math.min(inSec, outSec);
    const b = Math.max(inSec, outSec);

    const wav = encodeWavFromAudioBuffer(decodedBuffer, { inSec: a, outSec: b });
    const ts = new Date().toISOString().replaceAll(':', '-').slice(0, 19);
    const filename = `recording_${ts}_${Math.round((b - a) * 100) / 100}s.wav`;

    const url = URL.createObjectURL(wav);
    const aEl = document.createElement('a');
    aEl.href = url;
    aEl.download = filename;
    document.body.appendChild(aEl);
    aEl.click();
    aEl.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  });

  els.btnCut.addEventListener('click', cutSelectionAndReplace);

  // Реакция на смену устройства (нужна повторная инициализация)
  els.deviceSelect.addEventListener('change', () => {
    if (stream) {
      showCompat('warn', 'Устройство изменено. Нажми "Инициализировать микрофон" ещё раз, чтобы применить выбор.');
    }
  });

  // Если устройства меняются во время работы страницы
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    refreshDevices().catch(() => {});
  });

  // Подсказки совместимости
  if (!('AudioWorkletNode' in window) && !('MediaRecorder' in window)) {
    showCompat('bad', 'Этот браузер не поддерживает AudioWorklet и MediaRecorder.');
    setStatus('несовместимо');
  } else {
    setStatus('не инициализировано');
  }
}
