<template>
  <div class="row">
    <div class="field">
      <label>In (сек)</label>
      <div class="pill"><b id="selInFooter">—</b></div>
    </div>
    <div class="field">
      <label>Out (сек)</label>
      <div class="pill"><b id="selOutFooter">—</b></div>
    </div>
    <div class="field">
      <label>Длина (сек)</label>
      <div class="pill"><b id="selLen">—</b></div>
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
      Скачать WAV
    </button>
    <button
      id="btnDelete"
      disabled
    >
      Удалить
    </button>
  </div>

  <div class="hint">
    Выделение: drag по канвасу. Перемещение: drag внутри выделения. Resize: тянуть за края. Delete — удалить выделение.
    Если выделения нет — воспроизведение идёт от текущей позиции.
  </div>
</template>
