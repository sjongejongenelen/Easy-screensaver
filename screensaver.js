const screenEl = document.querySelector("#screen");
const waterCanvas = document.querySelector("#water");
const floater = document.querySelector("#floater");
const cornerFlash = document.querySelector("#cornerFlash");
const cornerHitsEl = document.querySelector("#cornerHits");
const musicEl = document.querySelector("#music");
const audioButton = document.querySelector("#audioButton");
const resetButton = document.querySelector("#resetButton");
const pauseButton = document.querySelector("#pauseButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const ctx = waterCanvas.getContext("2d", { alpha: true });

const state = {
  width: 0,
  height: 0,
  dpr: 1,
  maxX: 1,
  maxY: 1,
  route: null,
  lastTime: 0,
  paused: false,
  cornerHits: 0,
  wakeTimer: 0,
  ripples: [],
  edgeMarks: [],
  x: 0,
  y: 0,
  directionX: 1,
  directionY: 1,
  audio: {
    context: null,
    master: null,
    waterGain: null,
    waterSource: null,
    enabled: true,
    unlocked: false
  }
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const easeLinear = (value) => value;

function updateAudioUi() {
  document.body.classList.toggle("audio-muted", !state.audio.enabled);
  document.body.classList.toggle("audio-needs-start", state.audio.enabled && !state.audio.unlocked);
  audioButton.setAttribute("aria-label", state.audio.enabled ? "Geluid uitzetten" : "Geluid aanzetten");
  audioButton.setAttribute("title", state.audio.enabled ? "Geluid uit" : "Geluid aan");
}

function createNoiseBuffer(audioContext, seconds) {
  const sampleRate = audioContext.sampleRate;
  const buffer = audioContext.createBuffer(1, Math.floor(sampleRate * seconds), sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * 0.72;
  }

  return buffer;
}

function setupAudioGraph() {
  if (state.audio.context) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    state.audio.enabled = false;
    updateAudioUi();
    return;
  }

  const audioContext = new AudioContextClass();
  const master = audioContext.createGain();
  const waterGain = audioContext.createGain();
  const waterFilter = audioContext.createBiquadFilter();
  const waterSource = audioContext.createBufferSource();

  master.gain.value = 0.72;
  waterGain.gain.value = 0;
  waterFilter.type = "lowpass";
  waterFilter.frequency.value = 780;
  waterFilter.Q.value = 0.65;

  waterSource.buffer = createNoiseBuffer(audioContext, 3.5);
  waterSource.loop = true;
  waterSource.connect(waterFilter);
  waterFilter.connect(waterGain);
  waterGain.connect(master);
  master.connect(audioContext.destination);
  waterSource.start();

  state.audio.context = audioContext;
  state.audio.master = master;
  state.audio.waterGain = waterGain;
  state.audio.waterSource = waterSource;
}

async function startAudio() {
  if (!state.audio.enabled) return false;

  setupAudioGraph();

  const audioContext = state.audio.context;
  if (audioContext && audioContext.state !== "running") {
    try {
      await audioContext.resume();
    } catch {
      state.audio.unlocked = false;
      updateAudioUi();
      return false;
    }
  }

  if (state.audio.waterGain && audioContext) {
    state.audio.waterGain.gain.cancelScheduledValues(audioContext.currentTime);
    state.audio.waterGain.gain.setTargetAtTime(0.026, audioContext.currentTime, 0.6);
  }

  musicEl.volume = 0.58;
  musicEl.loop = true;

  try {
    await musicEl.play();
    state.audio.unlocked = true;
    updateAudioUi();
    return true;
  } catch {
    state.audio.unlocked = false;
    updateAudioUi();
    return false;
  }
}

function stopAudio() {
  const audioContext = state.audio.context;

  musicEl.pause();

  if (state.audio.waterGain && audioContext) {
    state.audio.waterGain.gain.cancelScheduledValues(audioContext.currentTime);
    state.audio.waterGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.12);
  }

  state.audio.unlocked = false;
  updateAudioUi();
}

