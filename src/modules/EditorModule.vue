<template>
  <UiCard>
    <template #header>
      <div class="kpi">
        <span class="pill">Визуализация: <b id="vizMode">live</b></span>
        <span class="pill">In: <b id="selIn">—</b></span>
        <span class="pill">Out: <b id="selOut">—</b></span>
        <span class="pill">Позиция: <b id="playPos">0.00s</b></span>
      </div>
    </template>

    <WaveformCanvas />
    <LevelMeter />
    <EditorToolbar />
  </UiCard>
</template>

<script setup>
import UiCard from '../ui/UiCard.vue';
import WaveformCanvas from '../components/WaveformCanvas.vue';
import LevelMeter from '../components/LevelMeter.vue';
import EditorToolbar from '../components/EditorToolbar.vue';
</script>
