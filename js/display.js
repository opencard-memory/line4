import { newCode, renderScreen, topicC2D, topicD2C } from "./common.js";
import { connectBroker } from "./link.js";

const $ = (id) => document.getElementById(id);
const screen = $("screen");
const wait = $("wait");
const codeEl = $("code");
const msgEl = $("waitMsg");
const soundHint = $("soundHint");

const CTRL_TIMEOUT = 12000; // 조작 화면 신호가 이 시간 동안 없으면 대기 화면으로
let client = null;
let code = null;
let lastRx = 0;

// ---- 전체화면 자동 전환 ----
// 브라우저는 클릭/터치 없이 전체화면을 허용하지 않으므로,
// 연결 시 먼저 시도하고 막히면 다음 클릭/터치 때 전환한다.
let autoFull = true;
function enterFullscreen() {
  if (document.fullscreenElement) { autoFull = false; return; }
  Promise.resolve(document.documentElement.requestFullscreen?.())
    .then(() => { autoFull = false; })
    .catch(() => {});
}
function onConnected() { autoFull = true; enterFullscreen(); }
["pointerdown", "touchend"].forEach((ev) =>
  document.addEventListener(ev, () => { if (autoFull) enterFullscreen(); }, true));

// ---- 소리 (조작 화면 명령으로 이 화면에서 재생) ----
let audio = null;
let pendingAudio = null; // 브라우저가 소리를 막았을 때, 클릭 후 재생할 항목
const SAFE_SRC = /^assets\/audio\/[\w.-]+$/;

function stopAudio() {
  pendingAudio = null;
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
    audio = null;
  }
}

function playAudio(src, announce) {
  stopAudio();
  if (!SAFE_SRC.test(src)) return;
  const a = new Audio(src);
  audio = a;
  a.addEventListener("ended", () => { if (announce) pub({ type: "audio-ended" }); });
  a.addEventListener("error", () => pub({ type: "audio-error" }));
  a.play().then(() => { soundHint.style.display = "none"; }).catch((e) => {
    console.warn("[오디오 재생 실패]", e);
    if (e.name === "NotAllowedError") {
      // 사용자가 이 화면을 한 번 클릭해야 소리가 허용됨
      pendingAudio = { src, announce };
      soundHint.style.display = "block";
    }
    pub({ type: "audio-error" });
  });
}

// 클릭/키 입력이 한 번이라도 있으면 소리 허용 -> 막혀 있던 소리 재생
function onUserGesture() {
  soundHint.style.display = "none";
  if (pendingAudio) {
    const { src, announce } = pendingAudio;
    pendingAudio = null;
    playAudio(src, announce);
  }
}
["pointerdown", "touchend", "keydown"].forEach((ev) =>
  document.addEventListener(ev, onUserGesture, true));

// 새로고침해도 같은 코드를 유지 (탭 단위)
function loadCode() {
  try {
    const c = sessionStorage.getItem("line4-code");
    if (/^\d{6}$/.test(c)) return c;
  } catch {}
  return newCode();
}
function saveCode(c) { try { sessionStorage.setItem("line4-code", c); } catch {} }

const setWaiting = (on) => wait.classList.toggle("hidden", !on);
const pub = (msg) => { if (client && client.connected) client.publish(topicD2C(code), JSON.stringify(msg)); };

function onMessage(topic, payload) {
  let m;
  try { m = JSON.parse(payload.toString()); } catch { return; }
  lastRx = Date.now();
  if (m.type === "hello") pub({ type: "ack" });
  else if (m.type === "state") {
    if (!wait.classList.contains("hidden")) onConnected(); // 대기 → 연결 전환 시
    setWaiting(false);
    renderScreen(screen, m.state);
  } else if (m.type === "audio") {
    if (m.cmd === "play") playAudio(String(m.src), !!m.announce);
    else if (m.cmd === "stop") stopAudio();
  }
}

async function start() {
  code = loadCode();
  saveCode(code);
  codeEl.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
  msgEl.textContent = "서버에 연결 중…";
  try {
    client = await connectBroker();
  } catch (e) {
    msgEl.textContent = "서버에 접속하지 못했습니다. 다시 시도하는 중…";
    setTimeout(start, 4000);
    return;
  }
  const sub = () => {
    client.subscribe(topicC2D(code));
    pub({ type: "ready" });
    msgEl.textContent = "연결 대기 중";
  };
  client.on("message", onMessage);
  client.on("connect", sub); // 재접속 시에도 다시 구독
  client.on("offline", () => { msgEl.textContent = "서버 연결이 끊겼습니다. 재접속 중…"; setWaiting(true); });
  sub();

  // 3초마다 생존 신호, 조작 화면 신호가 끊기면 대기 화면 복귀
  setInterval(() => {
    pub({ type: "alive" });
    if (!wait.classList.contains("hidden")) return;
    if (Date.now() - lastRx > CTRL_TIMEOUT) {
      msgEl.textContent = "조작 화면 신호가 없습니다. 대기 중";
      stopAudio();
      setWaiting(true);
    }
  }, 3000);
}

start();

document.addEventListener("keydown", (e) => {
  const k = e.key;
  if (k === "f" || k === "F") {
    autoFull = false; // 직접 조작하면 자동 전환은 끔
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  } else if (k.startsWith("Arrow")) {
    e.preventDefault();
    const [dx, dy] = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[k];
    pub({ type: "move", dx, dy });
  }
});
