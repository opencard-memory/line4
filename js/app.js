import {
  activeStations, allImages, CODE_LENGTH, IMAGE_DELAY, initialState, OFFSET_STEP, renderScreen, topicC2D, topicD2C,
} from "./common.js";
import { connectBroker } from "./link.js";

const $ = (id) => document.getElementById(id);
const state = initialState();

let loopTimer = null;
let audio = null; // 현재 재생 중인 Audio
let isPlayingAnnounce = false;

// ---------- 화면 갱신 ----------
function sync() {
  renderScreen($("screen"), state);
  broadcast();

  const st = activeStations(state.direction)[state.stationIdx];
  $("dest").textContent = state.direction;
  $("current").textContent = st.name;
  $("btnStandby").classList.toggle("stop", state.isStandby);
  $("btnDeparture").textContent =
    ["출발화면/방송", "출발화면 표시중 (한 번 더: 방송)", "방송중 (한 번 더: 해제)"][state.departureState];
  $("btnDeparture").classList.toggle("stop", state.departureState > 0);

  const locked = state.departureState > 0;
  for (const id of ["btnDir", "btnDoor", "btnStandby", "btnPrev", "btnNext", "btnAnnounce"]) {
    $(id).disabled = locked;
  }
  $("btnAnnounce").textContent = isPlayingAnnounce ? "중 지" : "시 작";
  $("btnAnnounce").classList.toggle("stop", isPlayingAnnounce);
  $("btnPrev").disabled = locked || state.stationIdx <= 0;
  $("btnNext").disabled = locked || state.stationIdx >= activeStations(state.direction).length - 1;
}

// 이미지 순환 타이머 (5초마다, 대기/출발화면에서는 정지)
function restartLoop() {
  clearTimeout(loopTimer);
  loopTimer = setTimeout(function tick() {
    if (!state.isStandby && state.departureState === 0) {
      state.loopIdx += 1;
      sync();
    }
    loopTimer = setTimeout(tick, IMAGE_DELAY);
  }, IMAGE_DELAY);
}

// ---------- 오디오 ----------
// 표시화면이 연결되어 있으면 소리는 표시화면에서만 재생하고, 이 화면에서는 재생하지 않는다.
// 연결된 표시화면이 없을 때만 이 화면에서 재생한다.
const aliveCodes = () => [...links].filter(([, l]) => isAlive(l)).map(([c]) => c);

function stopLocalAudio() {
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}

function stopAudio() {
  stopLocalAudio();
  for (const code of links.keys()) pub(topicC2D(code), { type: "audio", cmd: "stop" });
  isPlayingAnnounce = false;
}

function playAudio(src, isAnnounce = false) {
  stopAudio();
  const remote = aliveCodes();
  if (remote.length > 0) {
    // 표시화면에서 재생
    isPlayingAnnounce = isAnnounce;
    for (const code of remote) pub(topicC2D(code), { type: "audio", cmd: "play", src, announce: isAnnounce });
    return;
  }
  // 표시화면이 없으면 이 화면에서 재생
  audio = new Audio(src);
  audio.addEventListener("ended", () => {
    if (isAnnounce) { isPlayingAnnounce = false; sync(); }
  });
  audio.addEventListener("error", () => {
    console.warn("[오디오 에러]", src);
    if (isAnnounce) { isPlayingAnnounce = false; sync(); }
  });
  isPlayingAnnounce = isAnnounce;
  audio.play().catch((e) => {
    console.warn("[오디오 재생 실패]", e);
    isPlayingAnnounce = false;
    sync();
  });
}

// ---------- 동작 ----------
const locked = () => state.departureState > 0;

function resetLoop() { state.loopIdx = 0; restartLoop(); }

$("btnDir").onclick = () => {
  if (locked()) return;
  state.direction = state.direction === "사당행" ? "진접행" : "사당행";
  state.stationIdx = 0;
  resetLoop();
  sync();
};

$("btnDoor").onclick = () => {
  if (locked()) return;
  playAudio("assets/audio/door.wav");
  sync();
};

$("btnStandby").onclick = () => {
  if (locked()) return;
  state.isStandby = !state.isStandby;
  sync();
};

$("btnDeparture").onclick = () => {
  state.departureState = (state.departureState + 1) % 3;
  if (state.departureState === 2) {
    const key = state.direction === "진접행" ? "to_jinjeop" : "to_sadang";
    playAudio(`assets/audio/departure_${key}.mp3`);
  }
  sync();
};

function changeStation(delta) {
  if (locked()) return;
  const list = activeStations(state.direction);
  const idx = state.stationIdx + delta;
  if (idx < 0 || idx >= list.length) return;
  state.stationIdx = idx;
  resetLoop();
  sync();
}
$("btnPrev").onclick = () => changeStation(-1);
$("btnNext").onclick = () => changeStation(1);

$("btnAnnounce").onclick = () => {
  if (locked()) return;
  if (isPlayingAnnounce) {
    stopAudio();
  } else {
    const st = activeStations(state.direction)[state.stationIdx];
    playAudio(`assets/audio/${st.id}_announce.${st.announce}`, true);
  }
  sync();
};

// ---------- 표시화면 연결 (6자리 코드) ----------
const ALIVE_MS = 12000; // 이 시간 동안 표시화면 신호가 없으면 "끊김"
const links = new Map(); // code -> { lastSeen, onAck }
let client = null;
let clientPromise = null;

const isAlive = (l) => Date.now() - l.lastSeen < ALIVE_MS;
const pub = (topic, msg) => { if (client && client.connected) client.publish(topic, JSON.stringify(msg)); };
const sendState = (code) => pub(topicC2D(code), { type: "state", state });

