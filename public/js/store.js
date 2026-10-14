// 데이터 계층: Supabase 모드 / 컨테이너 API 모드를 같은 인터페이스로 제공
(function () {
  const cfg = window.APP_CONFIG;
  const useSupabase = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase);
  const noteCols = "id,room,author,message,color,emoji,photo_url,hearts,created_at";

  async function json(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
  }
  const post = (url, body) =>
    json(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  // ---------- 컨테이너 모드 ----------
  const container = {
    mode: "container",
    async load(room) {
      return json("/api/rooms/" + encodeURIComponent(room));
    },
    createRoom: (room) => post("/api/rooms", room),
    addNote: (note) => post("/api/notes", note),
    heart: (room, id, delta) => post("/api/notes/" + id + "/heart", { room, delta }),
    async uploadPhoto(blob) {
      const dataUrl = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.readAsDataURL(blob);
      });
      return dataUrl; // 메모리에 note와 함께 저장됨
    },
    subscribe(room, onEvent, onPresence) {
      const es = new EventSource("/api/events?room=" + encodeURIComponent(room));
      es.addEventListener("note", (e) => onEvent(JSON.parse(e.data)));
      es.addEventListener("presence", (e) => onPresence(JSON.parse(e.data).count));
      return () => es.close();
    }
  };

  // ---------- Supabase 모드 ----------
  let sb;
  const supa = {
    mode: "supabase",
    client() {
      return (sb ||= window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey));
    },
    async load(room) {
      const c = this.client();
      const [{ data: meta }, { data: notes, error }] = await Promise.all([
        c.from("rp_rooms").select("*").eq("room", room).maybeSingle(),
        c.from("rp_notes").select(noteCols).eq("room", room).order("created_at", { ascending: false }).limit(300)
      ]);
      if (error) throw error;
      return { meta, notes: notes || [] };
    },
    async createRoom(r) {
      const { error } = await this.client().from("rp_rooms").insert(r);
      if (error && error.code !== "23505") throw error;
      return r;
    },
    async addNote(n) {
      const { data, error } = await this.client().from("rp_notes").insert(n).select(noteCols).single();
      if (error) throw error;
      return data;
    },
    async heart(room, id, delta) {
      const { data, error } = await this.client().rpc("rp_bump_heart", { note_id: id, delta });
      if (error) throw error;
      return { hearts: data };
    },
    async uploadPhoto(blob) {
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const bucket = this.client().storage.from("photos");
      const { error } = await bucket.upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      return bucket.getPublicUrl(path).data.publicUrl;
    },
    subscribe(room, onEvent, onPresence) {
      const c = this.client();
      const ch = c
        .channel("room-" + room, { config: { presence: { key: Math.random().toString(36).slice(2) } } })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "rp_notes", filter: "room=eq." + room },
          (p) => onEvent({ type: "insert", note: p.new }))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rp_notes", filter: "room=eq." + room },
          (p) => onEvent({ type: "update", note: p.new }))
        .on("presence", { event: "sync" }, () => onPresence(Object.keys(ch.presenceState()).length))
        .subscribe((status) => status === "SUBSCRIBED" && ch.track({ at: Date.now() }));
      return () => c.removeChannel(ch);
    }
  };

  window.store = useSupabase ? supa : container;
})();
