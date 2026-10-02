import {
  activeStations, allImages, CHANNEL_NAME, IMAGE_DELAY, initialState, OFFSET_STEP, renderScreen,
} from "./common.js";

const $ = (id) => document.getElementById(id);
const state = initialState();
const channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;

let displayWin = null;
let loopTimer = null;
let audio = null; // 현재 재생 중인 Audio
let isPlayingAnnounce = false;

// ---------- 화면 갱신 ----------
function sync() {
  renderScreen($("screen"), state);
  channel?.postMessage({ type: "state", state });

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
function stopAudio() {
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
  isPlayingAnnounce = false;
}

function playAudio(src, isAnnounce = false) {
  stopAudio();
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

// ---------- 표시화면 창 / 전체화면 / 위치조절 ----------
$("btnOpen").onclick = () => {
  displayWin = window.open("display.html", "line4-display", "width=1280,height=720");
  if (!displayWin) alert("팝업이 차단되었습니다. 팝업 허용 후 다시 눌러주세요.");
};

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
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case "f": case "F": toggleFullscreen(); break;
    case "ArrowUp": e.preventDefault(); moveText(0, -1); break;
    case "ArrowDown": e.preventDefault(); moveText(0, 1); break;
    case "ArrowLeft": e.preventDefault(); moveText(-1, 0); break;
    case "ArrowRight": e.preventDefault(); moveText(1, 0); break;
  }
});

// 별도 표시화면 창과 통신
channel && (channel.onmessage = (e) => {
  const m = e.data;
  if (m.type === "hello") {
    channel.postMessage({ type: "state", state });
    $("linkBadge").classList.add("on");
    $("linkBadge").textContent = "표시화면 연결됨";
  } else if (m.type === "move") {
    moveText(m.dx, m.dy);
  }
});
window.addEventListener("beforeunload", () => channel?.postMessage({ type: "bye" }));

// ---------- 시작 ----------
allImages().forEach((src) => { const i = new Image(); i.src = src; }); // 미리 불러오기
restartLoop();
sync();
