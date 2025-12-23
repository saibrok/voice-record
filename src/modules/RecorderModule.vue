<template>
  <UiCard>
    <template #header>
      <div class="kpi">
        <span class="pill">Статус: <b id="status">не инициализировано</b></span>
        <span class="pill">Sample rate: <b id="sr">—</b></span>
        <span class="pill">Каналы: <b id="ch">—</b></span>
        <span class="pill">Длина: <b id="dur">—</b></span>
      </div>
    </template>

    <div class="field">
      <label for="deviceSelect">Устройство ввода (микрофон)</label>
      <select id="deviceSelect"></select>
      <div class="hint">Список устройств появляется корректно после первого разрешения на доступ к микрофону.</div>
    </div>

    <div
      class="row"
      style="margin-top: 10px"
    >
      <div class="field">
        <label>Частота записи (Hz)</label>
        <div class="pill"><b id="preferSRLabel">—</b></div>
        <div class="hint">Запрошено: <b id="srRequested">—</b> · Фактически: <b id="srActual">—</b></div>
      </div>
      <div class="field">
        <label for="channels">Каналы</label>
        <select id="channels">
          <option
            value="1"
            selected
          >
            Mono (1)
          </option>
          <option value="2">Stereo (2)</option>
        </select>
        <div class="hint">Запрошено: <b id="chRequested">—</b> · Фактически: <b id="chActual">—</b></div>
      </div>
    </div>

    <div
      class="row"
      style="margin-top: 10px"
    >
      <div class="field">
        <label>DSP в getUserMedia</label>
        <div class="hint">
          <label class="small"
            ><input
              type="checkbox"
              id="ec"
            />
            Echo cancellation</label
          ><br />
          <label class="small"
            ><input
              type="checkbox"
              id="ns"
            />
            Noise suppression</label
          ><br />
          <label class="small"
            ><input
              type="checkbox"
              id="agc"
            />
            Auto gain control</label
          >
          <br />
          <label class="small"
            ><input
              type="checkbox"
              id="vi"
            />
            Voice isolation</label
          >
        </div>
      </div>
      <div class="field">
        <label>Формат записи</label>
        <div class="pill"><b>PCM/WAV (без сжатия)</b></div>
        <div class="hint">Запись идёт без сжатия, экспорт — WAV 16-bit.</div>
      </div>
    </div>

    <div class="actions">
      <button
        id="btnInit"
        class="primary"
      >
        Инициализировать микрофон
      </button>
      <button
        id="btnDisable"
        disabled
      >
        Отключить микрофон
      </button>
      <button
        id="btnStart"
        class="primary"
        disabled
      >
        Начать запись
      </button>
      <button
        id="btnStop"
        class="danger"
        disabled
      >
        Остановить
      </button>
      <button
        id="btnClear"
        disabled
      >
        Сбросить
      </button>
    </div>

    <div
      id="compat"
      class="msg warn"
      style="display: none"
    ></div>
    <div
      id="log"
      class="msg mono"
      style="display: none"
    ></div>
    <pre
      id="settings"
      class="msg mono"
      style="display: none"
    ></pre>
  </UiCard>
</template>

<script setup>
import UiCard from '../ui/UiCard.vue';
</script>
