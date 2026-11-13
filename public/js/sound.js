// Web Audio ile üretilen ses efektleri, arka plan müziği ve sesli sayı okuma.
// Harici ses dosyası gerektirmez.

let ctx = null;
let master = null;
let musicGain = null;
let musicTimer = null;
let musicStep = 0;
const prefs = { sfx: true, music: false, speech: true };

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', vol = 0.2, attack = 0.005, dest } = {}) {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g);
  g.connect(dest || master);
  o.start(start);
  o.stop(start + dur + 0.05);
}

function noise(start, dur, vol = 0.15, freq = 1200) {
  const c = ac();
  if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(start);
}

export const sound = {
  setPrefs(p) {
    Object.assign(prefs, p);
    if (prefs.music) this.startMusic();
    else this.stopMusic();
  },
  unlock() {
    ac();
    if (prefs.music && !musicTimer) this.startMusic();
  },
  click() {
    if (!prefs.sfx || !ac()) return;
    tone(880, ctx.currentTime, 0.06, { type: 'triangle', vol: 0.06 });
  },
  select() {
    if (!prefs.sfx || !ac()) return;
    const t = ctx.currentTime;
    tone(660, t, 0.08, { type: 'triangle', vol: 0.08 });
    tone(990, t + 0.05, 0.1, { type: 'triangle', vol: 0.06 });
  },
  draw() {
    if (!prefs.sfx || !ac()) return;
    const t = ctx.currentTime;
    // makine sesi + top düşüşü
    for (let i = 0; i < 6; i++) noise(t + i * 0.07, 0.06, 0.08, 600 + Math.random() * 1400);
    tone(523, t + 0.5, 0.18, { type: 'sine', vol: 0.18 });
    tone(784, t + 0.6, 0.35, { type: 'sine', vol: 0.16 });
    tone(1046, t + 0.7, 0.4, { type: 'triangle', vol: 0.06 });
  },
  hit() {
    if (!prefs.sfx || !ac()) return;
    const t = ctx.currentTime;
    tone(1318, t, 0.12, { type: 'triangle', vol: 0.1 });
    tone(1760, t + 0.07, 0.16, { type: 'triangle', vol: 0.08 });
  },
  notify() {
    if (!prefs.sfx || !ac()) return;
    const t = ctx.currentTime;
    tone(784, t, 0.18, { vol: 0.12 });
    tone(1175, t + 0.12, 0.3, { vol: 0.1 });
  },
  error() {
    if (!prefs.sfx || !ac()) return;
    const t = ctx.currentTime;
    tone(300, t, 0.15, { type: 'sawtooth', vol: 0.05 });
    tone(220, t + 0.12, 0.22, { type: 'sawtooth', vol: 0.05 });
  },
  win() {
    if (!prefs.sfx || !ac()) return;
    const t = ctx.currentTime;
    const notes = [523, 659, 784, 1046, 784, 1046, 1318];
    notes.forEach((f, i) => {
      tone(f, t + i * 0.12, 0.35, { type: 'triangle', vol: 0.14 });
      tone(f / 2, t + i * 0.12, 0.35, { type: 'sine', vol: 0.08 });
    });
    [1046, 1318, 1568].forEach((f) => tone(f, t + 0.9, 1.4, { type: 'sine', vol: 0.09, attack: 0.02 }));
  },
  startMusic() {
    if (musicTimer || !prefs.music) return;
    const c = ac();
    if (!c || c.state !== 'running') return; // kullanıcı etkileşimi bekleniyor
    musicGain = c.createGain();
    musicGain.gain.value = 0.0001;
    musicGain.gain.exponentialRampToValueAtTime(0.5, c.currentTime + 2);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    musicGain.connect(lp);
    lp.connect(master);
    // Am - F - C - G ilerleyişi
    const chords = [
      [220, 261.6, 329.6],
      [174.6, 220, 261.6],
      [196 * 1.335, 329.6, 392],
      [196, 246.9, 293.7],
    ];
    const bar = 2.4;
    const play = () => {
      const t = c.currentTime + 0.05;
      const ch = chords[musicStep % chords.length];
      ch.forEach((f) => tone(f, t, bar + 0.4, { type: 'sine', vol: 0.05, attack: 0.6, dest: musicGain }));
      tone(ch[0] / 2, t, bar, { type: 'triangle', vol: 0.05, attack: 0.05, dest: musicGain });
      const arp = [ch[0] * 2, ch[1] * 2, ch[2] * 2, ch[1] * 2];
      arp.forEach((f, i) => tone(f, t + i * (bar / 4), 0.5, { type: 'triangle', vol: 0.025, dest: musicGain }));
      musicStep++;
    };
    play();
    musicTimer = setInterval(play, bar * 1000);
  },
  stopMusic() {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
    if (musicGain && ctx) {
      const g = musicGain;
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      setTimeout(() => g.disconnect(), 800);
    }
    musicGain = null;
  },
  speak(text) {
    if (!prefs.speech || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = 'tr-TR';
      const voice = speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith('tr'));
      if (voice) u.voice = voice;
      u.rate = 0.95;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* yoksay */
    }
  },
};
