(function () {
  const cfg = window.APP_CONFIG;
  const store = window.store;
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const room = (params.get("room") || cfg.defaultRoom).replace(/[^\w가-힣-]/g, "").slice(0, 32) || cfg.defaultRoom;
  const isMobile = document.body.dataset.view === "mobile";

  const COLORS = { yellow: "노랑", pink: "분홍", mint: "민트", blue: "파랑", purple: "보라", orange: "주황" };
  const EMOJIS = ["🎂", "🎉", "💌", "🔥", "🌈", "🍀", "☕", "🐶", "⭐", "💪", "😂", "🥹"];
  const PROMPTS = [
    "함께 일하며 가장 고마웠던 순간은?", "이 사람을 한 단어로 표현한다면?", "처음 만났을 때의 인상은?",
    "앞으로 이런 일이 꼭 있었으면 해요!", "웃음이 터졌던 에피소드 하나!", "비밀인데… 사실 이런 점이 멋져요",
    "오늘 하루를 응원하는 한마디", "이 사람에게 추천하고 싶은 맛집/노래는?"
  ];

  const LS = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  const hearted = new Set(LS.get("rp:hearted:" + room, []));
  const mine = new Set(LS.get("rp:mine:" + room, []));

  const state = { meta: null, notes: new Map(), sort: "new", locked: false, photo: null, color: "yellow", emoji: "", lastPost: 0 };

  // ---------- 유틸 ----------
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 2400);
  }
  const rot = (id) => (((Number(id) * 7919) % 11) - 5) * 0.9; // -4.5 ~ 4.5deg, id 기반 고정
  const deadlineMs = () => (state.meta?.deadline ? Date.parse(state.meta.deadline) : null);
  const isOpen = () => !deadlineMs() || Date.now() < deadlineMs();
  const sealed = (n) => !!deadlineMs() && isOpen() && !mine.has(n.id);

  function fmtLeft(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (d ? d + "일 " : "") + [h, m, sec].map((x) => String(x).padStart(2, "0")).join(":");
  }
  const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  // ---------- 렌더링 ----------
  function noteEl(n) {
    const el = document.createElement("article");
    el.className = `note c-${n.color}` + (n.photo_url ? " polaroid" : "") + (sealed(n) ? " sealed" : "");
    el.dataset.id = n.id;
    el.style.setProperty("--rot", rot(n.id) + "deg");

    if (n.photo_url) {
      const img = document.createElement("img");
      img.className = "photo"; img.loading = "lazy"; img.alt = "첨부 사진"; img.src = n.photo_url;
      el.append(img);
    }
    if (n.emoji) {
      const e = document.createElement("span");
      e.className = "sticker"; e.textContent = n.emoji;
      el.append(e);
    }
    const msg = document.createElement("p");
    msg.className = "msg";
    msg.textContent = sealed(n) ? "🔒 마감 후에 공개돼요" : n.message;
    const by = document.createElement("p");
    by.className = "by";
    by.textContent = sealed(n) ? "— ???" : "— " + n.author;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "heart" + (hearted.has(n.id) ? " on" : "");
    btn.setAttribute("aria-label", "하트");
    btn.innerHTML = '<span class="h">♥</span><span class="cnt"></span>';
    btn.querySelector(".cnt").textContent = n.hearts || 0;
    btn.addEventListener("click", () => toggleHeart(n.id));
    el.append(msg, by, btn);
    return el;
  }

  function sortedNotes() {
    const arr = [...state.notes.values()];
    if (state.sort === "hearts") arr.sort((a, b) => b.hearts - a.hearts || b.id - a.id);
    else arr.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
    return arr;
  }

  function renderBoard(flashId) {
    const board = $("#board");
    board.replaceChildren();
    const arr = sortedNotes();
    $("#empty").hidden = arr.length > 0;
    for (const n of arr) {
      const el = noteEl(n);
      if (n.id === flashId) el.classList.add("pop");
      board.append(el);
    }
    renderStats();
  }

  function renderStats() {
    const arr = [...state.notes.values()];
    $("#count").textContent = arr.length;
    $("#heartTotal").textContent = arr.reduce((s, n) => s + (n.hearts || 0), 0);
    const top = !deadlineMs() || !isOpen() ? arr.filter((n) => n.hearts > 0).sort((a, b) => b.hearts - a.hearts)[0] : null;
    const mvp = $("#mvp");
    mvp.hidden = !top;
    if (top) mvp.textContent = `👑 MVP 포스트잇 · ${top.author}: “${top.message}” (♥ ${top.hearts})`;
  }

  function updateOne(n) {
    state.notes.set(n.id, n);
    const el = document.querySelector(`.note[data-id="${n.id}"]`);
    if (el && state.sort === "new") {
      const fresh = noteEl(n);
      el.replaceWith(fresh);
      fresh.querySelector(".heart").classList.add("bump");
      renderStats();
    } else renderBoard();
  }

  // ---------- 마감/카운트다운 ----------
  function tick() {
    const dl = deadlineMs();
    const badge = $("#deadline");
    const open = isOpen();
    if (!dl) {
      badge.textContent = "⏳ 마감 없음";
      badge.className = "badge";
    } else if (open) {
      const left = dl - Date.now();
      badge.textContent = "⏳ 마감까지 " + fmtLeft(left) + " · 공개 전";
      badge.className = "badge" + (left < 3600000 ? " urgent" : "");
    } else {
      badge.textContent = "🎁 공개 모드 · 작성이 마감되었어요";
      badge.className = "badge done";
    }
    const lockedNow = !open;
    if (lockedNow !== state.locked) {
      const wasOpen = !state.locked;
      state.locked = lockedNow;
      applyLock();
      if (lockedNow) {
        renderBoard();
        if (wasOpen && state.meta) { toast("🎉 마감! 모든 포스트잇이 공개됐어요"); confetti(160); }
      }
    }
  }
  function applyLock() {
    $("#composer").classList.toggle("locked", state.locked);
    $("#lockMsg").hidden = !state.locked;
    for (const el of $("#composer").querySelectorAll("input,textarea,button,select")) el.disabled = state.locked;
    const fab = $("#fab");
    if (fab) fab.hidden = state.locked;
    $("#csvBtn").hidden = !state.locked;
  }

  // ---------- 동작 ----------
  async function toggleHeart(id) {
    const n = state.notes.get(id);
    if (!n) return;
    const on = !hearted.has(id);
    on ? hearted.add(id) : hearted.delete(id);
    LS.set("rp:hearted:" + room, [...hearted]);
    n.hearts = Math.max(0, (n.hearts || 0) + (on ? 1 : -1)); // 낙관적 업데이트
    updateOne(n);
    if (on) burst(document.querySelector(`.note[data-id="${id}"] .heart`));
    try {
      const r = await store.heart(room, id, on ? 1 : -1);
      if (r && typeof r.hearts === "number") { n.hearts = r.hearts; updateOne(n); }
    } catch (e) {
      toast("하트를 보내지 못했어요");
    }
  }

  function resizeImage(file, max = 720) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지 변환 실패"))), "image/jpeg", 0.72);
      };
      img.onerror = () => reject(new Error("이미지를 읽을 수 없어요"));
      img.src = URL.createObjectURL(file);
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (state.locked) return;
    const message = $("#message").value.trim();
    if (!message) return toast("메시지를 입력해 주세요");
    if (Date.now() - state.lastPost < 3000) return toast("잠깐! 3초 뒤에 다시 붙일 수 있어요");
    const btn = $("#submitBtn");
    btn.disabled = true;
    try {
      let photo_url = null;
      if (state.photo) photo_url = await store.uploadPhoto(state.photo);
      const note = await store.addNote({
        room, author: $("#author").value.trim() || "익명", message, color: state.color,
        emoji: state.emoji || null, photo_url
      });
      state.lastPost = Date.now();
      mine.add(note.id);
      LS.set("rp:mine:" + room, [...mine]);
      LS.set("rp:author", $("#author").value.trim());
      if (!state.notes.has(note.id)) { state.notes.set(note.id, note); renderBoard(note.id); }
      $("#message").value = ""; updateCounter(); clearPhoto();
      closeSheet();
      confetti(40);
      toast(deadlineMs() ? "붙였어요! 마감 후 다른 사람에게도 공개돼요 💌" : "포스트잇을 붙였어요 💌");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast(err.message || "저장하지 못했어요");
    } finally {
      btn.disabled = state.locked;
    }
  }

  function updateCounter() {
    const len = $("#message").value.length;
    $("#counter").textContent = `${len}/100`;
    $("#counter").classList.toggle("warn", len >= 90);
  }
  function clearPhoto() {
    state.photo = null;
    $("#photoInput").value = "";
    $("#photoPreview").hidden = true;
  }

  function buildPickers() {
    const cw = $("#colors");
    for (const [k, label] of Object.entries(COLORS)) {
      const l = document.createElement("label");
      l.className = `swatch c-${k}`; l.title = label;
      l.innerHTML = `<input type="radio" name="color" value="${k}" ${k === "yellow" ? "checked" : ""}><span></span>`;
      l.querySelector("input").addEventListener("change", () => (state.color = k));
      cw.append(l);
    }
    const ew = $("#emojis");
    for (const em of ["", ...EMOJIS]) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "emo" + (em === "" ? " on" : "");
      b.textContent = em || "∅"; b.setAttribute("aria-label", em ? "스티커 " + em : "스티커 없음");
      b.addEventListener("click", () => {
        state.emoji = em;
        ew.querySelectorAll(".emo").forEach((x) => x.classList.toggle("on", x === b));
      });
      ew.append(b);
    }
  }

  // ---------- 다이얼로그 ----------
  function openDialog(id) { const d = $(id); d.showModal ? d.showModal() : d.setAttribute("open", ""); }
  function closeDialog(id) { const d = $(id); d.close ? d.close() : d.removeAttribute("open"); }

  function buildInvite() {
    const url = location.origin + "/?room=" + encodeURIComponent(room);
    $("#inviteUrl").value = url;
    const holder = $("#qr");
    holder.replaceChildren();
    if (window.qrcode) {
      const q = window.qrcode(0, "M");
      q.addData(url); q.make();
      holder.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } else holder.textContent = "QR 라이브러리를 불러오지 못했어요";
  }

  function exportCsv() {
    const esc = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const rows = [["작성자", "메시지", "색", "스티커", "하트", "사진", "작성시각"]].concat(
      sortedNotes().map((n) => [n.author, n.message, n.color, n.emoji, n.hearts, n.photo_url && !n.photo_url.startsWith("data:") ? n.photo_url : n.photo_url ? "(첨부)" : "", n.created_at])
    );
    const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rolling-paper-${room}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function createRoomFromDialog(e) {
    e.preventDefault();
    const title = $("#newTitle").value.trim();
    if (!title) return;
    const slug = Math.random().toString(36).slice(2, 8);
    const dl = $("#newDeadline").value;
    try {
      await store.createRoom({ room: slug, title, deadline: dl ? new Date(dl).toISOString() : null });
      location.href = (isMobile ? "/m/" : "/") + "?room=" + slug + (params.get("view") ? "&view=" + params.get("view") : "");
    } catch (err) { toast("만들지 못했어요: " + (err.message || err)); }
  }

  // ---------- 이펙트 ----------
  function confetti(n = 80) {
    const c = $("#fx"), ctx = c.getContext("2d");
    c.width = innerWidth; c.height = innerHeight;
    const cols = ["#ffe27a", "#ffb3c7", "#a6e9d0", "#b7d1ff", "#c9b6ff", "#ffc48a"];
    const ps = Array.from({ length: n }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.6,
      vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 16 - 6, r: Math.random() * 6 + 3,
      c: cols[(Math.random() * cols.length) | 0], a: Math.random() * 6
    }));
    let f = 0;
    (function frame() {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of ps) {
        p.vy += 0.45; p.x += p.vx; p.y += p.vy; p.a += 0.2;
        ctx.fillStyle = p.c;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
      }
      if (++f < 110) requestAnimationFrame(frame); else ctx.clearRect(0, 0, c.width, c.height);
    })();
  }
  function burst(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("span");
      s.className = "mini-heart"; s.textContent = "♥";
      s.style.left = r.left + r.width / 2 + "px"; s.style.top = r.top + "px";
      s.style.setProperty("--dx", (Math.random() - 0.5) * 60 + "px");
      document.body.append(s);
      setTimeout(() => s.remove(), 900);
    }
  }

  // ---------- 모바일 바텀시트 ----------
  function openSheet() { document.body.classList.add("sheet-open"); setTimeout(() => $("#message").focus(), 250); }
  function closeSheet() { document.body.classList.remove("sheet-open"); }

  // ---------- 시작 ----------
  function onEvent(ev) {
    const n = ev.note;
    if (!n) return;
    if (ev.type === "insert") {
      if (state.notes.has(n.id)) return; // 내 글 중복 방지
      state.notes.set(n.id, n);
      renderBoard(n.id);
    } else updateOne({ ...state.notes.get(n.id), ...n });
  }

  async function init() {
    buildPickers();
    $("#author").value = LS.get("rp:author", "");
    $("#modeTag").textContent = store.mode === "supabase" ? "Supabase" : "Container";

    try {
      let { meta, notes } = await store.load(room);
      if (!meta) {
        if (room === cfg.defaultRoom) {
          meta = await store.createRoom({ room, title: cfg.defaultTitle, deadline: null });
        } else {
          meta = { room, title: "우리 팀 롤링페이퍼", deadline: null };
          await store.createRoom(meta).catch(() => {});
        }
      }
      state.meta = meta;
      for (const n of notes) state.notes.set(n.id, n);
    } catch (e) {
      $("#title").textContent = "연결에 실패했어요";
      toast("서버에 연결하지 못했어요: " + (e.message || e));
    }
    if (state.meta) $("#title").textContent = state.meta.title;
    document.title = (state.meta?.title || "롤링페이퍼") + " · 우리 팀 롤링페이퍼";
    state.locked = !isOpen();
    applyLock();
    renderBoard();
    tick();
    setInterval(tick, 1000);
    store.subscribe(room, onEvent, (c) => ($("#online").textContent = c));

    $("#composer").addEventListener("submit", submit);
    $("#message").addEventListener("input", updateCounter);
    $("#promptBtn").addEventListener("click", () => {
      const q = PROMPTS[(Math.random() * PROMPTS.length) | 0];
      $("#message").placeholder = "💡 " + q;
      toast("💡 " + q);
    });
    $("#photoInput").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        state.photo = await resizeImage(f);
        $("#photoThumb").src = URL.createObjectURL(state.photo);
        $("#photoPreview").hidden = false;
      } catch (err) { toast(err.message); clearPhoto(); }
    });
    $("#photoClear").addEventListener("click", clearPhoto);
    document.querySelectorAll("[data-sort]").forEach((b) =>
      b.addEventListener("click", () => {
        state.sort = b.dataset.sort;
        document.querySelectorAll("[data-sort]").forEach((x) => x.classList.toggle("on", x === b));
        renderBoard();
      }));
    $("#inviteBtn").addEventListener("click", () => { buildInvite(); openDialog("#inviteDlg"); });
    $("#copyBtn").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("#inviteUrl").value); toast("링크를 복사했어요 🔗"); }
      catch { $("#inviteUrl").select(); toast("링크를 선택했어요. 복사해 주세요"); }
    });
    $("#newBtn").addEventListener("click", () => {
      $("#newDeadline").min = toLocalInput(new Date());
      openDialog("#newDlg");
    });
    $("#newForm").addEventListener("submit", createRoomFromDialog);
    $("#csvBtn").addEventListener("click", exportCsv);
    document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeDialog(b.dataset.close)));
    const fab = $("#fab");
    if (fab) fab.addEventListener("click", openSheet);
    const bd = document.querySelector(".sheet-backdrop");
    if (bd) bd.addEventListener("click", closeSheet);
    const sheetClose = $("#sheetClose");
    if (sheetClose) sheetClose.addEventListener("click", closeSheet);
    const switchBtn = $("#switchView");
    if (switchBtn) {
      const other = isMobile ? "desktop" : "mobile";
      switchBtn.textContent = isMobile ? "🖥 PC 화면으로 보기" : "📱 모바일 화면으로 보기";
      switchBtn.href = (isMobile ? "/" : "/m/") + "?room=" + encodeURIComponent(room) + "&view=" + other;
    }
  }

  init();
})();
