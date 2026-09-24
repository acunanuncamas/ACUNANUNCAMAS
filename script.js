'use strict';

const intro = document.querySelector('#intro');
const video = document.querySelector('#intro-video');
const poster = document.querySelector('#poster');
const skipIntro = document.querySelector('#skip-intro');
const audioToggle = document.querySelector('#audio-toggle');
const audioIntro = new Audio('img/audio2.MP3');
const audioMain = new Audio('img/AUDIO1.MP3');
const audioOutro = new Audio('img/AUDIO3.MP3');
const audioMuted = localStorage.getItem('audio-muted') === 'true';
let activeAudio = audioIntro;
let audioStarted = false;
[audioIntro, audioMain, audioOutro].forEach((audio) => {
  audio.preload = 'auto';
  audio.volume = 0.35;
  audio.muted = audioMuted;
});
audioIntro.addEventListener('ended', () => playAudioTrack(audioMain));
audioMain.addEventListener('ended', () => playAudioTrack(audioOutro));
audioOutro.addEventListener('ended', () => playAudioTrack(audioIntro));
audioIntro.addEventListener('error', () => playAudioTrack(audioMain));
audioMain.addEventListener('error', () => playAudioTrack(audioOutro));
function startBackgroundAudio() {
  if (audioStarted) return;
  audioStarted = true;
  audioIntro.currentTime = 0;
  activeAudio = audioIntro;
  const playback = activeAudio.play();
  if (playback) playback.catch(() => {});
}
function playAudioTrack(audio) {
  activeAudio = audio;
  const playback = audio.play();
  if (playback) playback.catch(() => {});
}
function updateAudioToggle(muted) {
  audioToggle.classList.toggle('is-muted', muted);
  audioToggle.setAttribute('aria-pressed', String(muted));
  audioToggle.setAttribute('aria-label', muted ? 'Activar audio' : 'Silenciar audio');
}
audioToggle.addEventListener('click', () => {
  const muted = !audioIntro.muted;
  audioIntro.muted = muted;
  audioMain.muted = muted;
  audioOutro.muted = muted;
  localStorage.setItem('audio-muted', String(muted));
  updateAudioToggle(muted);
});
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const smallViewport = window.matchMedia('(max-width: 599px)');
const introFadeMs = 1400;
intro.style.setProperty('--intro-fade-duration', introFadeMs + 'ms');
let introFinished = false;
let introTimeout;

function showSkipIntro() {
  window.clearTimeout(introTimeout);
  skipIntro.hidden = false;
  skipIntro.classList.add('is-ready');
  skipIntro.focus({ preventScroll: true });
}

function finishIntro() {
  if (introFinished) return;
  introFinished = true;
  window.clearTimeout(introTimeout);

  let revealTimeout;
  let revealed = false;
  const revealPage = () => {
    if (revealed) return;
    revealed = true;
    window.clearTimeout(revealTimeout);
    intro.removeEventListener('transitionend', onFadeEnd);
    const restoreFocus = document.activeElement === skipIntro;
    intro.hidden = true;
    video.pause();
    startBackgroundAudio();
    audioToggle.hidden = false;
    updateAudioToggle(audioIntro.muted);
    poster.inert = false;
    // Only start the sequence once the video overlay has completely faded out.
    document.body.classList.remove('intro-playing');
    document.body.classList.add('page-revealed');
    if (restoreFocus) poster.focus({ preventScroll: true });
  };
  const onFadeEnd = (event) => {
    if (event.target === intro && event.propertyName === 'opacity') revealPage();
  };

  intro.addEventListener('transitionend', onFadeEnd);
  // Fallback if the browser does not dispatch the transition event.
  revealTimeout = window.setTimeout(revealPage, introFadeMs + 100);
  intro.classList.add('is-leaving');
}

if (reducedMotion.matches) {
  intro.hidden = false;
  poster.inert = true;
  document.body.classList.add('intro-playing');
  showSkipIntro();
} else {
  intro.hidden = false;
  poster.inert = true;
  document.body.classList.add('intro-playing');
  skipIntro.hidden = true;
  // Keep the final video frame visible until the visitor chooses to continue.
  video.addEventListener('ended', showSkipIntro, { once: true });
  video.addEventListener('error', showSkipIntro, { once: true });
  skipIntro.addEventListener('click', () => {
    startBackgroundAudio();
    finishIntro();
  });
  video.muted = true;
  video.defaultPlaybackRate = 1.5;
  video.playbackRate = 1.5;
  const playback = video.play();
  if (playback) playback.catch(showSkipIntro);
}

reducedMotion.addEventListener('change', (event) => {
  if (event.matches) showSkipIntro();
});