function playBumpSound(kind = "edge") {
  const audioContext = state.audio.context;
  if (!state.audio.enabled || !state.audio.unlocked || !audioContext || !state.audio.master) return;

  const now = audioContext.currentTime;
  const strength = kind === "corner" ? 1 : 0.68;
  const splashGain = audioContext.createGain();
  const splashFilter = audioContext.createBiquadFilter();
  const splash = audioContext.createBufferSource();
  const knockGain = audioContext.createGain();
  const knock = audioContext.createOscillator();

  splash.buffer = createNoiseBuffer(audioContext, 0.22);
  splashFilter.type = "bandpass";
  splashFilter.frequency.setValueAtTime(kind === "corner" ? 540 : 390, now);
  splashFilter.Q.value = 0.9;
  splashGain.gain.setValueAtTime(0.0001, now);
  splashGain.gain.exponentialRampToValueAtTime(0.09 * strength, now + 0.018);
  splashGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  splash.connect(splashFilter);
  splashFilter.connect(splashGain);
  splashGain.connect(state.audio.master);
  splash.start(now);
  splash.stop(now + 0.25);

  knock.type = "sine";
  knock.frequency.setValueAtTime(kind === "corner" ? 148 : 104, now);
  knock.frequency.exponentialRampToValueAtTime(kind === "corner" ? 78 : 62, now + 0.12);
  knockGain.gain.setValueAtTime(0.0001, now);
  knockGain.gain.exponentialRampToValueAtTime(0.055 * strength, now + 0.012);
  knockGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  knock.connect(knockGain);
  knockGain.connect(state.audio.master);
  knock.start(now);
  knock.stop(now + 0.18);
}

function reflectedPosition(unfolded, size) {
  if (size <= 0) return 0;
  const period = size * 2;
  const wrapped = ((unfolded % period) + period) % period;
  return wrapped <= size ? wrapped : period - wrapped;
}

function reflectedDirection(unfolded, size) {
  if (size <= 0) return 1;
  return Math.floor(unfolded / size) % 2 === 0 ? 1 : -1;
}

function resizeCanvas() {
  const bounds = screenEl.getBoundingClientRect();
  const floaterBounds = floater.getBoundingClientRect();
  state.width = Math.max(320, bounds.width);
  state.height = Math.max(240, bounds.height);
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  waterCanvas.width = Math.floor(state.width * state.dpr);
  waterCanvas.height = Math.floor(state.height * state.dpr);
  waterCanvas.style.width = `${state.width}px`;
  waterCanvas.style.height = `${state.height}px`;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

  state.maxX = Math.max(1, state.width - floaterBounds.width);
  state.maxY = Math.max(1, state.height - floaterBounds.height);

  if (!state.route) {
    const startX = state.maxX * 0.16;
    const startY = state.maxY * 0.28;
    state.route = {
      startX,
      startY,
      targetX: startX,
      targetY: startY,
      elapsed: 0,
      duration: 1,
      vx: 130,
      vy: 95
    };
    pickCornerRoute();
  } else {
    const progress = clamp(state.route.elapsed / state.route.duration, 0, 1);
    const currentX = state.route.startX + (state.route.targetX - state.route.startX) * progress;
    const currentY = state.route.startY + (state.route.targetY - state.route.startY) * progress;
    state.route.startX = currentX;
    state.route.startY = currentY;
    state.route.elapsed = 0;
    pickCornerRoute(currentX, currentY);
  }
}

function pickCornerRoute(fromX = state.route?.startX ?? 0, fromY = state.route?.startY ?? 0) {
  const maxX = Math.max(1, state.maxX);
  const maxY = Math.max(1, state.maxY);
  const baseSpeed = clamp(Math.hypot(state.width, state.height) * 0.045, 68, 126);
  const currentTurnX = Math.floor(fromX / maxX);
  const currentTurnY = Math.floor(fromY / maxY);
  const desiredSeconds = 72 + Math.random() * 42;
  let best = null;

  for (let stepX = 2; stepX <= 10; stepX += 1) {
    for (let stepY = 2; stepY <= 10; stepY += 1) {
      const targetX = (currentTurnX + stepX) * maxX;
      const targetY = (currentTurnY + stepY) * maxY;
      const dx = targetX - fromX;
      const dy = targetY - fromY;
      const length = Math.hypot(dx, dy);
      const duration = length / baseSpeed;
      const axisBalance = Math.abs(Math.abs(dx / Math.max(1, dy)) - 1.18);
      const score = Math.abs(duration - desiredSeconds) + axisBalance * 5;

      if (duration > 48 && duration < 145 && (!best || score < best.score)) {
        best = { targetX, targetY, duration, dx, dy, score };
      }
    }
  }

  if (!best) {
    const targetX = (currentTurnX + 5) * maxX;
    const targetY = (currentTurnY + 4) * maxY;
    const dx = targetX - fromX;
    const dy = targetY - fromY;
    best = {
      targetX,
      targetY,
      duration: Math.max(54, Math.hypot(dx, dy) / baseSpeed),
      dx,
      dy
    };
  }

  state.route = {
    startX: fromX,
    startY: fromY,
    targetX: best.targetX,
    targetY: best.targetY,
    elapsed: 0,
    duration: best.duration,
    vx: best.dx / best.duration,
    vy: best.dy / best.duration
  };
}

