import { clamp, encodeWavFromAudioBuffer } from './audio.js';

export function setupRecorder() {
  // ---------- DOM-узлы ----------
  const els = {
    status: document.getElementById('status'),
    sr: document.getElementById('sr'),
    ch: document.getElementById('ch'),
    dur: document.getElementById('dur'),
    deviceSelect: document.getElementById('deviceSelect'),
    preferSRLabel: document.getElementById('preferSRLabel'),
    srRequested: document.getElementById('srRequested'),
    srActual: document.getElementById('srActual'),
    channels: document.getElementById('channels'),
    chRequested: document.getElementById('chRequested'),
    chActual: document.getElementById('chActual'),
    ec: document.getElementById('ec'),
    ns: document.getElementById('ns'),
    agc: document.getElementById('agc'),
    btnInit: document.getElementById('btnInit'),
    btnDisable: document.getElementById('btnDisable'),
    btnStart: document.getElementById('btnStart'),
    btnStop: document.getElementById('btnStop'),
    btnClear: document.getElementById('btnClear'),

    liveScope: document.getElementById('liveScope'),
    editScope: document.getElementById('editScope'),
    liveModule: document.getElementById('liveModule'),
    editorModule: document.getElementById('editorModule'),
    vizMode: document.getElementById('vizMode'),
    btnPlay: document.getElementById('btnPlay'),
    btnExportWav: document.getElementById('btnExportWav'),
    btnDelete: document.getElementById('btnDelete'),

    selIn: document.getElementById('selIn'),
    selOut: document.getElementById('selOut'),
    selInFooter: document.getElementById('selInFooter'),
    selOutFooter: document.getElementById('selOutFooter'),
    selLen: document.getElementById('selLen'),
    playPos: document.getElementById('playPos'),

    compat: document.getElementById('compat'),
    log: document.getElementById('log'),

    meterLabelL: document.getElementById('meterLabelL'),
    meterLabelR: document.getElementById('meterLabelR'),
    meterRowR: document.getElementById('meterRowR'),
    meterCanvasL: document.getElementById('meterCanvasL'),
    meterCanvasR: document.getElementById('meterCanvasR'),
    meterDbL: document.getElementById('meterDbL'),
    meterDbR: document.getElementById('meterDbR'),
    editWaveArea: document.getElementById('editWaveArea'),
    selHandleL: document.getElementById('selHandleL'),
    selHandleR: document.getElementById('selHandleR'),
    playheadHandle: document.getElementById('playheadHandle'),
  };

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
  let meterPeakL = { value: 0, holdUntil: 0, lastUpdate: 0 };
  let meterPeakR = { value: 0, holdUntil: 0, lastUpdate: 0 };
  const METER_HOLD_MS = 1200;
  const METER_DECAY_PER_MS = 0.26;

  let workletNode = null;
  let workletGain = null;
  let workletReady = false;
  let workletConnected = false;


  let pcmRecording = false;
  let discardOnStop = false;
  let pcmChunks = [];
  let pcmFormat = null;
  let totalFrames = 0;

  let decodedBuffer = null; // AudioBuffer для редактирования/экспорта
  let selection = { has: false, start: 0, end: 0 };
  let playheadSec = 0;
  let dragState = null;
  let isPlaying = false;
  let playbackSource = null;
  let playbackRaf = null;
  let playbackStartTime = 0;
  let playbackStartSec = 0;
  let playbackEndSec = 0;

  const WAVE_PADDING = { left: 18, right: 18, top: 18, bottom: 8 };
  const HANDLE_GRAB_PX = 12;
  const HANDLE_WIDTH_PX = 12;

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
    if (!analyser || !els.liveScope) return;
    const canvas = els.liveScope;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);

    // Фон
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(16,20,27,0.85)';
    ctx.fillRect(0, 0, w, h);

    const innerW = Math.max(1, w - WAVE_PADDING.left - WAVE_PADDING.right);
    const innerH = Math.max(1, h - WAVE_PADDING.top - WAVE_PADDING.bottom);

    // Рамка вокруг области волны
    ctx.strokeStyle = 'rgba(39,48,67,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(WAVE_PADDING.left, WAVE_PADDING.top, innerW, innerH);

    // Линия по центру
    ctx.strokeStyle = 'rgba(39,48,67,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(WAVE_PADDING.left, WAVE_PADDING.top + innerH / 2);
    ctx.lineTo(WAVE_PADDING.left + innerW, WAVE_PADDING.top + innerH / 2);
    ctx.stroke();

    // Волна
    ctx.strokeStyle = 'rgba(140,255,179,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const slice = innerW / data.length;
    for (let i = 0; i < data.length; i++) {
      const v = data[i] / 128.0; // 0..2
      const y = WAVE_PADDING.top + (v * innerH) / 2;
      const x = WAVE_PADDING.left + i * slice;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    updateMeters();
    rafId = requestAnimationFrame(drawLive);
  }

  function drawStaticWave(buffer) {
    if (!buffer) return;
    if (!els.editScope) return;
    const canvas = els.editScope;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(16,20,27,0.85)';
    ctx.fillRect(0, 0, w, h);

    const channelCount = Math.min(2, buffer.numberOfChannels);
    const innerW = Math.max(1, w - WAVE_PADDING.left - WAVE_PADDING.right);
    const innerH = Math.max(1, h - WAVE_PADDING.top - WAVE_PADDING.bottom);
    const segmentH = innerH / channelCount;

    // Рамка вокруг области волны
    ctx.strokeStyle = 'rgba(39,48,67,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(WAVE_PADDING.left, WAVE_PADDING.top, innerW, innerH);

    // Линии по центру каналов
    ctx.strokeStyle = 'rgba(39,48,67,0.65)';
    ctx.lineWidth = 1;
    for (let c = 0; c < channelCount; c++) {
      const y = WAVE_PADDING.top + segmentH * c + segmentH / 2;
      ctx.beginPath();
      ctx.moveTo(WAVE_PADDING.left, y);
      ctx.lineTo(WAVE_PADDING.left + innerW, y);
      ctx.stroke();
    }

    // Волны
    ctx.strokeStyle = 'rgba(140,255,179,0.95)';
    ctx.lineWidth = 1;

    for (let c = 0; c < channelCount; c++) {
      const data = buffer.getChannelData(c);
      const len = data.length;
      const step = Math.max(1, Math.floor(len / innerW));
      const yCenter = WAVE_PADDING.top + segmentH * c + segmentH / 2;
      const yScale = segmentH / 2;

      ctx.beginPath();
      for (let x = 0; x < innerW; x++) {
        const start = x * step;
        let min = 1;
        let max = -1;
        for (let i = start; i < start + step && i < len; i++) {
          const v = data[i];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        const y1 = yCenter - max * yScale;
        const y2 = yCenter - min * yScale;
        const drawX = WAVE_PADDING.left + x;
        ctx.moveTo(drawX, y1);
        ctx.lineTo(drawX, y2);
      }
      ctx.stroke();
    }

    // Подсветка выделения
    const selRange = getSelectionRange();
    if (selRange) {
      const dur = buffer.duration;
      const [a, b] = selRange;
      const x1 = Math.floor(WAVE_PADDING.left + (a / dur) * innerW);
      const x2 = Math.floor(WAVE_PADDING.left + (b / dur) * innerW);

      ctx.fillStyle = 'rgba(107, 159, 255, 0.1)';
      ctx.fillRect(x1, WAVE_PADDING.top, Math.max(1, x2 - x1), innerH);

      ctx.strokeStyle = 'rgba(107, 159, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x1 + 1, WAVE_PADDING.top + 1, Math.max(1, x2 - x1) - 2, innerH - 2);
    }

    // Позиция воспроизведения
    if (Number.isFinite(playheadSec)) {
      const dur = buffer.duration || 1;
      const x = Math.floor(WAVE_PADDING.left + (clamp(playheadSec, 0, dur) / dur) * innerW);
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, WAVE_PADDING.top);
      ctx.lineTo(x + 0.5, WAVE_PADDING.top + innerH);
      ctx.stroke();
    }

    updateOverlayHandles();
  }

  function resetEditedState() {
    if (isPlaying) {
      stopPlayback(true);
    }
    decodedBuffer = null;

    els.btnPlay.disabled = true;
    els.btnExportWav.disabled = true;
    els.btnDelete.disabled = true;

    els.dur.textContent = '—';
    els.vizMode.textContent = 'live';

    // Чистим холст
    if (els.editScope) {
      const ctx = els.editScope.getContext('2d');
      ctx.clearRect(0, 0, els.editScope.width, els.editScope.height);
      ctx.fillStyle = 'rgba(16,20,27,0.85)';
      ctx.fillRect(0, 0, els.editScope.width, els.editScope.height);
    }

    resetMeterUI();
    clearSelection();
    setPlayhead(0);
    setActiveModule('live');
  }

  function clearSelection() {
    selection = { has: false, start: 0, end: 0 };
    updateSelectionUI();
  }

  function setSelection(startSec, endSec) {
    selection = {
      has: true,
      start: clamp(startSec, 0, decodedBuffer?.duration || 0),
      end: clamp(endSec, 0, decodedBuffer?.duration || 0),
    };
    updateSelectionUI();
  }

  function getSelectionRange() {
    if (!selection.has) return null;
    const a = Math.min(selection.start, selection.end);
    const b = Math.max(selection.start, selection.end);
    if (Math.abs(b - a) < 0.02) return null;
    return [a, b];
  }

  function isRecordingActive() {
    return pcmRecording;
  }

  function updateSelectionUI() {
    const range = getSelectionRange();
    if (!range) {
      if (els.selIn) els.selIn.textContent = '—';
      if (els.selOut) els.selOut.textContent = '—';
      if (els.selInFooter) els.selInFooter.textContent = '—';
      if (els.selOutFooter) els.selOutFooter.textContent = '—';
      if (els.selLen) els.selLen.textContent = '—';
      setButtons({
        canRecord: !!stream,
        isRecording: isRecordingActive(),
        hasClip: !!decodedBuffer,
        hasSelection: false,
      });
      if (els.selHandleL) els.selHandleL.classList.remove('left');
      if (els.selHandleR) els.selHandleR.classList.remove('left');
      updateOverlayHandles();
      return;
    }
    const [a, b] = range;
    const len = b - a;
    const inText = formatSec(a);
    const outText = formatSec(b);
    if (els.selIn) els.selIn.textContent = inText;
    if (els.selOut) els.selOut.textContent = outText;
    if (els.selInFooter) els.selInFooter.textContent = inText;
    if (els.selOutFooter) els.selOutFooter.textContent = outText;
    if (els.selLen) els.selLen.textContent = formatSec(len);
    setButtons({
      canRecord: !!stream,
      isRecording: isRecordingActive(),
      hasClip: !!decodedBuffer,
      hasSelection: true,
    });
    updateOverlayHandles();
  }

  function setPlayhead(sec) {
    playheadSec = clamp(sec, 0, decodedBuffer?.duration || 0);
    if (els.playPos) els.playPos.textContent = formatSec(playheadSec);
    updateOverlayHandles();
  }

  function setActiveModule(mode) {
    if (els.liveModule) {
      els.liveModule.classList.toggle('hidden', mode !== 'live');
    }
    if (els.editorModule) {
      els.editorModule.classList.toggle('hidden', mode !== 'edit');
    }
  }

  function setPreferredSampleRateLabel(value) {
    if (!els.preferSRLabel) return;
    if (!value) {
      els.preferSRLabel.textContent = '—';
      return;
    }
    els.preferSRLabel.textContent = `${value} Hz`;
  }

  function setRequestActualLabels({ srRequested, srActual, chRequested, chActual }) {
    if (els.srRequested) els.srRequested.textContent = srRequested ?? '—';
    if (els.srActual) els.srActual.textContent = srActual ?? '—';
    if (els.chRequested) els.chRequested.textContent = chRequested ?? '—';
    if (els.chActual) els.chActual.textContent = chActual ?? '—';
  }

  function getCanvasEventInfo(event) {
    const rect = els.editScope.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const duration = decodedBuffer?.duration || 0;
    const innerW = Math.max(1, rect.width - WAVE_PADDING.left - WAVE_PADDING.right);
    const innerX = clamp(x - WAVE_PADDING.left, 0, innerW);
    const t = duration > 0 ? clamp((innerX / innerW) * duration, 0, duration) : 0;
    return { x, y, t, rect, duration, innerW, innerX };
  }

  function startCanvasDrag(event) {
    if (!decodedBuffer || !els.editScope) return;
    if (isPlaying) stopPlayback(false);

    const info = getCanvasEventInfo(event);
    const range = getSelectionRange();
    const dur = decodedBuffer.duration || 1;
    const playheadX = WAVE_PADDING.left + (playheadSec / dur) * info.innerW;
    const onHandle = info.y <= WAVE_PADDING.top && Math.abs(info.x - playheadX) <= HANDLE_GRAB_PX;
    const edgePx = 16;

    if (onHandle) {
      dragState = { mode: 'scrub', startTime: info.t, moved: false };
      setPlayhead(info.t);
      drawStaticWave(decodedBuffer);
      return;
    }

    if (range) {
      const [a, b] = range;
      const x1 = WAVE_PADDING.left + (a / dur) * info.innerW;
      const x2 = WAVE_PADDING.left + (b / dur) * info.innerW;
      if (Math.abs(info.x - x1) <= edgePx) {
        dragState = { mode: 'resize-left', startSelEnd: b, moved: false };
        return;
      }
      if (Math.abs(info.x - x2) <= edgePx) {
        dragState = { mode: 'resize-right', startSelStart: a, moved: false };
        return;
      }
      if (info.x >= x1 && info.x <= x2) {
        dragState = {
          mode: 'move',
          startSelStart: a,
          startSelEnd: b,
          offset: info.t - a,
          moved: false,
        };
        return;
      }
    }

    dragState = {
      mode: 'create',
      startTime: info.t,
      startInnerX: info.innerX,
      moved: false,
      started: false,
    };
  }

  function moveCanvasDrag(event) {
    if (!dragState || !decodedBuffer) return;
    const info = getCanvasEventInfo(event);
    const dur = decodedBuffer.duration || 0;

    dragState.moved = true;

    if (dragState.mode === 'scrub') {
      setPlayhead(info.t);
      drawStaticWave(decodedBuffer);
      return;
    }
    if (dragState.mode === 'create') {
      const thresholdPx = 6;
      const movedPx = Math.abs(info.innerX - dragState.startInnerX);
      if (!dragState.started && movedPx < thresholdPx) {
        return;
      }
      dragState.started = true;
      setSelection(dragState.startTime, info.t);
      drawStaticWave(decodedBuffer);
      return;
    }
    if (dragState.mode === 'resize-left') {
      setSelection(info.t, dragState.startSelEnd);
      drawStaticWave(decodedBuffer);
      return;
    }
    if (dragState.mode === 'resize-right') {
      setSelection(dragState.startSelStart, info.t);
      drawStaticWave(decodedBuffer);
      return;
    }
    if (dragState.mode === 'move') {
      const length = dragState.startSelEnd - dragState.startSelStart;
      const newStart = clamp(info.t - dragState.offset, 0, Math.max(0, dur - length));
      setSelection(newStart, newStart + length);
      drawStaticWave(decodedBuffer);
    }
  }

  function endCanvasDrag(event) {
    if (!dragState || !decodedBuffer) return;
    const info = getCanvasEventInfo(event);
    const range = getSelectionRange();

    if (dragState.mode === 'create' && !range) {
      setPlayhead(info.t);
      drawStaticWave(decodedBuffer);
    }

    if (dragState.mode === 'scrub') {
      setPlayhead(info.t);
      drawStaticWave(decodedBuffer);
    }

    dragState = null;
  }

  function updateCanvasCursor(event) {
    if (!decodedBuffer || !els.editScope) return;
    const info = getCanvasEventInfo(event);
    const dur = decodedBuffer.duration || 1;
    const range = getSelectionRange();
    const playheadX = WAVE_PADDING.left + (playheadSec / dur) * info.innerW;

    let cursor = 'crosshair';
    if (info.y <= WAVE_PADDING.top && Math.abs(info.x - playheadX) <= HANDLE_GRAB_PX) {
      cursor = 'grab';
    } else if (range) {
      const [a, b] = range;
      const x1 = WAVE_PADDING.left + (a / dur) * info.innerW;
      const x2 = WAVE_PADDING.left + (b / dur) * info.innerW;
      if (Math.abs(info.x - x1) <= HANDLE_GRAB_PX || Math.abs(info.x - x2) <= HANDLE_GRAB_PX) {
        cursor = 'ew-resize';
      } else if (info.x >= x1 && info.x <= x2) {
        cursor = 'move';
      }
    }

    els.editScope.style.cursor = cursor;
  }

  function updateOverlayHandles() {
    if (!els.editWaveArea || !els.editScope || !decodedBuffer) return;
    if (els.editorModule?.classList.contains('hidden')) return;
    const rect = els.editScope.getBoundingClientRect();
    const innerW = Math.max(1, rect.width - WAVE_PADDING.left - WAVE_PADDING.right);
    const dur = decodedBuffer.duration || 1;

    if (els.playheadHandle) {
      const x = WAVE_PADDING.left + (clamp(playheadSec, 0, dur) / dur) * innerW;
      els.playheadHandle.style.display = 'block';
      els.playheadHandle.style.left = `${x - HANDLE_WIDTH_PX / 2}px`;
    }

    const range = getSelectionRange();
    if (!range) {
      if (els.selHandleL) els.selHandleL.style.display = 'none';
      if (els.selHandleR) els.selHandleR.style.display = 'none';
      return;
    }
    const [a, b] = range;
    const x1 = WAVE_PADDING.left + (a / dur) * innerW;
    const x2 = WAVE_PADDING.left + (b / dur) * innerW;

    const handleTop = WAVE_PADDING.top;
    const handleHeight = Math.max(1, rect.height - WAVE_PADDING.top - WAVE_PADDING.bottom);

    if (els.selHandleL) {
      els.selHandleL.style.display = 'block';
      els.selHandleL.style.left = `${x1 - HANDLE_WIDTH_PX}px`;
      els.selHandleL.style.top = `${handleTop}px`;
      els.selHandleL.style.height = `${handleHeight}px`;
      els.selHandleL.style.width = `${HANDLE_WIDTH_PX}px`;
      els.selHandleL.classList.add('left');
    }
    if (els.selHandleR) {
      els.selHandleR.style.display = 'block';
      els.selHandleR.style.left = `${x2}px`;
      els.selHandleR.style.top = `${handleTop}px`;
      els.selHandleR.style.height = `${handleHeight}px`;
      els.selHandleR.style.width = `${HANDLE_WIDTH_PX}px`;
      els.selHandleR.classList.remove('left');
    }
  }

  function handleKeyDown(event) {
    if (event.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
    if (event.key === 'Delete') {
      if (getSelectionRange()) {
        deleteSelection();
      }
    }
  }

  function resetMeterUI() {
    if (els.meterLabelL) els.meterLabelL.textContent = 'Mono';
    if (els.meterRowR) els.meterRowR.style.display = 'none';
    if (els.meterDbL) els.meterDbL.textContent = '-inf dB';
    if (els.meterDbR) els.meterDbR.textContent = '-inf dB';
    meterPeakL = { value: 0, holdUntil: 0, lastUpdate: 0 };
    meterPeakR = { value: 0, holdUntil: 0, lastUpdate: 0 };
    renderMeter(els.meterCanvasL, 0, 0);
    renderMeter(els.meterCanvasR, 0, 0);
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
    if (!meterAnalyserL || !els.meterCanvasL || !els.meterDbL) return;
    updateMeterFromAnalyser(meterAnalyserL, els.meterCanvasL, els.meterDbL, meterPeakL);
    if (meterChannelCount > 1 && meterAnalyserR && els.meterCanvasR && els.meterDbR) {
      updateMeterFromAnalyser(meterAnalyserR, els.meterCanvasR, els.meterDbR, meterPeakR);
    }
  }

  function updateMeterFromAnalyser(analyserNode, canvasEl, labelEl, peakState) {
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

    updatePeakState(peakState, percent);
    renderMeter(canvasEl, percent, peakState.value);
    labelEl.textContent = Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-inf dB';
  }

  function updatePeakState(state, percent) {
    const now = performance.now();
    if (percent >= state.value) {
      state.value = percent;
      state.holdUntil = now + METER_HOLD_MS;
      state.lastUpdate = now;
      return;
    }
    if (now < state.holdUntil) {
      state.lastUpdate = now;
      return;
    }
    const dt = state.lastUpdate ? now - state.lastUpdate : 0;
    if (dt > 0) {
      state.value = Math.max(percent, state.value - METER_DECAY_PER_MS * dt);
      state.lastUpdate = now;
    }
  }

  function renderMeter(canvas, percent, peakPercent) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const w = canvas.width;
    const h = canvas.height;
    const greenEnd = 0.7;
    const yellowEnd = 0.9;
    const filled = Math.max(0, Math.min(1, percent / 100));
    const peakX = Math.max(0, Math.min(1, peakPercent / 100)) * w;

    ctx.clearRect(0, 0, w, h);

    // Базовый фон
    ctx.fillStyle = 'rgba(39, 48, 67, 0.6)';
    ctx.fillRect(0, 0, w, h);

    // Цветные зоны
    ctx.fillStyle = '#8cffb3';
    ctx.fillRect(0, 0, w * greenEnd, h);
    ctx.fillStyle = '#ffd36b';
    ctx.fillRect(w * greenEnd, 0, w * (yellowEnd - greenEnd), h);
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(w * yellowEnd, 0, w * (1 - yellowEnd), h);

    // Маска справа от текущего уровня
    const maskStart = w * filled;
    if (maskStart < w) {
      ctx.fillStyle = 'rgba(16, 20, 27, 0.75)';
      ctx.fillRect(maskStart, 0, w - maskStart, h);
    }

    // Тики внутри полосы
    ctx.fillStyle = 'rgba(16, 20, 27, 0.6)';
    const ticks = [-60, -30, -18, -6, 0];
    for (const t of ticks) {
      const x = ((t + 60) / 60) * w;
      ctx.fillRect(Math.max(0, x - 0.5), 0, 1, h);
    }

    // Пик
    ctx.strokeStyle = '#e8edf5';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(peakX + 0.5, 0);
    ctx.lineTo(peakX + 0.5, h);
    ctx.stroke();
  }

  function resetPcmState() {
    pcmChunks = [];
    pcmFormat = null;
    totalFrames = 0;
  }

  function setButtons({ canRecord = false, isRecording = false, hasClip = false, hasSelection = false }) {
    els.btnInit.disabled = false;
    els.btnDisable.disabled = !canRecord;
    els.btnStart.disabled = !(canRecord && !isRecording);
    els.btnStop.disabled = !isRecording;
    els.btnClear.disabled = !(canRecord || hasClip);

    els.btnPlay.disabled = !hasClip;
    els.btnExportWav.disabled = !hasClip;
    els.btnDelete.disabled = !hasSelection || isRecording;
  }

  async function disableMic() {
    hideCompat();
    if (isPlaying) {
      stopPlayback(true);
    }
    if (pcmRecording) {
      stopRecording({ discard: true });
    }
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
    setRequestActualLabels({ srRequested: '—', srActual: '—', chRequested: '—', chActual: '—' });
    resetMeterUI();
    setStatus('не инициализировано');
    setButtons({ canRecord: false, isRecording: false, hasClip: false });
    setActiveModule('live');
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

  async function getUserMediaWithPreferredSampleRates(baseConstraints, preferredRates) {
    for (const rate of preferredRates) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...baseConstraints.audio,
            sampleRate: { exact: rate },
          },
        });
        return { stream, requestedSampleRate: rate, usedFallback: false };
      } catch (e) {
        const isConstraintError = e?.name === 'OverconstrainedError' || e?.name === 'ConstraintNotSatisfiedError';
        if (!isConstraintError) throw e;
      }
    }

    const result = await getUserMediaWithFallback({
      audio: {
        ...baseConstraints.audio,
      },
    });
    return { stream: result.stream, requestedSampleRate: null, usedFallback: result.usedFallback };
  }

  function applyClipBuffer(buffer) {
    decodedBuffer = buffer;
    clearSelection();
    setPlayhead(0);

    const dur = decodedBuffer.duration;
    els.sr.textContent = String(decodedBuffer.sampleRate);
    els.ch.textContent = String(decodedBuffer.numberOfChannels);
    els.dur.textContent = formatSec(dur);

    els.vizMode.textContent = 'static';
    setActiveModule('edit');
    requestAnimationFrame(() => {
      drawStaticWave(decodedBuffer);
    });

    setStatus('готово (клип загружен)');
    setButtons({ canRecord: true, isRecording: false, hasClip: true, hasSelection: false });
    updateOverlayHandles();
  }

  // ---------- Инициализация микрофона ----------
  async function initMic() {
    hideCompat();

    if (!navigator.mediaDevices?.getUserMedia) {
      showCompat('bad', 'Этот браузер не поддерживает getUserMedia(). Нужен современный Chrome/Edge/Firefox/Safari.');
      return;
    }

    if (pcmRecording) {
      stopRecording({ discard: true });
    }

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
    const channelCount = Number(els.channels.value) || 1;

    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: { ideal: channelCount },
        echoCancellation: !!els.ec.checked,
        noiseSuppression: !!els.ns.checked,
        autoGainControl: !!els.agc.checked,
      },
    };

    try {
      setStatus('запрашиваем доступ…');
      const result = await getUserMediaWithPreferredSampleRates(constraints, [48000, 44100]);
      stream = result.stream;
      if (result.usedFallback) {
        showCompat('warn', 'Не удалось применить частоту/каналы. Используются параметры устройства.');
      }

      const track = stream.getAudioTracks()[0];
      const settings = track?.getSettings?.();
      const actualSR = settings?.sampleRate || undefined;
      const requestedSR = result.requestedSampleRate;

      if (requestedSR && actualSR && requestedSR !== actualSR) {
        showCompat(
          'warn',
          `Запрошенная частота ${requestedSR} Hz не применена. Скорее всего в ОС задана другая частота, фактическая запись будет ${actualSR} Hz.`,
        );
      }

      // Контекст для визуализации и PCM-режима
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sourceNode = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      sourceNode.connect(analyser);

      await ensureWorkletNode();
      connectWorkletIfNeeded();

      const actualChannels = settings?.channelCount || channelCount;

      if (settings?.channelCount && settings.channelCount !== channelCount) {
        showCompat('warn', `Запрошено каналов: ${channelCount}. Браузер/ОС использует ${settings.channelCount}.`);
      }

      const actualSrLabel = actualSR || audioCtx.sampleRate;
      setPreferredSampleRateLabel(actualSrLabel);
      setRequestActualLabels({
        srRequested: requestedSR ? `${requestedSR} Hz` : '—',
        srActual: actualSrLabel ? `${actualSrLabel} Hz` : '—',
        chRequested: `${channelCount}`,
        chActual: `${actualChannels}`,
      });

      setupMeters(actualChannels);

      els.sr.textContent = String(audioCtx.sampleRate);
      els.ch.textContent = String(actualChannels);

      setStatus('готово');
      els.vizMode.textContent = 'live';
      drawLive();
      setActiveModule('live');

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
    if (isPlaying) stopPlayback(false);
    if (decodedBuffer) {
      resetEditedState();
    }

    if (!audioCtx) return;
    try {
      await ensureWorkletNode();
      connectWorkletIfNeeded();
    } catch (e) {
      showCompat('bad', 'AudioWorklet недоступен. Проверь поддержку браузера.');
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
    drawLive();
    setActiveModule('live');
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
  }

  // ---------- Редактирование: выделение/удаление/проигрывание ----------
  async function playSelectionOrFromPlayhead() {
    if (!decodedBuffer) return;
    if (isPlaying) {
      stopPlayback(false);
      return;
    }

    const range = getSelectionRange();
    const start = range ? range[0] : playheadSec;
    const end = range ? range[1] : decodedBuffer.duration;
    if (end - start <= 0.02) return;

    startPlayback(start, end);
  }

  function deleteSelection() {
    if (!decodedBuffer) return;
    const range = getSelectionRange();
    if (!range) return;

    const [a, b] = range;
    const sr = decodedBuffer.sampleRate;
    const numCh = decodedBuffer.numberOfChannels;
    const start = Math.floor(clamp(a, 0, decodedBuffer.duration) * sr);
    const end = Math.floor(clamp(b, 0, decodedBuffer.duration) * sr);

    if (end <= start) return;

    const newLength = decodedBuffer.length - (end - start);
    if (newLength <= 0) {
      showCompat('warn', 'Нельзя удалить весь клип целиком. Выдели меньший диапазон.');
      return;
    }
    hideCompat();

    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: sr });
    const outBuf = ctx.createBuffer(numCh, newLength, sr);

    for (let c = 0; c < numCh; c++) {
      const src = decodedBuffer.getChannelData(c);
      const dst = outBuf.getChannelData(c);
      dst.set(src.slice(0, start), 0);
      dst.set(src.slice(end), start);
    }

    decodedBuffer = outBuf;
    clearSelection();
    setPlayhead(a);

    els.dur.textContent = formatSec(decodedBuffer.duration);
    els.vizMode.textContent = 'static';
    drawStaticWave(decodedBuffer);

    setButtons({
      canRecord: !!stream,
      isRecording: false,
      hasClip: true,
      hasSelection: false,
    });

    try {
      ctx.close();
    } catch {}
  }

  function startPlayback(startSec, endSec) {
    stopPlayback(true);
    if (!audioCtx || !decodedBuffer) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    playbackSource = audioCtx.createBufferSource();
    playbackSource.buffer = decodedBuffer;
    playbackSource.connect(audioCtx.destination);

    playbackStartTime = audioCtx.currentTime;
    playbackStartSec = startSec;
    playbackEndSec = endSec;
    isPlaying = true;

    playbackSource.onended = () => {
      if (isPlaying) {
        stopPlayback(true);
      }
    };

    playbackSource.start(0, startSec, endSec - startSec);
    playbackRaf = requestAnimationFrame(updatePlaybackPosition);
  }

  function stopPlayback(fromEnded) {
    if (!isPlaying) return;
    isPlaying = false;

    if (playbackSource) {
      playbackSource.onended = null;
      try {
        playbackSource.stop();
      } catch {}
      playbackSource.disconnect();
      playbackSource = null;
    }

    if (playbackRaf) {
      cancelAnimationFrame(playbackRaf);
      playbackRaf = null;
    }

    if (fromEnded && decodedBuffer) {
      setPlayhead(playbackEndSec);
    }
    if (decodedBuffer) {
      drawStaticWave(decodedBuffer);
    }
  }

  function updatePlaybackPosition() {
    if (!isPlaying || !audioCtx) return;
    const elapsed = audioCtx.currentTime - playbackStartTime;
    const pos = playbackStartSec + elapsed;
    setPlayhead(pos);
    if (decodedBuffer) drawStaticWave(decodedBuffer);
    if (pos >= playbackEndSec) {
      stopPlayback(true);
      return;
    }
    playbackRaf = requestAnimationFrame(updatePlaybackPosition);
  }

  // ---------- Привязка интерфейса ----------
  // Первичный список устройств (названия могут быть пустыми до разрешения)
  if (navigator.mediaDevices?.enumerateDevices) {
    refreshDevices().catch(() => {});
  }

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
    setStatus(stream ? 'готово' : 'не инициализировано');
    if (analyser) drawLive();
    setButtons({ canRecord: !!stream, isRecording: false, hasClip: false });
    if (stream) {
      setActiveModule('live');
    }
  });

  els.btnPlay.addEventListener('click', playSelectionOrFromPlayhead);

  els.btnExportWav.addEventListener('click', () => {
    if (!decodedBuffer) return;
    const range = getSelectionRange();
    const a = range ? range[0] : 0;
    const b = range ? range[1] : decodedBuffer.duration;

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

  els.btnDelete.addEventListener('click', deleteSelection);

  const bindPointerDrag = (target) => {
    if (!target) return;
    target.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') {
        event.preventDefault();
      }
      target.setPointerCapture?.(event.pointerId);
      startCanvasDrag(event);
    });
    target.addEventListener('pointermove', (event) => {
      updateCanvasCursor(event);
      moveCanvasDrag(event);
    });
    target.addEventListener('pointerup', (event) => {
      endCanvasDrag(event);
      target.releasePointerCapture?.(event.pointerId);
    });
    target.addEventListener('pointercancel', (event) => {
      endCanvasDrag(event);
      target.releasePointerCapture?.(event.pointerId);
    });
    target.addEventListener('pointerleave', endCanvasDrag);
  };

  bindPointerDrag(els.editScope);
  bindPointerDrag(els.playheadHandle);
  window.addEventListener('keydown', handleKeyDown);

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
  if (!('AudioWorkletNode' in window)) {
    showCompat('bad', 'AudioWorklet не поддерживается в этом браузере.');
    setStatus('несовместимо');
  } else {
    setStatus('не инициализировано');
  }

  setActiveModule('live');
}