let vhsGlitchTimeout;
let vhsSignalTimeout;
function scheduleVhsGlitch() {
  if (reducedMotion.matches) return;
  const minDelay = smallViewport.matches ? 5000 : 3000;
  const maxDelay = smallViewport.matches ? 15000 : 12000;
  const delay = minDelay + Math.random() * (maxDelay - minDelay);
  vhsGlitchTimeout = window.setTimeout(() => {
    document.body.classList.add('vhs-glitch-active');
    window.setTimeout(() => {
      document.body.classList.remove('vhs-glitch-active');
      scheduleVhsGlitch();
    }, 70 + Math.random() * 70);
  }, delay);
}
scheduleVhsGlitch();

function scheduleVhsSignalClear() {
  if (reducedMotion.matches) return;
  const minDelay = smallViewport.matches ? 3500 : 2200;
  const maxDelay = smallViewport.matches ? 9000 : 7500;
  vhsSignalTimeout = window.setTimeout(() => {
    document.body.classList.add('vhs-signal-clear');
    window.setTimeout(() => {
      document.body.classList.remove('vhs-signal-clear');
      scheduleVhsSignalClear();
    }, 90 + Math.random() * 180);
  }, minDelay + Math.random() * (maxDelay - minDelay));
}
scheduleVhsSignalClear();
reducedMotion.addEventListener('change', (event) => {
  if (event.matches) {
    window.clearTimeout(vhsGlitchTimeout);
    window.clearTimeout(vhsSignalTimeout);
    document.body.classList.remove('vhs-glitch-active');
    document.body.classList.remove('vhs-signal-clear');
  } else {
    scheduleVhsGlitch();
    scheduleVhsSignalClear();
  }
});

const button = document.querySelector('#say-no');
const counter = document.querySelector('#counter');
const apiBase = 'https://mafia-tacna-api.acunanuncamas.workers.dev/api/counter';
let alreadyVoted = false;
let isSubmitting = false;
let pressTimeout;
let participationMessageTimeout;
const buttonLabel = button.querySelector('span');
const defaultButtonLabel = buttonLabel.textContent;
// Keep the existing visual feedback, even after this IP has participated.
button.addEventListener('click', () => {
  window.clearTimeout(pressTimeout);
  button.classList.add('is-pressed');
  pressTimeout = window.setTimeout(() => button.classList.remove('is-pressed'), 240);
  submitParticipation();
});

function showAlreadyVotedMessage() {
  window.clearTimeout(participationMessageTimeout);
  buttonLabel.textContent = 'YA TE SUMASTE ✓';
  participationMessageTimeout = window.setTimeout(() => {
    buttonLabel.textContent = defaultButtonLabel;
  }, 1800);
}
function updateCounter(value) {
  // Reject empty values, booleans and malformed responses instead of showing zero.
  const isNumeric = typeof value === 'number' ||
    (typeof value === 'string' && /^\d+$/.test(value));
  const numericValue = isNumeric ? Number(value) : NaN;
  const cells = counter.querySelectorAll('span');
  if (!Number.isSafeInteger(numericValue) || numericValue < 0 ||
      numericValue > 999999 || cells.length !== 6) {
    console.error('Invalid counter value or counter markup:', value);
    return false;
  }
  const formatted = String(numericValue).padStart(6, '0');
  cells.forEach((cell, index) => { cell.textContent = formatted[index]; });
  counter.dataset.value = formatted;
  counter.setAttribute('aria-label', `Participaciones: ${formatted}`);
  return true;
}

async function requestCounterApi(path = '', options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Counter API request failed: ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadCounterData() {
  // Independent requests: a status failure must not hide a valid counter response.
  const counterRequest = requestCounterApi()
    .then((data) => { updateCounter(data.value); })
    .catch((error) => { console.error('Unable to load counter:', error); });
  const statusRequest = requestCounterApi('/status')
    .then((data) => {
      if (typeof data.alreadyVoted !== 'boolean') {
        throw new Error('Invalid participation status response');
      }
      alreadyVoted = alreadyVoted || data.alreadyVoted;
    })
    .catch((error) => { console.error('Unable to load participation status:', error); });
  await Promise.all([counterRequest, statusRequest]);
}

async function submitParticipation() {
  if (alreadyVoted) {
    showAlreadyVotedMessage();
    return;
  }
  if (isSubmitting) return;
  isSubmitting = true;
  try {
    // Wait for both initial reads, avoiding a late GET overwriting the POST result.
    await initialCounterLoad;
    if (alreadyVoted) {
      showAlreadyVotedMessage();
      return;
    }
    const data = await requestCounterApi('/increment', { method: 'POST' });
    if (data.success !== true && data.alreadyVoted !== true) {
      throw new Error('Participation was not accepted by the API');
    }
    // Cloudflare is authoritative; never increment locally or persist IP status.
    alreadyVoted = true;
    updateCounter(data.value);
    if (data.alreadyVoted === true) showAlreadyVotedMessage();
  } catch (error) {
    console.error('Unable to submit participation:', error);
  } finally {
    isSubmitting = false;
  }
}

const initialCounterLoad = loadCounterData();
