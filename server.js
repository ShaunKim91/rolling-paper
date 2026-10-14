// 컨테이너 모드 서버: 정적 파일 + 메모리 API + SSE 실시간 + 모바일 자동 전환
// 모든 데이터는 메모리에만 있으며 컨테이너가 종료되면 사라집니다.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 8080;
const ROOT = path.join(__dirname, "public");
const COLORS = ["yellow", "pink", "mint", "blue", "purple", "orange"];
const MAX_ROOMS = 50, MAX_NOTES = 500, MAX_BODY = 400 * 1024;
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json"
};

const rooms = new Map(); // room -> { meta, notes[], clients:Set, nextId }
let seq = 1;

function getRoom(name) {
  if (!rooms.has(name)) {
    if (rooms.size >= MAX_ROOMS) return null;
    rooms.set(name, { meta: null, notes: [], clients: new Set() });
  }
  return rooms.get(name);
}
const clean = (s, n) => String(s ?? "").trim().slice(0, n);
const validRoom = (r) => typeof r === "string" && /^[\w가-힣-]{1,32}$/.test(r);

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > MAX_BODY) { reject(new Error("too large")); req.destroy(); }
    });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
function broadcast(room, event, data) {
  for (const c of room.clients) c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
const isMobile = (ua = "") => /iPhone|iPod|Android.*Mobile|Windows Phone|Mobile.*Firefox/i.test(ua);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  try {
    if (p === "/healthz") return send(res, 200, { ok: true });

    // ---- API ----
    const m = p.match(/^\/api\/rooms\/([^/]+)$/);
    if (m && req.method === "GET") {
      const name = decodeURIComponent(m[1]);
      if (!validRoom(name)) return send(res, 400, { error: "invalid room" });
      const r = getRoom(name);
      if (!r) return send(res, 429, { error: "too many rooms" });
      return send(res, 200, { meta: r.meta, notes: r.notes });
    }
    if (p === "/api/rooms" && req.method === "POST") {
      const b = await readBody(req);
      if (!validRoom(b.room)) return send(res, 400, { error: "invalid room" });
      const r = getRoom(b.room);
      if (!r) return send(res, 429, { error: "too many rooms" });
      if (!r.meta) {
        const dl = b.deadline ? new Date(b.deadline) : null;
        r.meta = {
          room: b.room, title: clean(b.title, 40) || "우리 팀 롤링페이퍼",
          deadline: dl && !isNaN(dl) ? dl.toISOString() : null, created_at: new Date().toISOString()
        };
      }
      return send(res, 201, r.meta);
    }
    if (p === "/api/notes" && req.method === "POST") {
      const b = await readBody(req);
      if (!validRoom(b.room)) return send(res, 400, { error: "invalid room" });
      const r = getRoom(b.room);
      if (!r) return send(res, 429, { error: "too many rooms" });
      const message = clean(b.message, 100);
      if (!message) return send(res, 400, { error: "message required" });
      if (r.meta?.deadline && Date.now() > Date.parse(r.meta.deadline))
        return send(res, 403, { error: "마감되었어요" });
      const photo = typeof b.photo_url === "string" && b.photo_url.startsWith("data:image/") && b.photo_url.length < 300000
        ? b.photo_url : null;
      const note = {
        id: seq++, room: b.room, author: clean(b.author, 12) || "익명", message,
        color: COLORS.includes(b.color) ? b.color : "yellow", emoji: clean(b.emoji, 4) || null,
        photo_url: photo, hearts: 0, created_at: new Date().toISOString()
      };
      r.notes.unshift(note);
      if (r.notes.length > MAX_NOTES) r.notes.pop();
      broadcast(r, "note", { type: "insert", note });
      return send(res, 201, note);
    }
    const h = p.match(/^\/api\/notes\/(\d+)\/heart$/);
    if (h && req.method === "POST") {
      const b = await readBody(req);
      const r = rooms.get(b.room);
      const note = r?.notes.find((n) => n.id === Number(h[1]));
      if (!note) return send(res, 404, { error: "not found" });
      note.hearts = Math.max(0, note.hearts + (b.delta < 0 ? -1 : 1));
      broadcast(r, "note", { type: "update", note });
      return send(res, 200, { hearts: note.hearts });
    }
    if (p === "/api/events" && req.method === "GET") {
      const name = url.searchParams.get("room");
      if (!validRoom(name)) return send(res, 400, { error: "invalid room" });
      const r = getRoom(name);
      if (!r) return send(res, 429, { error: "too many rooms" });
      res.writeHead(200, {
        "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive", "X-Accel-Buffering": "no"
      });
      res.write(": hi\n\n");
      r.clients.add(res);
      broadcast(r, "presence", { count: r.clients.size });
      const ping = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => {
        clearInterval(ping);
        r.clients.delete(res);
        broadcast(r, "presence", { count: r.clients.size });
      });
      return;
    }
    if (p.startsWith("/api/")) return send(res, 404, { error: "not found" });

    // ---- 모바일/데스크톱 자동 전환 (같은 주소) ----
    const view = url.searchParams.get("view");
    const mobile = view ? view === "mobile" : isMobile(req.headers["user-agent"]);
    if ((p === "/" || p === "/index.html") && mobile) {
      res.writeHead(302, { Location: "/m/" + url.search, Vary: "User-Agent" });
      return res.end();
    }
    if ((p === "/m" || p === "/m/") && view !== "mobile" && !mobile) {
      res.writeHead(302, { Location: "/" + url.search, Vary: "User-Agent" });
      return res.end();
    }

    // ---- 정적 파일 ----
    let rel = p === "/" ? "/index.html" : p.endsWith("/") ? p + "index.html" : p;
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) return send(res, 403, { error: "forbidden" });
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, { error: "not found" });
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "User-Agent"
      });
      res.end(data);
    });
  } catch (e) {
    if (!res.headersSent) send(res, 400, { error: String(e.message || e) });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`Rolling paper listening on ${PORT}`));
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => process.exit(0));
