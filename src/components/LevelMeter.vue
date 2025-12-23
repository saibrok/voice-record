<template>
  <div
    id="meterWrap"
    class="meter"
  >
    <div class="meterRow">
      <div
        id="meterLabelL"
        class="meterLabel"
      >
        Mono
      </div>
      <div class="meterBar">
        <canvas
          id="meterCanvasL"
          class="meterCanvas"
          width="600"
          height="16"
        ></canvas>
        <div class="meterTicks">
          <span>-60</span>
          <span>-30</span>
          <span>-18</span>
          <span>-6</span>
          <span>0</span>
        </div>
      </div>
      <div
        id="meterDbL"
        class="meterDb"
      >
        -inf dB
      </div>
    </div>

    <div
      id="meterRowR"
      class="meterRow"
      style="display: none"
    >
      <div
        id="meterLabelR"
        class="meterLabel"
      >
        R
      </div>
      <div class="meterBar">
        <canvas
          id="meterCanvasR"
          class="meterCanvas"
          width="600"
          height="16"
        ></canvas>
        <div class="meterTicks">
          <span>-60</span>
          <span>-30</span>
          <span>-18</span>
          <span>-6</span>
          <span>0</span>
        </div>
      </div>
      <div
        id="meterDbR"
        class="meterDb"
      >
        -inf dB
      </div>
    </div>

    <div class="hint">Пиковый уровень в dBFS, 0 dB — клиппинг.</div>
  </div>
</template>
