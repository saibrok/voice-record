<template>
  <div id="liveModule">
    <UiCard>
      <template #header>
        <div class="kpi">
          <span class="pill">Визуализация: <b>live</b></span>
        </div>
      </template>

      <LiveWaveformCanvas />
      <LevelMeter />
    </UiCard>
  </div>
</template>

<script setup>
import UiCard from '../ui/UiCard.vue';
import LiveWaveformCanvas from '../components/LiveWaveformCanvas.vue';
import LevelMeter from '../components/LevelMeter.vue';
</script>
