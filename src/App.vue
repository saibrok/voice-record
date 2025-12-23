<template>
  <div class="wrap">
    <h1>
      Запись аудио в браузере (без бэкенда): выбор устройства, визуализация, базовое редактирование (trim/cut), экспорт
      WAV
    </h1>

    <div class="grid">
      <RecorderModule />
      <div>
        <LiveModule />
        <EditorModule />
      </div>
    </div>

    <RecorderNotes />
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { setupRecorder } from './utils/recorder.js';
import RecorderModule from './modules/RecorderModule.vue';
import LiveModule from './modules/LiveModule.vue';
import EditorModule from './modules/EditorModule.vue';
import RecorderNotes from './components/RecorderNotes.vue';

onMounted(() => {
  setupRecorder();
});
</script>