function addRipple(x, y, strength = 1, kind = "wake") {
  state.ripples.push({
    x,
    y,
    age: 0,
    life: kind === "corner" ? 1.75 : 1.35 + Math.random() * 0.55,
    radius: kind === "corner" ? 22 : 5 + Math.random() * 7,
    speed: kind === "corner" ? 110 : 30 + Math.random() * 12,
    strength,
    kind,
    wobble: Math.random() * Math.PI * 2
  });

  if (state.ripples.length > 90) {
    state.ripples.splice(0, state.ripples.length - 90);
  }
}

function addEdgeMark(x, y, axis) {
  state.edgeMarks.push({ x, y, axis, age: 0, life: 0.8 });

  if (state.edgeMarks.length > 28) {
    state.edgeMarks.shift();
  }
}

function triggerBump() {
  floater.classList.remove("bump");
  void floater.offsetWidth;
  floater.classList.add("bump");
  playBumpSound("edge");
}

function triggerCornerHit(x, y) {
  state.cornerHits += 1;
  cornerHitsEl.textContent = state.cornerHits;
  playBumpSound("corner");

  cornerFlash.style.left = `${x}px`;
  cornerFlash.style.top = `${y}px`;
  cornerFlash.classList.remove("show");
  void cornerFlash.offsetWidth;
  cornerFlash.classList.add("show");

  for (let i = 0; i < 10; i += 1) {
    addRipple(
      x + (Math.random() - 0.5) * 26,
      y + (Math.random() - 0.5) * 26,
      1.6,
      "corner"
    );
  }
}

function emitWake(dt, centerX, centerY) {
  state.wakeTimer += dt;
  if (state.wakeTimer < 0.085) return;
  state.wakeTimer = 0;

  const floaterBounds = floater.getBoundingClientRect();
  const trailX = centerX - state.directionX * floaterBounds.width * 0.26;
  const trailY = centerY - state.directionY * floaterBounds.height * 0.18;
  const spreadX = -state.directionY * floaterBounds.width * 0.12;
  const spreadY = state.directionX * floaterBounds.height * 0.05;

  addRipple(trailX + spreadX, trailY + spreadY, 0.48, "wake");
  addRipple(trailX - spreadX, trailY - spreadY, 0.36, "wake");
}