function broadcast() {
  for (const code of links.keys()) sendState(code);
}

function onMessage(topic, payload) {
  const code = topic.split("/")[2];
  const link = links.get(code);
  if (!link) return;
  let m;
  try { m = JSON.parse(payload.toString()); } catch { return; }
  const wasAlive = isAlive(link);
  link.lastSeen = Date.now();
  if (link.onAck) { link.onAck(); link.onAck = null; }
  if (!wasAlive) stopLocalAudio(); // 표시화면이 연결되면 이 화면의 소리는 끈다
  if (m.type === "ready" || !wasAlive) sendState(code); // 표시화면이 (재)시작되면 바로 현재 상태 전송
  if (m.type === "move") moveText(m.dx, m.dy);
  if ((m.type === "audio-ended" || m.type === "audio-error") && isPlayingAnnounce) {
    isPlayingAnnounce = false; // 표시화면에서 방송이 끝났거나 재생 실패
    sync();
  }
  renderLinks();
}

function getClient() {
  if (!clientPromise) {
    clientPromise = connectBroker()
      .then((c) => { client = c; c.on("message", onMessage); return c; })
      .catch((e) => { clientPromise = null; throw e; });
  }
  return clientPromise;
}

async function connectDisplay(code) {
  if (links.has(code)) throw new Error("이미 연결된 코드입니다.");
  const c = await getClient();
  await new Promise((res, rej) => c.subscribe(topicD2C(code), (err) => (err ? rej(err) : res())));
  const link = { lastSeen: 0, onAck: null };
  links.set(code, link);
  try {
    await new Promise((resolve, reject) => {
      const timers = [];
      const cleanup = () => timers.forEach(clearTimeout);
      link.onAck = () => { cleanup(); resolve(); };
      timers.push(setTimeout(() => { link.onAck = null; reject(new Error("해당 코드의 표시화면을 찾을 수 없습니다.")); }, 7000));
      const hello = () => pub(topicC2D(code), { type: "hello" });
      hello();
      timers.push(setTimeout(hello, 2500), setTimeout(hello, 5000)); // 신호가 유실될 수 있어 재전송
    });
  } catch (e) {
    links.delete(code);
    c.unsubscribe(topicD2C(code));
    throw e;
  }
  sendState(code);
  renderLinks();
}

function disconnectDisplay(code) {
  links.delete(code);
  client?.unsubscribe(topicD2C(code));
  renderLinks();
}

// 주기적으로 상태 전송(표시화면 생존 확인용) + 연결 상태 표시 갱신
setInterval(() => { broadcast(); renderLinks(); }, 3000);

const dialog = $("linkDialog");
const codeInput = $("codeInput");
const linkMsg = $("linkMsg");

function renderLinks() {
  const alive = [...links.values()].filter(isAlive).length;
  const badge = $("linkBadge");
  badge.classList.toggle("on", alive > 0);
  badge.textContent = alive > 0 ? `표시화면 ${alive}대 연결됨` : links.size > 0 ? "표시화면 신호 없음" : "표시화면 미연결";

  const ul = $("linkList");
  ul.replaceChildren();
  for (const [code, link] of links) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = `${code.slice(0, 3)} ${code.slice(3)} · ${isAlive(link) ? "연결됨" : "끊김(재연결 대기)"}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost";
    btn.textContent = "해제";
    btn.onclick = () => disconnectDisplay(code);
    li.append(span, btn);
    ul.append(li);
  }
}

function openLinkDialog() {
  linkMsg.textContent = "";
  linkMsg.classList.remove("err");
  try { codeInput.value = localStorage.getItem("line4-last-code") || ""; } catch { codeInput.value = ""; }
  renderLinks();
  dialog.showModal();
  codeInput.select();
}

$("btnLink").onclick = openLinkDialog;
$("btnLinkClose").onclick = () => dialog.close();
codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, CODE_LENGTH);
});

$("linkForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = codeInput.value.trim();
  linkMsg.classList.remove("err");
  if (code.length !== CODE_LENGTH) {
    linkMsg.classList.add("err");
    linkMsg.textContent = `${CODE_LENGTH}자리 숫자를 입력하세요.`;
    return;
  }
  const go = $("btnLinkGo");
  go.disabled = true;
  linkMsg.textContent = "연결 중…";
  try {
    await connectDisplay(code);
    try { localStorage.setItem("line4-last-code", code); } catch {}
    linkMsg.textContent = "연결되었습니다.";
    codeInput.value = "";
    setTimeout(() => { if (dialog.open) dialog.close(); }, 600);
  } catch (err) {
    linkMsg.classList.add("err");
    linkMsg.textContent = err.message;
  } finally {
    go.disabled = false;
  }
});

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else $("screen").requestFullscreen?.();
}
$("btnFull").onclick = toggleFullscreen;

function moveText(dx, dy) {
  state.offsetX += dx * OFFSET_STEP;
  state.offsetY += dy * OFFSET_STEP;
  sync();
}

document.addEventListener("keydown", (e) => {
  if (dialog.open || e.target.closest?.("input, textarea")) return; // 코드 입력 중에는 단축키 무시
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case "f": case "F": toggleFullscreen(); break;
    case "ArrowUp": e.preventDefault(); moveText(0, -1); break;
    case "ArrowDown": e.preventDefault(); moveText(0, 1); break;
    case "ArrowLeft": e.preventDefault(); moveText(-1, 0); break;
    case "ArrowRight": e.preventDefault(); moveText(1, 0); break;
  }
});

// ---------- 시작 ----------
allImages().forEach((src) => { const i = new Image(); i.src = src; }); // 미리 불러오기
restartLoop();
sync();
