"use strict";

function fieldRadio(volume) {
  let context;
  let master;
  const buffers = new Map();
  const levels = {key: .38, word: .63, miss: .55, ready: .85, start: .8, deploy: .48, breach: .38};
  function unlock() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio || !volume) return;
    try {
      if (!context) {
        context = new Audio();
        master = context.createGain();
        master.gain.value = volume;
        master.connect(context.destination);
        for (const [name, base64] of Object.entries(fieldSounds)) {
          const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
          buffers.set(name, context.decodeAudioData(bytes.buffer).catch(() => null));
        }
      }
      if (context.state !== "running") context.resume().catch(() => {});
    } catch { /* Controls and visual cues also work with audio disabled. */ }
  }
  for (const event of ["pointerdown", "keydown"]) document.addEventListener(event, unlock, {capture: true, passive: true});
  return {
    setVolume(next) {
      volume = next;
      if (master) master.gain.value = next;
      unlock();
    },
    async play(name) {
      if (!volume || document.hidden) return;
      unlock();
      if (context?.state !== "running") return;
      const buffer = await buffers.get(name);
      if (!buffer || !volume || document.hidden) return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      gain.gain.value = levels[name] ?? .85;
      if (name === "key") source.playbackRate.value = .95 + Math.random() * .10;
      source.buffer = buffer;
      source.connect(gain).connect(master);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start();
    },
  };
}
