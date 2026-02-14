import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const TTL_MS = 90_000;
const PRESENCE_BROADCAST_MS = 10_000;

app.use(cors({
  origin: CLIENT_ORIGIN === "*" ? "*" : [CLIENT_ORIGIN],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.get("/", (_, res) => res.send("OK"));

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN === "*" ? "*" : [CLIENT_ORIGIN],
    methods: ["GET", "POST"]
  }
});

// playerId -> { name, lastSeen, socketId, power, league, profile }
const players = new Map();
// roomId -> [{ name, text, ts }]
const chatHistory = new Map();

function normalizePower(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

function normalizeLeague(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function normalizeName(value) {
  const s = String(value || "Player").trim();
  return s ? s.slice(0, 48) : "Player";
}

function normalizeText(value, max = 64) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return s.slice(0, Math.max(1, Math.min(512, Math.round(Number(max) || 64))));
}

function normalizeAvatar(value) {
  const s = normalizeText(value, 512);
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("assets/") || s.startsWith("../../assets/")) {
    return s;
  }
  return "";
}

function normalizeCardsPreview(cardsLike) {
  if (!Array.isArray(cardsLike)) return [];
  const out = [];
  for (const row of cardsLike.slice(0, 9)) {
    const title = normalizeText(row?.title ?? row?.name, 48) || "Карта";
    const art = normalizeAvatar(row?.art ?? row?.image ?? row?.img ?? row?.avatar) || "";
    const power = normalizePower(row?.power ?? row?.basePower);
    const level = normalizePower(row?.level);
    const rarity = normalizeText(row?.rarity ?? row?.quality, 24);
    const element = normalizeText(row?.element, 16).toLowerCase();
    out.push({
      title,
      art,
      power,
      level,
      rarity,
      element
    });
  }
  return out;
}

function normalizeProfile(profileLike, fallbackName = "Player", fallbackPower = null, fallbackLeague = null) {
  const src = profileLike && typeof profileLike === "object" ? profileLike : {};
  const ratingsSrc = src.ratings && typeof src.ratings === "object" ? src.ratings : {};
  const duelSrc = src.duel && typeof src.duel === "object" ? src.duel : {};
  const bonusesSrc = src.bonuses && typeof src.bonuses === "object" ? src.bonuses : {};

  const profile = {
    version: 1,
    name: normalizeName(src.name || fallbackName || "Player"),
    title: normalizeText(src.title, 64),
    subtitle: normalizeText(src.subtitle, 64),
    avatar: normalizeAvatar(src.avatar),
    level: normalizePower(src.level) ?? 1,
    guildRank: normalizeText(src.guildRank, 48),
    ratings: {
      deck: normalizePower(ratingsSrc.deck ?? fallbackPower),
      duel: normalizePower(ratingsSrc.duel),
      arena: normalizePower(ratingsSrc.arena),
      tournament: normalizePower(ratingsSrc.tournament),
      league: normalizeText(ratingsSrc.league ?? fallbackLeague, 48)
    },
    duel: {
      played: normalizePower(duelSrc.played) ?? 0,
      wins: normalizePower(duelSrc.wins) ?? 0,
      losses: normalizePower(duelSrc.losses) ?? 0,
      draws: normalizePower(duelSrc.draws) ?? 0
    },
    bonuses: {
      xpPct: normalizePower(bonusesSrc.xpPct) ?? 0,
      silverPct: normalizePower(bonusesSrc.silverPct) ?? 0,
      guildPct: normalizePower(bonusesSrc.guildPct) ?? 0
    },
    daysInGame: normalizePower(src.daysInGame) ?? 0,
    lastLoginText: normalizeText(src.lastLoginText, 64),
    medalsCount: normalizePower(src.medalsCount) ?? 0,
    giftsCount: normalizePower(src.giftsCount) ?? 0,
    topCards: normalizeCardsPreview(src.topCards)
  };

  if (!profile.avatar) profile.avatar = "assets/cards/arts/fire_001.webp";
  if (!profile.title) profile.title = "Достойний маг";
  if (!profile.subtitle) profile.subtitle = "Боєвий дракон";
  if (!profile.ratings.league && fallbackLeague) profile.ratings.league = normalizeText(fallbackLeague, 48);
  if (profile.ratings.deck == null) profile.ratings.deck = fallbackPower == null ? 0 : normalizePower(fallbackPower) ?? 0;

  return profile;
}

function cleanupPresence(now = Date.now()) {
  for (const [id, p] of players.entries()) {
    if (!p || now - Number(p.lastSeen || 0) > TTL_MS) players.delete(id);
  }
}

