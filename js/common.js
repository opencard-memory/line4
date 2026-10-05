// 공통 설정 + 표시화면 렌더링 (index.html / display.html 에서 공유)

// 역 목록 (진접 -> 사당 방향)
export const BASE_STATIONS = [
  { id: "jinjeop", name: "진접", announce: "mp3", count: { to_sadang: 2, to_jinjeop: 2 } },
  { id: "ichon", name: "이촌", announce: "mp3", count: { to_sadang: 3, to_jinjeop: 3 } },
  { id: "dongjak", name: "동작", announce: "mp3", count: { to_sadang: 3, to_jinjeop: 3 } },
  { id: "chongshin", name: "총신대입구", announce: "wav", count: { to_sadang: 3, to_jinjeop: 3 } },
  { id: "sadang", name: "사당", announce: "mp3", count: { to_sadang: 3, to_jinjeop: 3 } },
];

export const DIRECTIONS = {
  진접행: "to_jinjeop",
  사당행: "to_sadang",
};

export const IMAGE_DELAY = 5000; // 5초마다 다음 이미지
// 인터넷 어디서든 연결되도록 공개 MQTT(WebSocket) 중계 서버를 사용 (앞에서부터 시도)
export const BROKERS = [
  "wss://broker.hivemq.com:8884/mqtt",
  "wss://broker.emqx.io:8084/mqtt",
  "wss://test.mosquitto.org:8081/mqtt",
];
export const CODE_LENGTH = 6;
export const OFFSET_STEP = 10; // 화살표 키 이동량 (1920x1080 기준 px)

// 6자리 무작위 숫자 코드 (표시화면이 생성)
export function newCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 10 ** CODE_LENGTH).padStart(CODE_LENGTH, "0");
}
// 조작 -> 표시 / 표시 -> 조작 채널 (코드별로 분리)
export const topicC2D = (code) => `line4lcd/v1/${code}/c2d`;
export const topicD2C = (code) => `line4lcd/v1/${code}/d2c`;

export function activeStations(direction) {
  const list = [...BASE_STATIONS];
  return direction === "진접행" ? list.reverse() : list;
}

export function initialState() {
  return {
    direction: "진접행",
    stationIdx: 0,
    isStandby: false,
    departureState: 0, // 0: 일반, 1: 출발화면, 2: 출발화면+방송
    loopIdx: 0,
    offsetX: 0,
    offsetY: 0,
  };
}

// 현재 상태에서 보여줄 이미지 경로 계산
export function currentImage(state) {
  const station = activeStations(state.direction)[state.stationIdx];
  const dirKey = DIRECTIONS[state.direction];
  if (state.departureState === 1 || state.departureState === 2) {
    return `assets/img/departure/${dirKey}.png`;
  }
  if (state.isStandby) {
    return `assets/img/${station.id}/standby.png`;
  }
  const n = station.count[dirKey];
  return `assets/img/${station.id}/${dirKey}/${(state.loopIdx % n) + 1}.png`;
}

// 모든 이미지 경로 (미리 불러오기용)
export function allImages() {
  const out = ["assets/img/departure/to_sadang.png", "assets/img/departure/to_jinjeop.png"];
  for (const s of BASE_STATIONS) {
    out.push(`assets/img/${s.id}/standby.png`);
    for (const [dir, n] of Object.entries(s.count)) {
      for (let i = 1; i <= n; i++) out.push(`assets/img/${s.id}/${dir}/${i}.png`);
    }
  }
  return out;
}

// 표시화면 DOM 갱신 (el: .screen 요소)
export function renderScreen(el, state) {
  const img = el.querySelector(".screen-img");
  const txt = el.querySelector(".screen-dest");
  const src = currentImage(state);
  if (img.getAttribute("src") !== src) img.setAttribute("src", src);
  txt.textContent = state.direction;
  // 원본: x = 화면너비-250, y = 30, 글자크기 60 (1920x1080 기준) -> 컨테이너 비율 단위로 환산
  txt.style.left = `calc(${((1920 - 250 + state.offsetX) / 1920) * 100}cqw)`;
  txt.style.top = `calc(${((30 + state.offsetY) / 1080) * 100}cqh)`;
}
