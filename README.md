# LocalDrop 🚀

**Peer-to-peer LAN file transfer. No cloud. No accounts. No encryption overhead. Just speed.**

Built on WebRTC DataChannel with a tiny WebSocket signaling server — the server only brokers the handshake. All file bytes travel directly between devices.

---

## Features

- ⚡ **Direct P2P transfer** — files never touch the server
- 🧩 **Chunked streaming** — 64 KB chunks, backpressure-aware
- 📶 **Auto room creation** — open the page, get a code instantly
- 👥 **Multi-peer rooms** — up to 10 receivers per room
- ✅ **Accept / Decline** — receiver controls every transfer
- 📊 **Live speed meter** — KB/s or MB/s in real time
- 🔄 **Auto-reconnect** — WebSocket reconnects on drop
- 🌐 **Works on any device** — browser-only, no installs

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Start the server

```bash
npm start
```

You'll see output like:

```
  LocalDrop signaling server running

  Local:   http://localhost:3000
  Network: http://192.168.1.42:3000  ← share this with devices on your LAN
```

### 3. Open on all devices

- **Sender**: open `http://<your-ip>:3000` → a room code appears automatically
- **Receiver**: open the same URL on another device → go to **Receive** tab → enter the code → Join

### 4. Transfer

1. Sender picks a file, selects the connected peer, hits **Send file**
2. Receiver sees an **Accept / Decline** prompt
3. On Accept — file streams directly, peer-to-peer
4. Receiver hits **Save file** when done

---

## How It Works

```
Sender (browser) ──── WebSocket ────► Signaling Server ◄──── WebSocket ──── Receiver (browser)
       │                                    │                                      │
       │         [exchange SDP offer/answer + ICE candidates via WS]               │
       │                                                                           │
       └──────────────────── WebRTC DataChannel (direct P2P) ───────────────────►│
                                  [all file bytes go here]
```

1. Sender opens page → server creates a room → returns a 6-letter code
2. Receiver enters the code → server tells sender a peer joined
3. Server brokers the WebRTC handshake (SDP + ICE) between the two
4. Once the DataChannel is open, server is out of the picture
5. File is sliced into 64 KB ArrayBuffer chunks and pushed through the DataChannel
6. Receiver reassembles chunks into a Blob → triggers browser download

---

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `PORT`  | `3000`  | HTTP + WS port |

```bash
PORT=8080 npm start
```

---

## Project Structure

```
localdrop/
├── server.js          # WebSocket signaling + HTTP static file server
├── public/
│   └── index.html     # Full UI (vanilla JS, zero dependencies)
├── package.json
└── README.md
```

---

## Performance Notes

- **Same WiFi**: expect 5–15 MB/s depending on router and device
- **Wired LAN**: can hit 50–80 MB/s on modern hardware
- Chunk size is 64 KB — tunable in `index.html` (`const CHUNK`)
- Backpressure is handled via `bufferedAmountLowThreshold` to avoid memory spikes on large files

---

## Running in Background (optional)

```bash
# Using pm2
npm install -g pm2
pm2 start server.js --name localdrop
pm2 save

# Using nohup
nohup node server.js &
```

---

## Requirements

- Node.js ≥ 18
- Devices must be on the **same local network** (same WiFi / LAN)
- Modern browser (Chrome, Firefox, Edge, Safari 15+)

---

## License

MIT