function presenceSnapshot() {
  const now = Date.now();
  cleanupPresence(now);

  const list = [...players.entries()].map(([playerId, p]) => ({
    playerId,
    name: normalizeName(p?.name),
    power: normalizePower(p?.power),
    league: normalizeLeague(p?.league),
    avatar: normalizeAvatar(p?.profile?.avatar),
    level: normalizePower(p?.profile?.level),
    title: normalizeText(p?.profile?.title, 64),
    lastSeenMsAgo: Math.max(0, now - Number(p?.lastSeen || now))
  }));

  // Strongest first, then most recently seen.
  list.sort((a, b) => {
    const aPower = a.power == null ? -1 : a.power;
    const bPower = b.power == null ? -1 : b.power;
    if (bPower !== aPower) return bPower - aPower;

    if (a.lastSeenMsAgo !== b.lastSeenMsAgo) {
      return a.lastSeenMsAgo - b.lastSeenMsAgo;
    }

    return a.name.localeCompare(b.name, "uk", { sensitivity: "base" });
  });

  return { count: list.length, list };
}

app.get("/online", (req, res) => {
  const snapshot = presenceSnapshot();
  const q = String(req.query.q || "").trim().toLowerCase();
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(500, Math.round(limitRaw)))
    : 200;

  const filtered = q
    ? snapshot.list.filter((p) => String(p.name || "").toLowerCase().includes(q))
    : snapshot.list;

  res.json({ ok: true, count: filtered.length, list: filtered.slice(0, limit) });
});

app.get("/online/:playerId", (req, res) => {
  const id = String(req.params.playerId || "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "missing_player_id" });

  cleanupPresence();
  const p = players.get(id);
  if (!p) return res.status(404).json({ ok: false, error: "player_not_found" });

  const now = Date.now();
  const player = {
    playerId: id,
    name: normalizeName(p?.name),
    power: normalizePower(p?.power),
    league: normalizeLeague(p?.league),
    lastSeenMsAgo: Math.max(0, now - Number(p?.lastSeen || now)),
    profile: normalizeProfile(p?.profile, p?.name, p?.power, p?.league)
  };

  return res.json({ ok: true, player });
});

io.on("connection", (socket) => {
  socket.on("presence:hello", ({ playerId, name, power, league, profile } = {}) => {
    const id = String(playerId || "").trim();
    if (!id) return;

    const normName = normalizeName(name);
    const normPower = normalizePower(power);
    const normLeague = normalizeLeague(league);
    players.set(id, {
      name: normName,
      lastSeen: Date.now(),
      socketId: socket.id,
      power: normPower,
      league: normLeague,
      profile: normalizeProfile(profile, normName, normPower, normLeague)
    });

    const snapshot = presenceSnapshot();
    socket.emit("presence:update", snapshot);
    io.emit("presence:update", snapshot);
  });

  socket.on("presence:ping", ({ playerId, power, league, profile } = {}) => {
    const id = String(playerId || "").trim();
    if (!id) return;

    const p = players.get(id);
    if (!p) return;

    p.lastSeen = Date.now();
    if (power != null) p.power = normalizePower(power);
    if (league != null) p.league = normalizeLeague(league);
    if (profile && typeof profile === "object") {
      p.profile = normalizeProfile(profile, p.name, p.power, p.league);
    }
  });

  socket.on("chat:join", ({ roomId } = {}) => {
    const room = String(roomId || "").trim();
    if (!room) return;

    socket.join(room);
    const history = chatHistory.get(room) || [];
    socket.emit("chat:history", history.slice(-50));
  });

  socket.on("chat:msg", ({ roomId, playerId, text } = {}) => {
    const room = String(roomId || "").trim();
    const body = String(text || "").trim();
    if (!room || !body) return;

    const p = players.get(String(playerId || ""));
    const msg = {
      name: normalizeName(p?.name),
      text: body.slice(0, 240),
      ts: Date.now()
    };

    const arr = chatHistory.get(room) || [];
    arr.push(msg);
    chatHistory.set(room, arr.slice(-200));

    io.to(room).emit("chat:msg", msg);
  });

  // Duel skeleton
  socket.on("duel:queue", () => {
    socket.emit("duel:queued", { ok: true });
  });

  socket.on("duel:play", ({ matchId } = {}) => {
    const id = String(matchId || "").trim();
    if (!id) return;
    io.to(id).emit("duel:state", { ok: true });
  });

  socket.on("disconnect", () => {
    // Keep player record until TTL cleanup.
  });
});

const timer = setInterval(() => {
  io.emit("presence:update", presenceSnapshot());
}, PRESENCE_BROADCAST_MS);
if (typeof timer.unref === "function") timer.unref();

httpServer.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
