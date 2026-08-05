const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['websocket', 'polling'] });

const PORT = process.env.PORT || 3000;
const WIDTH = 960;
const HEIGHT = 540;
const PADDLE_W = 18;
const PADDLE_H = 112;
const PADDLE_MARGIN = 38;
const PADDLE_SPEED = 430;
const BALL_RADIUS = 11;
const START_SPEED = 360;
const MAX_SPEED = 760;
const WIN_SCORE = 10;
const TICK_RATE = 60;
const rooms = new Map();
const socketRooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function initialBall(direction = Math.random() < 0.5 ? -1 : 1) {
  const angle = (Math.random() * 0.7 - 0.35);
  return {
    x: WIDTH / 2,
    y: HEIGHT / 2,
    vx: Math.cos(angle) * START_SPEED * direction,
    vy: Math.sin(angle) * START_SPEED,
    radius: BALL_RADIUS
  };
}

function makeRoom(code, hostId) {
  return {
    code,
    players: [hostId],
    paddles: [HEIGHT / 2 - PADDLE_H / 2, HEIGHT / 2 - PADDLE_H / 2],
    inputs: [{ up: false, down: false, targetY: null }, { up: false, down: false, targetY: null }],
    ball: initialBall(),
    scores: [0, 0],
    status: 'waiting',
    countdownEndsAt: 0,
    winner: null,
    serveAt: 0,
    lastTick: Date.now()
  };
}

function publicState(room) {
  return {
    code: room.code,
    status: room.status,
    paddles: room.paddles,
    paddleWidth: PADDLE_W,
    paddleHeight: PADDLE_H,
    paddleMargin: PADDLE_MARGIN,
    ball: room.ball,
    scores: room.scores,
    winner: room.winner,
    countdown: room.status === 'countdown' ? Math.max(0, Math.ceil((room.countdownEndsAt - Date.now()) / 1000)) : 0,
    width: WIDTH,
    height: HEIGHT
  };
}

function sendState(room) {
  io.to(room.code).emit('state', publicState(room));
}

function leaveCurrentRoom(socket) {
  const code = socketRooms.get(socket.id);
  if (!code) return;
  socketRooms.delete(socket.id);
  const room = rooms.get(code);
  if (!room) return;
  rooms.delete(code);
  for (const playerId of room.players) {
    socketRooms.delete(playerId);
    if (playerId !== socket.id) {
      const peer = io.sockets.sockets.get(playerId);
      if (peer) {
        peer.leave(code);
        peer.emit('opponentLeft');
      }
    }
  }
}

function startCountdown(room) {
  room.status = 'countdown';
  room.countdownEndsAt = Date.now() + 3000;
  room.paddles = [HEIGHT / 2 - PADDLE_H / 2, HEIGHT / 2 - PADDLE_H / 2];
  room.ball = { ...initialBall(), vx: 0, vy: 0 };
  sendState(room);
}

