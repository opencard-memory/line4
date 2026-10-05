// 공개 MQTT(WebSocket) 중계 서버 접속. 서버가 막히면 다음 서버로 자동 전환.
import { BROKERS } from "./common.js";

const rand = () => Math.random().toString(36).slice(2, 10);

export function connectBroker() {
  return new Promise((resolve, reject) => {
    if (typeof mqtt === "undefined") {
      return reject(new Error("연결 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요."));
    }
    let i = 0;
    const tryNext = () => {
      if (i >= BROKERS.length) return reject(new Error("연결 서버에 접속하지 못했습니다."));
      const client = mqtt.connect(BROKERS[i++], {
        clientId: `line4lcd-${rand()}`,
        clean: true,
        keepalive: 30,
        reconnectPeriod: 0, // 접속 시도 중에는 자동 재시도 끔 (다음 서버로 넘어가기 위해)
        connectTimeout: 6000,
      });
      let done = false;
      const fail = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        client.end(true);
        tryNext();
      };
      const timer = setTimeout(fail, 7000);
      client.once("connect", () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        client.options.reconnectPeriod = 3000; // 접속 후에는 끊기면 자동 재접속
        resolve(client);
      });
      client.once("error", fail);
      client.once("close", fail);
    };
    tryNext();
  });
}
