import { newCode, renderScreen, topicC2D, topicD2C } from "./common.js";
import { connectBroker } from "./link.js";

const $ = (id) => document.getElementById(id);
const screen = $("screen");
const wait = $("wait");
const codeEl = $("code");
const msgEl = $("waitMsg");

const CTRL_TIMEOUT = 12000; // 조작 화면 신호가 이 시간 동안 없으면 대기 화면으로
let client = null;
let code = null;
let lastRx = 0;

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
    setWaiting(false);
    renderScreen(screen, m.state);
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
    if (Date.now() - lastRx > CTRL_TIMEOUT) { msgEl.textContent = "조작 화면 신호가 없습니다. 대기 중"; setWaiting(true); }
  }, 3000);
}

start();

document.addEventListener("keydown", (e) => {
  const k = e.key;
  if (k === "f" || k === "F") {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  } else if (k.startsWith("Arrow")) {
    e.preventDefault();
    const [dx, dy] = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[k];
    pub({ type: "move", dx, dy });
  }
});
