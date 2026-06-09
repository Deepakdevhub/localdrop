/**
 * LocalDrop — WebSocket Signaling Server
 * Runs on your LAN. Brokers WebRTC handshakes only — no file data passes through.
 * All file bytes go peer-to-peer via WebRTC DataChannel.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;

// ─── HTTP server: serve index.html + static assets ───────────────────────────

const MIME = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".ico":  "image/x-icon",
  ".png":  "image/png",
};

const httpServer = http.createServer((req, res) => {
  let filePath = path.join(__dirname, "public", req.url === "/" ? "index.html" : req.url);
  const ext = path.extname(filePath);
  const mime = MIME[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // fallback: always serve index.html for SPA-style
      fs.readFile(path.join(__dirname, "public", "index.html"), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(d2);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
});

// ─── WebSocket signaling ──────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

/**
 * Room structure:
 * rooms = Map<roomId, { host: WebSocket, guests: Set<WebSocket> }>
 *
 * Message protocol (JSON over WS):
 *   client → server:
 *     { type: "create-room", roomId }
 *     { type: "join-room",   roomId }
 *     { type: "signal",      roomId, to, from, payload }   (offer/answer/ice)
 *     { type: "decline",     roomId, to }
 *     { type: "accept",      roomId, to }
 *     { type: "meta",        roomId, to, meta }
 *
 *   server → client:
 *     { type: "room-created",  roomId }
 *     { type: "room-joined",   roomId, peerId }
 *     { type: "peer-joined",   roomId, peerId }
 *     { type: "peer-left",     roomId, peerId }
 *     { type: "signal",        roomId, from, payload }
 *     { type: "decline" }
 *     { type: "accept",        from }
 *     { type: "meta",          from, meta }
 *     { type: "error",         message }
 *     { type: "room-full" }
 *     { type: "room-not-found" }
 */

const rooms = new Map(); // roomId → { host: ws, peers: Map<peerId, ws> }
let clientCounter = 0;

function genId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(room, obj, exceptWs = null) {
  if (!room) return;
  if (room.host && room.host !== exceptWs) send(room.host, obj);
  room.peers.forEach((ws) => { if (ws !== exceptWs) send(ws, obj); });
}

function removeClient(ws) {
  rooms.forEach((room, roomId) => {
    if (room.host === ws) {
      // host left — kill room, notify all peers
      broadcast(room, { type: "peer-left", peerId: "host", roomId }, ws);
      rooms.delete(roomId);
      console.log(`[room:${roomId}] host left → room closed`);
      return;
    }
    room.peers.forEach((peerWs, peerId) => {
      if (peerWs === ws) {
        room.peers.delete(peerId);
        broadcast(room, { type: "peer-left", peerId, roomId }, ws);
        console.log(`[room:${roomId}] peer ${peerId} left`);
      }
    });
  });
}

wss.on("connection", (ws, req) => {
  ws._id = genId() + (++clientCounter);
  const ip = req.socket.remoteAddress;
  console.log(`[ws] connected  id=${ws._id}  ip=${ip}`);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type, roomId } = msg;

    switch (type) {

      case "create-room": {
        const id = roomId || genId();
        if (rooms.has(id)) { send(ws, { type: "error", message: "Room already exists" }); return; }
        rooms.set(id, { host: ws, peers: new Map() });
        ws._roomId = id;
        ws._role = "host";
        send(ws, { type: "room-created", roomId: id });
        console.log(`[room:${id}] created by ${ws._id}`);
        break;
      }

      case "join-room": {
        const room = rooms.get(roomId);
        if (!room) { send(ws, { type: "room-not-found" }); return; }
        if (room.peers.size >= 10) { send(ws, { type: "room-full" }); return; }
        const peerId = ws._id;
        room.peers.set(peerId, ws);
        ws._roomId = roomId;
        ws._role = "peer";
        ws._peerId = peerId;
        send(ws, { type: "room-joined", roomId, peerId });
        send(room.host, { type: "peer-joined", roomId, peerId });
        console.log(`[room:${roomId}] peer ${peerId} joined`);
        break;
      }

      case "signal": {
        // forward WebRTC offer/answer/ICE candidates
        const room = rooms.get(roomId);
        if (!room) return;
        const { to, from, payload } = msg;
        const target = to === "host" ? room.host : room.peers.get(to);
        send(target, { type: "signal", roomId, from: from || ws._id, payload });
        break;
      }

      case "meta": {
        const room = rooms.get(roomId);
        if (!room) return;
        const { to, meta } = msg;
        const target = to === "host" ? room.host : room.peers.get(to);
        send(target, { type: "meta", from: ws._id, meta });
        break;
      }

      case "accept": {
        const room = rooms.get(roomId);
        if (!room) return;
        const { to } = msg;
        const target = to === "host" ? room.host : room.peers.get(to);
        send(target, { type: "accept", from: ws._id });
        break;
      }

      case "decline": {
        const room = rooms.get(roomId);
        if (!room) return;
        const { to } = msg;
        const target = to === "host" ? room.host : room.peers.get(to);
        send(target, { type: "decline", from: ws._id });
        break;
      }

      case "ping":
        send(ws, { type: "pong" });
        break;

      default:
        console.warn(`[ws] unknown type: ${type}`);
    }
  });

  ws.on("close", () => {
    console.log(`[ws] disconnected id=${ws._id}`);
    removeClient(ws);
  });

  ws.on("error", (err) => console.error(`[ws] error id=${ws._id}`, err.message));
});

// ─── Heartbeat — drop dead connections every 30s ──────────────────────────────

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws._alive === false) { ws.terminate(); return; }
    ws._alive = false;
    ws.ping();
  });
}, 30_000);

wss.on("connection", (ws) => { ws._alive = true; ws.on("pong", () => { ws._alive = true; }); });
wss.on("close", () => clearInterval(heartbeat));

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, "0.0.0.0", () => {
  const ifaces = require("os").networkInterfaces();
  const addrs = Object.values(ifaces).flat().filter(i => i.family === "IPv4" && !i.internal).map(i => i.address);
  console.log(`\n  LocalDrop signaling server running\n`);
  console.log(`  Local:   http://localhost:${PORT}`);
  addrs.forEach(a => console.log(`  Network: http://${a}:${PORT}  ← share this with devices on your LAN`));
  console.log();
});

process.on("SIGINT",  () => { console.log("\nShutting down…"); process.exit(0); });
process.on("SIGTERM", () => { console.log("\nShutting down…"); process.exit(0); });
