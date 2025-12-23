<template>
  <div id="editorModule">
    <UiCard>
      <template #header>
        <div class="kpi">
          <span class="pill">Визуализация: <b id="vizMode">static</b></span>
          <span class="pill">In: <b id="selIn">—</b></span>
          <span class="pill">Out: <b id="selOut">—</b></span>
          <span class="pill">Позиция: <b id="playPos">0.00s</b></span>
        </div>
      </template>

      <EditorWaveformCanvas />
      <EditorToolbar />
    </UiCard>
  </div>
</template>

<script setup>
import UiCard from '../ui/UiCard.vue';
import EditorWaveformCanvas from '../components/EditorWaveformCanvas.vue';
import EditorToolbar from '../components/EditorToolbar.vue';
</script>
