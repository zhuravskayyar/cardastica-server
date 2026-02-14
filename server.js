import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

app.use(cors({
  origin: CLIENT_ORIGIN === "*" ? "*" : [CLIENT_ORIGIN],
  methods: ["GET","POST"],
  allowedHeaders: ["Content-Type"]
}));

app.get("/", (_, res) => res.send("OK"));

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN === "*" ? "*" : [CLIENT_ORIGIN], methods: ["GET","POST"] }
});

// ===== In-memory state (потім можна винести у Redis/Postgres) =====
const TTL_MS = 90_000;
const players = new Map(); // playerId -> { name, lastSeen, socketId }
const chatHistory = new Map(); // roomId -> [{name,text,ts}]

function cleanupPresence() {
  const now = Date.now();
  for (const [id, p] of players.entries()) {
    if (now - p.lastSeen > TTL_MS) players.delete(id);
  }
}

function presenceSnapshot() {
  cleanupPresence();
  const list = [...players.entries()].map(([playerId, p]) => ({
    playerId,
    name: p.name,
    lastSeenMsAgo: Date.now() - p.lastSeen
  }));
  return { count: list.length, list };
}

// REST для дебагу / fallback
app.get("/online", (req, res) => {
  const snap = presenceSnapshot();
  res.json({ ok: true, ...snap });
});

// ===== Socket.IO =====
io.on("connection", (socket) => {
  // Presence
  socket.on("presence:hello", ({ playerId, name }) => {
    if (!playerId) return;
    players.set(String(playerId), {
      name: String(name || "Player"),
      lastSeen: Date.now(),
      socketId: socket.id
    });
    socket.emit("presence:update", presenceSnapshot());
    io.emit("presence:update", presenceSnapshot());
  });

  socket.on("presence:ping", ({ playerId }) => {
    const p = players.get(String(playerId));
    if (!p) return;
    p.lastSeen = Date.now();
  });

  // Chat
  socket.on("chat:join", ({ roomId }) => {
    if (!roomId) return;
    socket.join(String(roomId));
    const history = chatHistory.get(String(roomId)) || [];
    socket.emit("chat:history", history.slice(-50));
  });

  socket.on("chat:msg", ({ roomId, playerId, text }) => {
    if (!roomId || !text) return;
    const p = players.get(String(playerId));
    const msg = {
      name: p?.name || "Player",
      text: String(text).slice(0, 240),
      ts: Date.now()
    };
    const key = String(roomId);
    const arr = chatHistory.get(key) || [];
    arr.push(msg);
    chatHistory.set(key, arr.slice(-200));
    io.to(key).emit("chat:msg", msg);
  });

  // Duel (скелет для старту)
  socket.on("duel:queue", ({ playerId }) => {
    // TODO: матчинґ
    socket.emit("duel:queued", { ok: true });
  });

  socket.on("duel:play", ({ matchId, playerId, action }) => {
    // TODO: валідація і оновлення стану
    io.to(String(matchId)).emit("duel:state", { ok: true });
  });

  socket.on("disconnect", () => {
    // Не видаляємо миттєво — presence TTL сам прибере
  });
});

// broadcast presence раз на 10 сек (щоб UI був “живий”)
setInterval(() => {
  io.emit("presence:update", presenceSnapshot());
}, 10_000);

httpServer.listen(PORT, () => console.log("Server listening on", PORT));