io.on('connection', (socket) => {
  socket.on('createRoom', (reply = () => {}) => {
    leaveCurrentRoom(socket);
    const code = makeCode();
    const room = makeRoom(code, socket.id);
    rooms.set(code, room);
    socketRooms.set(socket.id, code);
    socket.join(code);
    reply({ ok: true, code, player: 0, state: publicState(room) });
  });

  socket.on('joinRoom', (rawCode, reply = () => {}) => {
    const code = String(rawCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return reply({ ok: false, error: '방을 찾을 수 없습니다.' });
    if (room.players.length >= 2) return reply({ ok: false, error: '이미 가득 찬 방입니다.' });
    if (room.status !== 'waiting') return reply({ ok: false, error: '이미 게임이 시작된 방입니다.' });
    leaveCurrentRoom(socket);
    room.players.push(socket.id);
    socketRooms.set(socket.id, code);
    socket.join(code);
    reply({ ok: true, code, player: 1, state: publicState(room) });
    io.to(room.players[0]).emit('opponentJoined');
    startCountdown(room);
  });

  socket.on('input', (input) => {
    const room = rooms.get(socketRooms.get(socket.id));
    if (!room || room.status === 'finished') return;
    const index = room.players.indexOf(socket.id);
    if (index === -1) return;
    const targetY = Number.isFinite(input?.targetY)
      ? Math.max(0, Math.min(HEIGHT - PADDLE_H, input.targetY))
      : null;
    room.inputs[index] = { up: input?.up === true, down: input?.down === true, targetY };
  });

  socket.on('playAgain', () => {
    const room = rooms.get(socketRooms.get(socket.id));
    if (!room || room.players.length !== 2 || room.status !== 'finished') return;
    room.scores = [0, 0];
    room.winner = null;
    startCountdown(room);
  });

  socket.on('leaveRoom', () => leaveCurrentRoom(socket));
  socket.on('disconnect', () => leaveCurrentRoom(socket));
});

function resetAfterPoint(room, towardPlayer) {
  room.ball = { ...initialBall(towardPlayer === 0 ? -1 : 1), vx: 0, vy: 0 };
  room.serveDirection = towardPlayer === 0 ? -1 : 1;
  room.serveAt = Date.now() + 900;
}

function updateRoom(room, dt, now) {
  if (room.status === 'countdown') {
    if (now >= room.countdownEndsAt) {
      room.status = 'playing';
      room.ball = initialBall();
    }
    return;
  }
  if (room.status !== 'playing') return;

  for (let i = 0; i < 2; i++) {
    const input = room.inputs[i];
    if (input.targetY !== null) {
      const difference = input.targetY - room.paddles[i];
      const movement = Math.sign(difference) * Math.min(Math.abs(difference), PADDLE_SPEED * 1.35 * dt);
      room.paddles[i] = Math.max(0, Math.min(HEIGHT - PADDLE_H, room.paddles[i] + movement));
    } else {
      const direction = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      room.paddles[i] = Math.max(0, Math.min(HEIGHT - PADDLE_H, room.paddles[i] + direction * PADDLE_SPEED * dt));
    }
  }

  if (room.serveAt) {
    if (now < room.serveAt) return;
    room.ball = initialBall(room.serveDirection);
    room.serveAt = 0;
  }

  const ball = room.ball;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (ball.y - BALL_RADIUS <= 0 && ball.vy < 0) {
    ball.y = BALL_RADIUS;
    ball.vy *= -1;
  } else if (ball.y + BALL_RADIUS >= HEIGHT && ball.vy > 0) {
    ball.y = HEIGHT - BALL_RADIUS;
    ball.vy *= -1;
  }

  const paddleX = [PADDLE_MARGIN, WIDTH - PADDLE_MARGIN - PADDLE_W];
  for (let i = 0; i < 2; i++) {
    const movingToward = i === 0 ? ball.vx < 0 : ball.vx > 0;
    const overlapsX = ball.x + BALL_RADIUS >= paddleX[i] && ball.x - BALL_RADIUS <= paddleX[i] + PADDLE_W;
    const overlapsY = ball.y + BALL_RADIUS >= room.paddles[i] && ball.y - BALL_RADIUS <= room.paddles[i] + PADDLE_H;
    if (movingToward && overlapsX && overlapsY) {
      const relative = Math.max(-1, Math.min(1, (ball.y - (room.paddles[i] + PADDLE_H / 2)) / (PADDLE_H / 2)));
      const speed = Math.min(MAX_SPEED, Math.hypot(ball.vx, ball.vy) * 1.06);
      const angle = relative * (Math.PI / 3);
      ball.vx = Math.cos(angle) * speed * (i === 0 ? 1 : -1);
      ball.vy = Math.sin(angle) * speed;
      ball.x = i === 0 ? paddleX[i] + PADDLE_W + BALL_RADIUS : paddleX[i] - BALL_RADIUS;
    }
  }

  if (ball.x + BALL_RADIUS < 0 || ball.x - BALL_RADIUS > WIDTH) {
    const scorer = ball.x < 0 ? 1 : 0;
    room.scores[scorer]++;
    if (room.scores[scorer] >= WIN_SCORE) {
      room.status = 'finished';
      room.winner = scorer;
      room.ball = { ...ball, vx: 0, vy: 0 };
    } else {
      resetAfterPoint(room, scorer === 0 ? 1 : 0);
    }
  }
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const dt = Math.min(0.05, (now - room.lastTick) / 1000);
    room.lastTick = now;
    updateRoom(room, dt, now);
    sendState(room);
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => console.log(`Ping Pong server running on http://localhost:${PORT}`));
