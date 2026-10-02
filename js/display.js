import { CHANNEL_NAME, renderScreen } from "./common.js";

const channel = new BroadcastChannel(CHANNEL_NAME);
const screen = document.getElementById("screen");
const wait = document.getElementById("wait");

channel.onmessage = (e) => {
  const m = e.data;
  if (m.type === "state") {
    wait.classList.add("hidden");
    renderScreen(screen, m.state);
  }
};
channel.postMessage({ type: "hello" });
// 조작 화면이 늦게 열려도 연결되도록 주기적으로 재요청
const retry = setInterval(() => {
  if (wait.classList.contains("hidden")) return clearInterval(retry);
  channel.postMessage({ type: "hello" });
}, 1000);

document.addEventListener("keydown", (e) => {
  const k = e.key;
  if (k === "f" || k === "F") {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  } else if (k.startsWith("Arrow")) {
    e.preventDefault();
    const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[k];
    channel.postMessage({ type: "move", dx: d[0], dy: d[1] });
  }
});
