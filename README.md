# NEON PONG

Node.js, Express, Socket.IO 기반 서버 권한형 실시간 1대1 핑퐁입니다.

## 실행

```bash
npm install
npm start
```

`http://localhost:3000`에서 실행됩니다. 키보드 `W`/`S` 또는 방향키, 모바일 화면의 터치 버튼을 지원합니다.

## Render

GitHub 저장소에 올린 후 Render에서 Blueprint로 연결하면 `render.yaml`이 설정을 구성합니다. 일반 Web Service라면 Build Command는 `npm ci`, Start Command는 `npm start`입니다. 방 정보는 메모리에만 유지되며 서버 재시작 시 사라집니다.
