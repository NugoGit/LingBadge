/* Standalone platform for running the app outside claude.ai (GitHub Pages, local file, any static host).
   Provides the same small interfaces the app uses on claude.ai:
     db     — doc(path).get/set, doc(path).collection(name).doc(id).set, collection(name).limit(n).get  (localStorage)
     user   — id()
     sample — json(prompt, {modelTier})  via the learner's own API key (Anthropic or any OpenAI-compatible endpoint)
   The API key stays in this browser's localStorage and is sent only to the provider the learner configured. */
(function (root) {
  "use strict";
  const PREFIX = "lingbadge:";
  const AI_KEY = "lingbadge.ai";

  function store() {
    try { const k = "__lb_test"; root.localStorage.setItem(k, "1"); root.localStorage.removeItem(k); return root.localStorage; }
    catch (e) { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, key: (i) => Object.keys(m)[i], get length() { return Object.keys(m).length; }, volatile: true }; }
  }
  const ls = store();

  function docRef(path) {
    const key = PREFIX + path;
    return {
      get: async () => { const raw = ls.getItem(key); return { exists: raw != null, data: () => (raw ? JSON.parse(raw) : undefined) }; },
      set: async (data) => { ls.setItem(key, JSON.stringify(data)); },
      delete: async () => { ls.removeItem(key); },
      collection: (name) => colRef(path + "/" + name),
    };
  }
  function colRef(path) {
    let lim = Infinity;
    const api = {
      doc: (id) => docRef(path + "/" + id),
      limit: (n) => { lim = n; return api; },
      get: async () => {
        const docs = [];
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k && k.startsWith(PREFIX + path + "/") && !k.slice((PREFIX + path + "/").length).includes("/")) {
            const raw = ls.getItem(k); docs.push({ id: k.split("/").pop(), data: () => JSON.parse(raw) });
          }
        }
        return { docs: docs.slice(0, lim) };
      },
    };
    return api;
  }

  // ------------------------------------------------------------ AI providers
  const DEFAULTS = {
    provider: "none",
    anthropic: { key: "", models: { quick: "claude-haiku-5-5", default: "claude-sonnet-5-5", complex: "claude-opus-5-5" } },
    openai: { key: "", base: "https://api.openai.com/v1", models: { quick: "", default: "", complex: "" } },
  };
  function getConfig() {
    try { const c = JSON.parse(ls.getItem(AI_KEY) || "{}"); return { provider: c.provider || "none", anthropic: Object.assign({}, DEFAULTS.anthropic, c.anthropic, { models: Object.assign({}, DEFAULTS.anthropic.models, (c.anthropic || {}).models) }), openai: Object.assign({}, DEFAULTS.openai, c.openai, { models: Object.assign({}, DEFAULTS.openai.models, (c.openai || {}).models) }) }; }
    catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
  }
  function setConfig(c) { ls.setItem(AI_KEY, JSON.stringify(c)); }

  function parseJson(text) {
    const t = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    try { return JSON.parse(t); } catch (e) { /* fall through */ }
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw Object.assign(new Error("Die Antwort war kein gültiges JSON."), { code: "bad_json" });
  }
  const SYSTEM = "Antworte ausschließlich mit einem einzigen gültigen JSON-Objekt, ohne Markdown und ohne Text davor oder danach.";

  async function httpError(r) {
    let msg = r.status + " " + r.statusText;
    try { const j = await r.json(); msg = (j.error && (j.error.message || j.error.type)) || msg; } catch (e) { /* ignore */ }
    const code = r.status === 429 ? "rate_limited" : r.status === 401 || r.status === 403 ? "not_granted" : "http_" + r.status;
    return Object.assign(new Error(msg), { code });
  }

  function makeSample(cfg) {
    cfg = cfg || getConfig();
    if (cfg.provider === "anthropic" && cfg.anthropic.key) {
      const p = cfg.anthropic;
      return { provider: "anthropic", json: async (prompt, opts) => {
        const model = p.models[(opts && opts.modelTier) || "default"] || p.models.default;
        const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
          headers: { "content-type": "application/json", "x-api-key": p.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify({ model, max_tokens: 8000, system: SYSTEM, messages: [{ role: "user", content: prompt }] }) });
        if (!r.ok) throw await httpError(r);
        const j = await r.json();
        return parseJson((j.content || []).filter((c) => c.type === "text").map((c) => c.text).join(""));
      } };
    }
    if (cfg.provider === "openai" && cfg.openai.base && cfg.openai.models.default) {
      const p = cfg.openai;
      return { provider: "openai", json: async (prompt, opts) => {
        const model = p.models[(opts && opts.modelTier) || "default"] || p.models.default;
        const headers = { "content-type": "application/json" };
        if (p.key) headers.authorization = "Bearer " + p.key;
        const r = await fetch(p.base.replace(/\/$/, "") + "/chat/completions", { method: "POST", headers,
          body: JSON.stringify({ model, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }] }) });
        if (!r.ok) throw await httpError(r);
        const j = await r.json();
        return parseJson(((j.choices || [])[0] || {}).message ? j.choices[0].message.content : "");
      } };
    }
    return null;
  }

  root.LBStandalone = {
    db: { doc: docRef, collection: colRef },
    user: { id: async () => "local" },
    volatile: !!ls.volatile,
    getConfig, setConfig, makeSample, parseJson,
  };
})(typeof window !== "undefined" ? window : globalThis);