function drawWater(dt, centerX, centerY) {
  ctx.clearRect(0, 0, state.width, state.height);

  const time = performance.now() * 0.001;
  ctx.save();
  ctx.globalCompositeOperation = "screen";

  const fieldGradient = ctx.createRadialGradient(
    state.width * 0.64,
    state.height * 0.42,
    0,
    state.width * 0.64,
    state.height * 0.42,
    Math.max(state.width, state.height) * 0.72
  );
  fieldGradient.addColorStop(0, "rgba(210, 253, 255, 0.075)");
  fieldGradient.addColorStop(0.42, "rgba(82, 215, 250, 0.034)");
  fieldGradient.addColorStop(1, "rgba(0, 92, 145, 0)");
  ctx.fillStyle = fieldGradient;
  ctx.fillRect(0, 0, state.width, state.height);

  for (let i = 0; i < 38; i += 1) {
    const y = ((i / 38) * (state.height + 70) + Math.sin(time * 0.14 + i) * 18 - 35) % (state.height + 70);
    const alpha = 0.016 + Math.sin(time * 0.38 + i * 0.41) * 0.006;
    ctx.strokeStyle = `rgba(213, 252, 255, ${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = -70; x <= state.width + 70; x += 26) {
      const wave = Math.sin(x * 0.012 + time * 0.48 + i * 0.63) * 7;
      const drift = Math.cos(x * 0.006 + time * 0.2 + i) * 12;
      if (x === -70) {
        ctx.moveTo(x, y + wave + drift);
      } else {
        ctx.lineTo(x, y + wave + drift);
      }
    }

    ctx.stroke();
  }

  for (let i = 0; i < 30; i += 1) {
    const x = ((i / 30) * (state.width + 90) + Math.cos(time * 0.12 + i) * 22 - 45) % (state.width + 90);
    const alpha = 0.01 + Math.sin(time * 0.32 + i * 0.33) * 0.005;
    ctx.strokeStyle = `rgba(185, 246, 255, ${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let y = -80; y <= state.height + 80; y += 30) {
      const wave = Math.sin(y * 0.01 + time * 0.42 + i * 0.5) * 9;
      const drift = Math.cos(y * 0.005 + time * 0.18 + i) * 10;
      if (y === -80) {
        ctx.moveTo(x + wave + drift, y);
      } else {
        ctx.lineTo(x + wave + drift, y);
      }
    }

    ctx.stroke();
  }

  for (let i = 0; i < 80; i += 1) {
    const phase = i * 19.17;
    const x = ((Math.sin(phase) * 0.5 + 0.5) * state.width + time * (4 + (i % 4)) + i * 23) % state.width;
    const y = ((Math.cos(phase * 1.7) * 0.5 + 0.5) * state.height + time * (2 + (i % 5)) + i * 13) % state.height;
    const pulse = 0.5 + Math.sin(time * 0.85 + i) * 0.5;
    ctx.fillStyle = `rgba(226, 255, 255, ${0.012 + pulse * 0.024})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + pulse * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  const glow = ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, Math.max(80, state.width * 0.16));
  glow.addColorStop(0, "rgba(210, 254, 255, 0.1)");
  glow.addColorStop(0.4, "rgba(73, 212, 247, 0.052)");
  glow.addColorStop(1, "rgba(73, 212, 247, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, state.width, state.height);

  for (const ripple of state.ripples) {
    ripple.age += dt;
    const t = clamp(ripple.age / ripple.life, 0, 1);
    const radius = ripple.radius + ripple.speed * t;
    const alpha = (1 - t) * 0.35 * ripple.strength;
    const squeeze = ripple.kind === "wake" ? 0.58 + Math.sin(time * 1.2 + ripple.wobble) * 0.05 : 0.78;

    ctx.save();
    ctx.translate(ripple.x, ripple.y);
    ctx.scale(1, squeeze);
    ctx.rotate(Math.sin(time * 0.65 + ripple.wobble) * 0.12);
    ctx.strokeStyle = `rgba(226, 255, 255, ${alpha})`;
    ctx.lineWidth = ripple.kind === "corner" ? 2 : 1.35;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    if (ripple.kind === "wake") {
      ctx.strokeStyle = `rgba(52, 221, 255, ${alpha * 0.55})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.56, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  for (const mark of state.edgeMarks) {
    mark.age += dt;
    const t = clamp(mark.age / mark.life, 0, 1);
    const alpha = (1 - t) * 0.38;
    const length = 90 + 90 * t;
    const width = 10 + 28 * t;
    const gradient = mark.axis === "x"
      ? ctx.createLinearGradient(mark.x, mark.y - length, mark.x, mark.y + length)
      : ctx.createLinearGradient(mark.x - length, mark.y, mark.x + length, mark.y);

    gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
    gradient.addColorStop(0.5, `rgba(230, 255, 255, ${alpha})`);
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = width;
    ctx.beginPath();

    if (mark.axis === "x") {
      ctx.moveTo(mark.x, mark.y - length);
      ctx.lineTo(mark.x, mark.y + length);
    } else {
      ctx.moveTo(mark.x - length, mark.y);
      ctx.lineTo(mark.x + length, mark.y);
    }

    ctx.stroke();
  }

  ctx.restore();
  state.ripples = state.ripples.filter((ripple) => ripple.age < ripple.life);
  state.edgeMarks = state.edgeMarks.filter((mark) => mark.age < mark.life);
}

function updateFrame(timestamp) {
  if (!state.lastTime) state.lastTime = timestamp;
  const dt = Math.min(0.04, (timestamp - state.lastTime) / 1000);
  state.lastTime = timestamp;

  if (!state.paused && state.route) {
    const prevX = state.route.startX + (state.route.targetX - state.route.startX) * easeLinear(clamp(state.route.elapsed / state.route.duration, 0, 1));
    const prevY = state.route.startY + (state.route.targetY - state.route.startY) * easeLinear(clamp(state.route.elapsed / state.route.duration, 0, 1));

    state.route.elapsed = Math.min(state.route.duration, state.route.elapsed + dt);

    const progress = easeLinear(clamp(state.route.elapsed / state.route.duration, 0, 1));
    const unfoldedX = state.route.startX + (state.route.targetX - state.route.startX) * progress;
    const unfoldedY = state.route.startY + (state.route.targetY - state.route.startY) * progress;

    const prevTurnX = Math.floor(prevX / state.maxX);
    const prevTurnY = Math.floor(prevY / state.maxY);
    const turnX = Math.floor(unfoldedX / state.maxX);
    const turnY = Math.floor(unfoldedY / state.maxY);
    const hitX = turnX !== prevTurnX;
    const hitY = turnY !== prevTurnY;

    state.directionX = reflectedDirection(unfoldedX, state.maxX);
    state.directionY = reflectedDirection(unfoldedY, state.maxY);
    state.x = reflectedPosition(unfoldedX, state.maxX);
    state.y = reflectedPosition(unfoldedY, state.maxY);

    const floaterBounds = floater.getBoundingClientRect();
    const centerX = state.x + floaterBounds.width / 2;
    const centerY = state.y + floaterBounds.height / 2;
    const tilt = clamp(state.directionX * 2.8 + Math.sin(timestamp * 0.0009) * 1.3, -4.5, 4.5);

    floater.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) rotate(${tilt}deg)`;
    emitWake(dt, centerX, centerY);

    if (hitX || hitY) {
      triggerBump();
      if (hitX) addEdgeMark(state.x <= 1 ? 0 : state.width, centerY, "x");
      if (hitY) addEdgeMark(centerX, state.y <= 1 ? 0 : state.height, "y");
    }

    if (state.route.elapsed >= state.route.duration) {
      const cornerX = state.x <= state.maxX / 2 ? 0 : state.width;
      const cornerY = state.y <= state.maxY / 2 ? 0 : state.height;
      triggerCornerHit(cornerX, cornerY);
      pickCornerRoute(unfoldedX, unfoldedY);
    }

    drawWater(dt, centerX, centerY);
  } else {
    const floaterBounds = floater.getBoundingClientRect();
    drawWater(dt, state.x + floaterBounds.width / 2, state.y + floaterBounds.height / 2);
  }

  requestAnimationFrame(updateFrame);
}

resetButton.addEventListener("click", () => {
  startAudio();
  state.cornerHits = 0;
  cornerHitsEl.textContent = "0";
  state.ripples.length = 0;
  state.edgeMarks.length = 0;
  state.route = null;
  resizeCanvas();
});

audioButton.addEventListener("click", async () => {
  state.audio.enabled = !state.audio.enabled;

  if (state.audio.enabled) {
    await startAudio();
  } else {
    stopAudio();
  }

  updateAudioUi();
});

pauseButton.addEventListener("click", () => {
  startAudio();
  state.paused = !state.paused;
  document.body.classList.toggle("is-paused", state.paused);
  pauseButton.setAttribute("aria-label", state.paused ? "Afspelen" : "Pauze");
  pauseButton.setAttribute("title", state.paused ? "Afspelen" : "Pauze");
});

fullscreenButton.addEventListener("click", async () => {
  await startAudio();

  if (!document.fullscreenElement) {
    await screenEl.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
});

screenEl.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  startAudio();
}, { passive: true });

document.addEventListener("keydown", () => {
  startAudio();
}, { once: true });

window.addEventListener("resize", resizeCanvas, { passive: true });
window.addEventListener("orientationchange", resizeCanvas, { passive: true });

updateAudioUi();
startAudio();
resizeCanvas();
requestAnimationFrame(updateFrame);
