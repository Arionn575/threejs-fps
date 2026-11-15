// Sound, synthesized with WebAudio: no audio files, no network. Everything
// is guarded so a browser without audio (or a headless test) never throws.
// The context is only created after a user gesture (unlock), so the game
// never trips the browser's autoplay warning on load or in a screenshot.
export function createSfx() {
  let ctx = null;
  let unlocked = false;

  function ensure() {
    if (!unlocked || ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = AC ? new AC() : null;
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function beep(freq, dur, gain = 0.12, type = 'sine') {
    const c = ensure();
    if (!c) return;
    try {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(gain, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      osc.connect(g).connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + dur);
    } catch {
      // Audio is decoration; a failure never stops the game.
    }
  }

  function noise(dur, gain = 0.2, freq = 1200) {
    const c = ensure();
    if (!c) return;
    try {
      const length = Math.max(1, Math.floor(c.sampleRate * dur));
      const buffer = c.createBuffer(1, length, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const src = c.createBufferSource();
      src.buffer = buffer;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = freq;
      const g = c.createGain();
      g.gain.value = gain;
      src.connect(filter).connect(g).connect(c.destination);
      src.start();
    } catch {
      // Audio is decoration; a failure never stops the game.
    }
  }

  return {
    unlock() {
      unlocked = true;
      const c = ensure();
      if (c && c.state === 'suspended') c.resume().catch(() => {});
    },
    shot() {
      noise(0.09, 0.22, 1600);
    },
    enemyShot() {
      noise(0.07, 0.08, 900);
    },
    hit() {
      beep(1400, 0.05, 0.1, 'square');
    },
    kill() {
      beep(880, 0.08, 0.12, 'square');
      beep(1320, 0.1, 0.12, 'square');
    },
    reload() {
      beep(520, 0.06, 0.08);
    },
    plant() {
      beep(660, 0.1, 0.12);
      beep(990, 0.14, 0.12);
    },
    bombBeep() {
      beep(1100, 0.07, 0.1, 'square');
    },
    explosion() {
      noise(0.6, 0.5, 320);
      beep(70, 0.5, 0.3, 'sine');
    },
    roundWin() {
      beep(523, 0.12, 0.12);
      beep(659, 0.12, 0.12);
      beep(784, 0.2, 0.12);
    },
    roundLose() {
      beep(392, 0.15, 0.12);
      beep(311, 0.25, 0.12);
    },
  };
}
