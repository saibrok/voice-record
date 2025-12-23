<template>
  <UiCard>
    <template #header>
      <div class="kpi">
        <span class="pill">Визуализация: <b id="vizMode">live</b></span>
        <span class="pill">In: <b id="inLabel">0.00s</b></span>
        <span class="pill">Out: <b id="outLabel">0.00s</b></span>
      </div>
    </template>

    <div class="canvasWrap">
      <canvas
        id="scope"
        width="1200"
        height="240"
      ></canvas>

      <LevelMeter />

      <div class="timeline">
        <div class="row">
          <div class="field">
            <label for="inPoint">In (сек)</label>
            <input
              id="inPoint"
              type="range"
              min="0"
              max="0"
              step="0.01"
              value="0"
              disabled
            />
          </div>
          <div class="field">
            <label for="outPoint">Out (сек)</label>
            <input
              id="outPoint"
              type="range"
              min="0"
              max="0"
              step="0.01"
              value="0"
              disabled
            />
          </div>
        </div>

        <div class="actions">
          <button
            id="btnPlay"
            disabled
          >
            Прослушать
          </button>
          <button
            id="btnExportWav"
            class="primary"
            disabled
          >
            Скачать WAV (Trim In/Out)
          </button>
          <button
            id="btnCut"
            disabled
          >
            Вырезать выделение (Cut) и заменить запись
          </button>
        </div>

        <div class="hint">
          Редактирование здесь намеренно минимальное: In/Out для trim, и один cut-сегмент (удалить выделение и «склеить»
          остальное). Для сложного монтажа лучше экспорт в WAV и работа в Audition/Reaper.
        </div>

        <audio
          id="player"
          controls
          style="width: 100%; display: none; margin-top: 8px"
        ></audio>
      </div>
    </div>
  </UiCard>
</template>

<script setup>
import UiCard from '../ui/UiCard.vue';
import LevelMeter from '../components/LevelMeter.vue';
</script>
