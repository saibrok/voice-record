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
      <div class="hint">
        Список устройств появляется корректно после первого разрешения на доступ к микрофону.
      </div>
    </div>

    <div
      class="row"
      style="margin-top: 10px"
    >
      <div class="field">
        <label for="preferSR">Желаемая частота (Hz)</label>
        <select id="preferSR">
          <option value="">По умолчанию устройства</option>
          <option value="8000">8000</option>
          <option value="16000">16000</option>
          <option value="22050">22050</option>
          <option value="32000">32000</option>
          <option value="44100">44100</option>
          <option
            value="48000"
            selected
          >
            48000
          </option>
          <option value="96000">96000</option>
        </select>
        <div class="hint">Фактическая частота зависит от устройства/ОС/браузера; будет показана сверху.</div>
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
        <div class="hint">Для дикторской записи обычно предпочтительнее Mono.</div>
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
              checked
            />
            Echo cancellation</label
          ><br />
          <label class="small"
            ><input
              type="checkbox"
              id="ns"
              checked
            />
            Noise suppression</label
          ><br />
          <label class="small"
            ><input
              type="checkbox"
              id="agc"
              checked
            />
            Auto gain control</label
          >
        </div>
        <div class="hint">
          Для диктора обычно лучше выключать EC/NS/AGC (сохраняет естественность и динамику), но это зависит от условий
          комнаты.
        </div>
      </div>
      <div class="field">
        <label for="recordMode">Режим записи</label>
        <select id="recordMode">
          <option
            value="pcm"
            selected
          >
            PCM/WAV (без сжатия)
          </option>
          <option value="compressed">Сжатая (MediaRecorder)</option>
        </select>
        <div class="hint">PCM даёт максимальное качество, но занимает больше памяти.</div>
      </div>
    </div>

    <div
      class="row"
      style="margin-top: 10px"
    >
      <div class="field">
        <label for="mime">Кодек (только для MediaRecorder)</label>
        <select id="mime"></select>
        <div class="hint">Для сравнения качества можно выбрать Opus/OGG/WebM.</div>
      </div>
    </div>

    <div class="actions">
      <button
        id="btnInit"
        class="primary"
      >
        1) Инициализировать микрофон
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
        2) Начать запись
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
  </UiCard>
</template>

<script setup>
import UiCard from '../ui/UiCard.vue';
</script>
