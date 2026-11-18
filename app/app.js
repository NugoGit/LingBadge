/* lingbadge app: skill map, tests, grading, badges. Depends on core.js (window.LB). */
(function () {
  "use strict";
  const LB = window.LB;
  const MODES = ["R", "L", "SI", "SP", "WI"];
  // UI language: German strings are the keys; app/i18n.js maps them to English.
  const UI = () => (App && App.profile && App.profile.settings.il) || "de";
  function t(de, vars) {
    let out = (UI() !== "de" && window.LB_I18N && window.LB_I18N[UI()] && window.LB_I18N[UI()][de]) || de;
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return out;
  }
  const MODE_DE = new Proxy({ R: "Lesen", L: "Hören", SI: "Gespräch", SP: "Vortrag", WI: "Schreiben", WP: "Text" }, { get: (o, k) => (k in o ? t(o[k]) : undefined) });
  const ST_DE = new Proxy({ badge: "Abzeichen", likely: "wahrscheinlich", shaky: "unsicher", unknown: "Lücke", untested: "ungetestet",
    suspect: "Verdacht", known: "sicher", audio: "nur mit Audio" }, { get: (o, k) => (k in o ? t(o[k]) : undefined) });
  // content titles: German versions come from content/*/i18n/de.yaml as title_de / can_do_de
  const TT = (x) => (x ? (UI() === "de" && x.title_de) || x.title : "");
  const CANDO = (x) => (UI() === "de" && x.can_do_de) || x.can_do;
  // Reasons stored in attempts are German; translate the known patterns for display.
  function trReason(s) {
    if (UI() === "de" || !s) return s;
    const P = [[/^(\d+)\/(\d+) richtig$/, "$1/$2 correct"], [/^Pflichtkriterien unter „erfüllt“: (.*)$/, "Required criteria below 'meets': $1"],
      [/^noch kein bestandener Test$/, "no passed test yet"], [/^zwei unabhängige Tests, (\d+) Tag\(e\) auseinander$/, "two independent tests, $1 day(s) apart"],
      [/^1 von 2 bestanden – nächsten Test an einem anderen Tag$/, "1 of 2 passed – take the next test on another day"],
      [/^bestandene Tests, aber nicht an verschiedenen Tagen im Zeitfenster$/, "passed tests, but not on different days within the window"],
      [/^Sitzt\.$/, "Solid."], [/^Die Grundregel sitzt noch nicht\.$/, "The basic rule is not solid yet."],
      [/^Die Regel sitzt; einzelne Ausnahmen fehlen noch\.$/, "The rule is solid; a few exceptions are still missing."],
      [/^Die Formen sitzen, aber wann man sie verwendet, ist noch unsicher\.$/, "The forms are solid, but when to use them is still shaky."],
      [/^Die Grundregel sitzt; Unterfälle sind noch unsicher\.$/, "The basic rule is solid; sub-cases are still shaky."]];
    for (const [re, en] of P) if (re.test(s)) return s.replace(re, en);
    return s;
  }
  const TESTABLE = new Set(["R", "L", "WI", "SI"]);   // SP needs speech input
  const BADGEABLE = new Set(["R", "L", "WI"]);        // typed role-plays never award spoken badges
  const CRIT_DE0 = { task_completion: "Aufgabe erfüllt", comprehension: "Verstehen", key_structures: "Schlüsselstrukturen",
    lexis: "Wortschatz", appropriacy: "Angemessenheit", orthography: "Rechtschreibung", delivery: "Aussprache", item_accuracy: "Richtige Antworten" };
  const LEVEL_DE0 = ["fehlt", "unter Niveau", "erfüllt", "übertroffen"];

  const App = {
    C: null, cfg: null, db: null, sample: null, tts: null, uid: null,
    attempts: [], profile: { settings: { il: (navigator.language || "").toLowerCase().startsWith("de") ? "de" : "en", tts: "browser", gradeTier: "default", validate: true }, probes: {}, checks: {}, badges: {} },
    view: "karte", screen: null, note: "", connecting: true, saving: Promise.resolve(),
  };

  // ------------------------------------------------------------------ helpers
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const today = () => new Date().toISOString().slice(0, 10);
  const nowIso = () => new Date().toISOString();
  const pct = (x) => Math.round(x * 100) + " %";
  const chip = (st, label) => `<span class="chip st-${esc(st)}">${esc(label || ST_DE[st] || st)}</span>`;
  const skillById = (id) => App.C.skills.find((s) => s.id === id);
  const settings = () => App.profile.settings;
  const rid = () => Math.random().toString(36).slice(2, 10);

  function setNote(t) { App.note = t; render(); }

  // ------------------------------------------------------------------ languages
  const LANG_UI = () => (App.C && App.C.langs ? App.C.langs[App.lang] : null);
  const META = () => (LANG_UI() && LANG_UI().meta) || {};
  const LN = () => LB.tx(META().name, UI()) || App.lang || "";
  const LA = () => `lang="${esc(App.lang)}" dir="${META().dir === "rtl" ? "rtl" : "ltr"}"`;
  const pk = (id) => (App.lang === "uk" ? id : App.lang + ":" + id);  // profile keys; uk keeps bare ids (older data)
  const attLang = (a) => a.lang || (a.form && a.form.lang) || "uk";
  const myAttempts = () => App.attempts.filter((a) => attLang(a) === App.lang);
  function useLanguage(code) {
    const langs = App.C.langs;
    if (!langs[code]) code = langs[App.C.default_lang] ? App.C.default_lang : Object.keys(langs)[0];
    App.lang = code;
    const L = langs[code];
    App.C.enablers = L.enablers; App.C.realizations = L.realizations; App.C.checks = L.checks || {}; App.C.placement = L.placement || {};
    App.C.skills = App.C.allSkills.filter((s) => L.realizations[s.id]);
    LB.setTarget(L.meta);
    findVoice();
  }
  function langPicker() {
    const codes = Object.keys(App.C.langs);
    if (codes.length < 2) return uiPicker();
    return `<label class="langpick small">${t("Sprache")} <select id="lang-pick">${codes.map((c) => `<option value="${esc(c)}" ${c === App.lang ? "selected" : ""}>${esc(LB.tx(App.C.langs[c].meta.name, UI()) || c)}</option>`).join("")}</select></label>`;
  }

  function uiPicker() {
    return `<span class="uipick small" role="group" aria-label="Interface">${["de", "en"].map((c) => `<button type="button" class="${UI() === c ? "on" : ""}" data-act="ui" data-id="${c}" aria-pressed="${UI() === c}">${c.toUpperCase()}</button>`).join("")}</span>`;
  }

  // ------------------------------------------------------------------ storage
  const base = () => "data/users/" + App.uid;
  const attemptsCol = () => App.db.doc(base() + "/profile").collection("attempts");

  function queueSave(fn) {
    App.saving = App.saving.then(fn).catch((e) => setNote(t("Speichern fehlgeschlagen: {e}. Deine letzte Aktion ist evtl. nicht gespeichert.", { e: e && (e.message || e.code) })));
    return App.saving;
  }
  function saveProfile() { if (!App.db) return Promise.resolve(); const p = JSON.parse(JSON.stringify(App.profile)); return queueSave(() => App.db.doc(base() + "/profile").set(p)); }
  function saveAttempt(a) { if (!App.db) return Promise.resolve(); const d = JSON.parse(JSON.stringify(a)); return queueSave(() => attemptsCol().doc(a.id).set(d)); }

  async function loadData() {
    const timer = setTimeout(() => setNote(t("Deine gespeicherten Daten sind noch nicht erreichbar. Was du jetzt siehst, ist evtl. nicht aktuell.")), 10000);
    try {
      const p = await App.db.doc(base() + "/profile").get();
      if (p.exists) {
        const d = p.data();
        App.profile = { settings: Object.assign({}, App.profile.settings, d.settings || {}), probes: d.probes || {}, checks: d.checks || {}, badges: d.badges || {} };
      }
      const snap = await attemptsCol().limit(1000).get();
      App.attempts = snap.docs.map((d) => d.data()).sort((a, b) => (a.at < b.at ? -1 : 1));
      clearTimeout(timer);
      if (App.note === t("Deine gespeicherten Daten sind noch nicht erreichbar. Was du jetzt siehst, ist evtl. nicht aktuell.")) App.note = "";
    } catch (e) {
      clearTimeout(timer);
      setNote(t("Daten konnten nicht geladen werden ({e}). Neue Ergebnisse werden trotzdem versucht zu speichern.", { e: e.code || e.message }));
    }
  }

  // ------------------------------------------------------------------ Claude calls
  async function ask(prompt, tier) {
    if (!App.sample) throw new Error(App.platform === "standalone" ? t("Kein KI-Anbieter eingerichtet. Trage in den Einstellungen einen API-Schlüssel ein.") : t("Claude ist in dieser Ansicht nicht verfügbar. Öffne die Seite auf claude.ai."));
    try {
      return await App.sample.json(prompt, { modelTier: tier || "default" });
    } catch (e) {
      if (e && e.code === "not_granted") throw new Error(App.platform === "standalone" ? t("Der API-Schlüssel wurde abgelehnt ({e}). Prüfe ihn in den Einstellungen.", { e: e.message || "" }) : t("Claude-Zugriff wurde nicht erlaubt. Erlaube ihn beim nächsten Klick, sonst funktionieren Tests nicht."));
      if (e && e.code === "rate_limited") throw new Error(t("Zu viele Anfragen gerade. Bitte in einer Minute erneut versuchen."));
      throw new Error(t("KI-Anfrage fehlgeschlagen: {e}", { e: (e && (e.message || e.code)) || e }));
    }
  }

  // ------------------------------------------------------------------ speech
  let ukVoice = null;
  function findVoice() {
    try { const vs = window.speechSynthesis ? speechSynthesis.getVoices() : []; const tag = String((App.C && App.lang && (META().tts || App.lang)) || "uk").toLowerCase(), base = tag.split("-")[0]; ukVoice = vs.find((v) => v.lang.toLowerCase().replace("_", "-") === tag) || vs.find((v) => v.lang.toLowerCase().startsWith(base)) || null; } catch (e) { ukVoice = null; }
  }
  if (window.speechSynthesis) { findVoice(); speechSynthesis.onvoiceschanged = findVoice; }

  function browserSpeak(text) {
    return new Promise((res, rej) => {
      if (!window.speechSynthesis) return rej(new Error(t("Keine Sprachausgabe im Browser.")));
      const u = new SpeechSynthesisUtterance(text);
      u.lang = META().tts || App.lang; u.rate = 0.85; if (ukVoice) u.voice = ukVoice;
      u.onend = res; u.onerror = () => rej(new Error(t("Sprachausgabe fehlgeschlagen.")));
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    });
  }
  async function speak(text) {
    if (settings().tts === "claude" && App.tts) {
      try { return await App.tts.speak(text, { language: App.lang, rate: 0.85 }); } catch (e) { /* fall back */ }
    }
    if (!ukVoice && settings().tts === "browser") setNote(t(App.tts ? "Dein Browser hat keine Stimme für {lang}. Wähle in den Einstellungen „Claude-Stimme“ oder öffne die Seite in Edge oder Chrome (dort gibt es Online-Stimmen), oder installiere eine Systemstimme." : "Dein Browser hat keine Stimme für {lang}. Öffne die Seite in Edge oder Chrome (dort gibt es Online-Stimmen), oder installiere eine Systemstimme.", { lang: LN() }));
    return browserSpeak(text);
  }

  // ------------------------------------------------------------------ statuses
  function rubricOf(skill) { return App.C.rubrics[skill.rubric]; }
  function statusOf(skill) {
    const atts = myAttempts().filter((a) => a.skill === skill.id && !a.voided && a.kind === "full")
      .map((a) => BADGEABLE.has(skill.mode) ? a : Object.assign({}, a, { channel: "typed-speech" }));
    return LB.skillStatus(skill, atts, App.profile.probes[pk(skill.id)], rubricOf(skill), App.cfg);
  }
  function enablerStatus() { return LB.enablerStatuses(App.C.enablers, App.profile.checks, App.attempts); }

  // ------------------------------------------------------------------ routing
  const VIEWS = ["karte", "einstufung", "grammatik", "einstellungen"];
  function route() { const h = location.hash.replace("#", ""); App.view = VIEWS.includes(h) ? h : "karte"; App.screen = null; }

  // ------------------------------------------------------------------ render
  function render() {
    const nav = VIEWS.map((v) => `<a href="#${v}" ${App.view === v && !App.screen ? 'aria-current="page"' : ""}>${t({ karte: "Karte", einstufung: "Einstufung", grammatik: "Grammatik & Wortschatz", einstellungen: "Einstellungen" }[v])}</a>`).join("");
    let notes = "";
    if (App.connecting) notes += `<p class="note info"><span class="spinner"></span>${t("Verbinde mit claude.ai …")}</p>`;
    else if (!App.sample) notes += App.platform === "standalone"
      ? `<p class="note info">${t(hasPlacement() ? "Ohne KI-Anbieter funktionieren die Einstufung und die Grammatik-Checks aus dem Fragenkatalog. Für Tests und Checks ohne Katalog trage in den {link} einen API-Schlüssel ein." : "Ohne KI-Anbieter funktionieren die Grammatik-Checks aus dem Fragenkatalog. Für Tests, Einstufung und Checks ohne Katalog trage in den {link} einen API-Schlüssel ein.", { link: `<a href="#einstellungen">${t("Einstellungen")}</a>` })}</p>`
      : `<p class="note">${t("Claude ist hier nicht verfügbar: Tests lassen sich nur auf claude.ai erstellen und bewerten.")}</p>`;
    if (!App.connecting && !App.db) notes += `<p class="note">${t("Speichern ist hier nicht verfügbar (nicht angemeldet oder außerhalb von claude.ai). Ergebnisse gehen beim Schließen verloren.")}</p>`;
    if (App.platform === "standalone" && window.LBStandalone.volatile) notes += `<p class="note">${t("Dieser Browser erlaubt keinen lokalen Speicher. Ergebnisse gehen beim Schließen verloren.")}</p>`;
    if (App.note) notes += `<p class="note">${esc(App.note)} <button class="btn quiet small" data-act="dismiss">OK</button></p>`;
    let main;
    if (App.screen && App.screen.kind === "skill") main = renderSkill(skillById(App.screen.id));
    else if (App.screen && App.screen.kind === "run") main = renderRun(App.screen.run);
    else if (App.screen && App.screen.kind === "attempt") main = renderResult(App.attempts.find((a) => a.id === App.screen.id), true);
    else main = ({ karte: renderMap, einstufung: renderPlacement, grammatik: renderEnablers, einstellungen: renderSettings })[App.view]();
    document.documentElement.lang = UI();
    $("#app").innerHTML = `<header class="top"><h1>${esc(t("Kompetenzkarte {lang}", { lang: LN() }))}</h1><span class="sub">${esc(t("A1 · {n} Alltagskompetenzen", { n: App.C.skills.length }))}</span><div class="pickers">${langPicker()}${Object.keys(App.C.langs).length < 2 ? "" : uiPicker()}</div><nav class="tabs">${nav}</nav></header>${notes}${main}`;
    afterRender();
  }

  function renderMap() {
    const counts = { badge: 0, likely: 0, shaky: 0, unknown: 0, untested: 0 };
    const st = {}; App.C.skills.forEach((s) => { st[s.id] = statusOf(s); counts[st[s.id].status]++; });
    const tiles = [["badge", "Abzeichen"], ["likely", "wahrscheinlich"], ["shaky", "unsicher"], ["unknown", "Lücken"], ["untested", "ungetestet"]]
      .map(([k, l]) => `<div class="tile"><b>${counts[k]}</b><span>${t(l)}</span></div>`).join("");
    const legend = ["badge", "likely", "shaky", "unknown", "untested"].map((k) => chip(k)).join("") +
      `<span>· ${t("Gespräch und Vortrag: nur Einschätzung, Abzeichen erst mit Spracheingabe")}</span>`;
    const themes = App.C.themes.map((th) => {
      const skills = App.C.skills.filter((s) => s.theme === th.id);
      if (!skills.length) return "";
      const tasks = [...new Set(skills.map((s) => s.task))];
      const rows = tasks.map((task) => {
        const ts = skills.filter((s) => s.task === task);
        const lead = ts.find((s) => s.mode === "SI") || ts[0];
        const cells = MODES.map((m) => {
          const s = ts.find((x) => x.mode === m);
          if (!s) return `<td><span class="dot" aria-hidden="true">·</span></td>`;
          const x = st[s.id];
          const label = x.status === "likely" && x.badge && x.badge.passes === 1 ? t("1/2 bestanden") : ST_DE[x.status];
          return `<td><button class="cellbtn" data-act="open-skill" data-id="${esc(s.id)}" title="${esc(TT(s))}">${chip(x.status, label)}</button></td>`;
        }).join("");
        return `<tr><td class="task">${esc(TT(lead))}<small>${esc(ts.map((s) => s.id).join(" · "))}</small></td>${cells}</tr>`;
      }).join("");
      return `<section class="theme"><h2>${esc(TT(th))}</h2><table class="grid"><thead><tr><th>${t("Aufgabe")}</th>${MODES.map((m) => `<th>${MODE_DE[m]}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></section>`;
    }).join("");
    const empty = counts.untested === App.C.skills.length
      ? `<p class="note info">${t("Noch keine Ergebnisse. Starte mit der {link} (ein Thema dauert 5–10 Minuten) oder öffne eine Kompetenz und mach einen Test.", { link: `<a href="#einstufung">${t("Einstufung")}</a>` })}</p>` : "";
    return `${empty}<div class="tiles">${tiles}</div><div class="legend">${legend}</div>${themes}`;
  }

  function renderSkill(s) {
    const x = statusOf(s), real = App.C.realizations[s.id], est = enablerStatus();
    const atts = myAttempts().filter((a) => a.skill === s.id && a.kind === "full").slice().reverse();
    const thr = LB.thresholdFor(s, App.cfg);
    const badgeLine = !BADGEABLE.has(s.mode)
      ? `<p class="small muted">${t(s.mode === "SP" ? "Vortrag braucht Spracheingabe – noch nicht testbar." : "Getippte Rollenspiele zeigen deinen Stand, vergeben aber kein Sprech-Abzeichen.")}</p>`
      : x.status === "badge" ? `<p class="ok">${t("Abzeichen erhalten")} – ${esc(trReason(x.badge.reason))}.</p>`
      : `<p class="small">${t(s.rubric.includes("interaction") || s.rubric.includes("written") ? "Abzeichen: {n} von 2 bestandenen Tests (an verschiedenen Tagen, innerhalb von 60 Tagen). Bestehen ab {thr} und alle Pflichtkriterien erfüllt." : "Abzeichen: {n} von 2 bestandenen Tests (an verschiedenen Tagen, innerhalb von 60 Tagen). Bestehen ab {thr}.", { n: x.badge.passes || 0, thr: pct(thr) })}</p>`;
    const ens = real.enablers.filter((u) => u.role === "required").map((u) => {
      const e = App.C.enablers[u.id] || {};
      return `<div class="en"><div>${esc(TT(e))}<small>${esc(e.cefr)} · ${t(u.use === "formulaic" ? "feste Wendung" : "selbst bilden")}</small></div>${chip(est[u.id])}</div>`;
    }).join("");
    const list = atts.length ? `<table class="plain"><thead><tr><th>${t("Datum")}</th><th>${t("Ergebnis")}</th><th>${t("Punkte")}</th><th></th></tr></thead><tbody>${atts.map((a) =>
      `<tr><td class="num">${esc(a.takenOn)}</td><td>${a.voided ? `<span class="muted">${t("ungültig")}</span>` : a.outcome.passed ? `<span class="ok">${t("bestanden")}</span>` : `<span class="bad">${t("nicht bestanden")}</span>`}</td><td class="num">${pct(a.outcome.score)}</td><td><button class="btn quiet small" data-act="view-attempt" data-id="${esc(a.id)}">${t("ansehen")}</button></td></tr>`).join("")}</tbody></table>`
      : `<p class="muted small">${t("Noch keine Tests.")}</p>`;
    const probe = App.profile.probes[pk(s.id)];
    return `<p><button class="btn quiet" data-act="back">← ${t("Karte")}</button></p>
      <div class="card stack"><div class="row"><h2>${esc(TT(s))}</h2>${chip(x.status)}<span class="chip st-untested">${MODE_DE[s.mode]} · ${esc(s.cefr)} · ${t("Umfang")} ${esc(s.size)}</span></div>
      <p>${esc(CANDO(s))}</p>${badgeLine}
      ${probe ? `<p class="small muted">${t("Einstufung am {d}: {c}/{n} → {st}", { d: esc(probe.at.slice(0, 10)), c: probe.correct, n: probe.total || 3, st: ST_DE[probe.status] })}</p>` : ""}
      <div class="row">${TESTABLE.has(s.mode) ? `<button class="btn" data-act="start-test" data-id="${esc(s.id)}">${t(s.mode === "SI" ? "Rollenspiel starten" : "Test starten")}</button>` : ""}</div></div>
      <div class="card stack"><h3>${t("Bisherige Tests")}</h3>${list}</div>
      <div class="card stack"><h3>${t("Bausteine in dieser Kompetenz")}</h3><div class="ens">${ens}</div></div>`;
  }

  function renderEnablers() {
    const est = enablerStatus();
    const groups = {};
    Object.values(App.C.enablers).forEach((e) => (groups[e.kind] = groups[e.kind] || []).push(e));
    const KIND_DE = { grammar: "Grammatik", lexis: "Wortschatz", pragmatics: "Pragmatik", script: "Schrift", orthography: "Rechtschreibung", phonology: "Aussprache" };
    const order = ["grammar", "lexis", "pragmatics", "script", "orthography", "phonology"];
    return `<p class="muted">${t("Bausteine hinter den Kompetenzen. „Verdacht“ heißt: In Tests gab es Fehler, die hierauf zeigen. Ein Check (10 Aufgaben, ~5 Minuten) klärt es. Checks mit Fragenkatalog laufen ohne KI und mischen Grundregel, Varianten, Ausnahmen und Abgrenzung. A2-Bausteine kommen in A1-Aufgaben nur als feste Wendungen vor.")}</p>` +
      order.filter((k) => groups[k]).map((k) => `<div class="card stack"><h2>${t(KIND_DE[k])}</h2><div class="ens">${groups[k].sort((a, b) => (a.cefr + TT(a)).localeCompare(b.cefr + TT(b))).map((e) => {
        const c = App.profile.checks[e.id];
        return `<div class="en"><div>${esc(TT(e))}<small>${esc(e.cefr)}${c ? " · " + t("Check {p} am {d}", { p: pct(c.score), d: esc(c.at.slice(0, 10)) }) : ""}</small></div><div class="row">${chip(est[e.id])}${e.channel === "text" ? `<button class="btn quiet small" data-act="start-check" data-id="${esc(e.id)}" title="${t(App.C.checks[e.id] ? "Aus dem Fragenkatalog, ohne KI" : "Wird von der KI erstellt")}">${App.C.checks[e.id] ? "Check" : t("Check (KI)")}</button>` : ""}</div></div>`;
      }).join("")}</div></div>`).join("");
  }

  function hasPlacement() { return Object.keys(App.C.placement || {}).length > 0; }
  function probeSkills(themeId) {
    // SP can only be probed with a catalogue; generated probes skip it as before.
    return App.C.skills.filter((s) => s.theme === themeId && (App.C.placement[s.id] || s.mode !== "SP"));
  }
  function renderPlacement() {
    const rows = App.C.themes.map((th) => {
      const skills = probeSkills(th.id);
      if (!skills.length) return "";
      const done = skills.filter((s) => App.profile.probes[pk(s.id)]).length;
      const chips = skills.map((s) => { const p = App.profile.probes[pk(s.id)]; return chip(p ? p.status : "untested", MODE_DE[s.mode] + (p ? " " + p.correct + "/" + (p.total || 3) : "")); }).join(" ");
      return `<tr><td><b>${esc(TT(th))}</b><br><span class="small muted">${t("{n} Kompetenzen · {d} eingestuft", { n: skills.length, d: done })}</span></td><td>${chips}</td><td><button class="btn ${done ? "quiet" : ""}" data-act="start-probe" data-id="${esc(th.id)}">${t(done ? "Wiederholen" : "Starten")}</button></td></tr>`;
    }).join("");
    const cat = hasPlacement();
    return `<div class="card stack"><h2>${t("Einstufung")}</h2><p>${t(cat ? "Pro Thema 3 kurze Aufgaben je Kompetenz, eine für jeden Teil der Kompetenz (z. B. bestellen, nachfragen, bezahlen). Ergebnis: 3/3 wahrscheinlich, 2/3 unsicher, sonst Lücke. Einstufungen vergeben keine Abzeichen; sie zeigen dir, wo du testen solltest. Du kannst jederzeit unterbrechen; jedes Thema wird einzeln gespeichert." : "Pro Thema 3 kurze Aufgaben je Kompetenz. Ergebnis: 3/3 wahrscheinlich, 2/3 unsicher, sonst Lücke. Einstufungen vergeben keine Abzeichen; sie zeigen dir, wo du testen solltest. Du kannst jederzeit unterbrechen; jedes Thema wird einzeln gespeichert.")}</p>
      ${cat ? `<p class="small muted">${t("Die Aufgaben kommen aus einem festen Katalog und werden ohne KI ausgewertet. Bei einer Wiederholung bekommst du vorrangig Aufgaben, die du noch nicht hattest. Gespräch, Vortrag und Schreiben werden mit Lücken und „Was sagst du?“-Fragen eingeschätzt; das ist eine Annäherung, kein Sprech- oder Schreibtest.")}</p>`
        : `<p class="small muted">${t("Gespräch und Schreiben werden hier mit kurzen „Was sagst/schreibst du?“-Aufgaben eingeschätzt. Vortrag (Sprechen) ist ausgenommen.")}</p>`}</div>
      <div class="card"><table class="plain"><thead><tr><th>${t("Thema")}</th><th>${t("Stand")}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderSettings() {
    const s = settings();
    const opt = (name, val, label) => `<label><input type="radio" name="${name}" value="${val}" ${s[name] === val ? "checked" : ""} data-setting="${name}"> ${label}</label>`;
    let ai = "";
    if (App.platform === "standalone") {
      const c = window.LBStandalone.getConfig(), pv = c.provider;
      const po = (v, l) => `<label><input type="radio" name="ai-provider" value="${v}" ${pv === v ? "checked" : ""} data-ai="provider"> ${l}</label>`;
      const fld = (path, label, val, type) => `<label class="stack small">${label}<input type="${type || "text"}" data-ai="${path}" value="${esc(val || "")}" autocomplete="off" spellcheck="false"></label>`;
      ai = `<fieldset class="stack"><legend><b>${t("KI-Anbieter")}</b></legend>
        <p class="small muted">${t(hasPlacement() ? "Tests, Rollenspiele und Checks ohne Katalog brauchen ein Sprachmodell (die Einstufung nicht). Der Schlüssel bleibt in diesem Browser und geht nur an den gewählten Anbieter. Setze beim Anbieter ein Ausgabenlimit." : "Tests, Rollenspiele, Einstufung und Checks ohne Katalog brauchen ein Sprachmodell. Der Schlüssel bleibt in diesem Browser und geht nur an den gewählten Anbieter. Setze beim Anbieter ein Ausgabenlimit.")}</p>
        <div class="opts">${po("none", t("Keiner (nur Katalog: Einstufung und Checks)"))}${po("anthropic", "Anthropic (Claude)")}${po("openai", t("OpenAI-kompatibel (auch lokal, z. B. Ollama, LM Studio)"))}</div>
        ${pv === "anthropic" ? fld("anthropic.key", t("API-Schlüssel"), c.anthropic.key, "password") + `<div class="row">${fld("anthropic.models.quick", t("Modell schnell"), c.anthropic.models.quick)}${fld("anthropic.models.default", t("Modell Standard"), c.anthropic.models.default)}${fld("anthropic.models.complex", t("Modell gründlich"), c.anthropic.models.complex)}</div>` : ""}
        ${pv === "openai" ? fld("openai.base", t("Basis-URL"), c.openai.base) + fld("openai.key", t("API-Schlüssel (leer für lokale Server)"), c.openai.key, "password") + `<div class="row">${fld("openai.models.quick", t("Modell schnell"), c.openai.models.quick)}${fld("openai.models.default", t("Modell Standard"), c.openai.models.default)}${fld("openai.models.complex", t("Modell gründlich"), c.openai.models.complex)}</div>` : ""}
        <div class="row"><button class="btn quiet small" data-act="ai-test">${t("Verbindung testen")}</button><span class="small muted" id="ai-msg">${t(App.sample ? "Eingerichtet." : "Nicht eingerichtet.")}</span></div></fieldset>`;
    }
    const where = t(App.platform === "standalone" ? "in diesem Browser (lokaler Speicher). Sichere sie ab und zu mit „Herunterladen“." : "privat in deinem Bereich dieses Artefakts.");
    return `<div class="card stack"><h2>${t("Einstellungen")}</h2>
      <fieldset class="stack"><legend><b>${t("Sprache der Oberfläche und der Aufgaben")}</b></legend><div class="opts">${opt("il", "de", "Deutsch")}${opt("il", "en", "English")}</div></fieldset>
      ${ai}
      <fieldset class="stack"><legend><b>${t("Sprachausgabe für Hörtests")}</b></legend><div class="opts">${opt("tts", "browser", t("Browser-Stimme") + " (" + esc(LN()) + ", " + (ukVoice ? t("gefunden: {v}", { v: esc(ukVoice.name) }) : t("keine passende Stimme gefunden – Edge oder Chrome haben Online-Stimmen")) + ")")}${App.platform === "standalone" ? "" : opt("tts", "claude", t("Claude-Stimme") + (App.tts ? "" : " " + t("(hier nicht verfügbar)")))}</div></fieldset>
      <fieldset class="stack"><legend><b>${t("Bewertung")}</b></legend><div class="opts">${opt("gradeTier", "default", t("Standard (spart Nutzung)"))}${opt("gradeTier", "complex", t("Gründlich (stärkeres Modell, verbraucht mehr)"))}</div></fieldset>
      <label><input type="checkbox" data-setting="validate" ${s.validate ? "checked" : ""}> ${t("Jeden Test vor dem Anzeigen zusätzlich prüfen lassen (empfohlen)")}</label>
      <fieldset class="stack"><legend><b>${t("Daten")}</b></legend>
      <div class="row"><button class="btn quiet" data-act="download">${t("Herunterladen (JSON)")}</button><button class="btn quiet" data-act="export">${t("In die Zwischenablage")}</button><label class="btn quiet">${t("Importieren")}<input type="file" accept="application/json,.json" id="import-file" hidden></label><span class="small muted" id="export-msg"></span></div>
      <p class="small muted">${t("{n} Tests gespeichert, {where} Import ergänzt Tests und ersetzt Einstellungen und Einstufungen.", { n: App.attempts.length, where })}</p></fieldset></div>`;
  }

  // ------------------------------------------------------------------ test runs
  function renderRun(run) {
    const head = `<p><button class="btn quiet" data-act="abort">← ${t("Abbrechen")}</button></p><div class="card stack"><div class="row"><h2>${esc(run.title)}</h2>${run.mode ? `<span class="chip st-untested">${esc(run.modeLabel)}</span>` : ""}</div>`;
    if (run.phase === "busy") return head + `<p><span class="spinner"></span>${esc(run.msg)}</p></div>`;
    if (run.phase === "error") return head + `<p class="bad">${esc(run.msg)}</p><div class="row"><button class="btn" data-act="retry">${t("Erneut versuchen")}</button></div></div>`;
    if (run.phase === "result") return `<p><button class="btn quiet" data-act="back">← ${t("Zurück")}</button></p>` + (run.type === "probe" ? renderProbeResult(run) : renderResult(run.attempt, false));
    // phase: ready
    const warn = run.warnings && run.warnings.length ? `<p class="note small">${t("Hinweis der Testprüfung:")} ${esc(run.warnings.map((w) => w.detail || w).join(" · "))}</p>` : "";
    if (run.type === "probe") return head + warn + renderProbeForm(run) + `</div>`;
    const f = run.form, m = run.mode;
    let body = "";
    if (m === "R") body = `<p class="muted small">${t("Lies das Dokument und beantworte die Fragen. Zeit: etwa 10 Minuten.")}</p>${(f.stimuli || []).map((s) => `<div class="doc" ${LA()}>${esc(s.body)}</div>`).join("")}${renderItems(f.items, run)}`;
    if (m === "L") body = `<p class="muted small">${t("Jeder Clip kann zweimal abgespielt werden. Der Text wird erst nach der Abgabe gezeigt.")}</p>${renderItems(f.items, run, true)}`;
    if (run.type === "check") body = `<p class="muted small">${t("{n} Aufgaben aus verschiedenen Unterregeln. Groß- und Kleinschreibung zählt nicht.", { n: f.items.length })}</p>${f.items.some((it) => it.type !== "mcq") ? kbd() : ""}${renderItems(f.items, run)}`;
    if (m === "WI") body = `${(f.stimuli || []).map((s) => `<div class="stack"><span class="small muted">${esc(s.title || "")}</span><div class="${s.kind === "message" ? "msg" : "doc"}" ${LA()}>${esc(s.body)}</div></div>`).join("")}
      ${f.situation ? `<p>${esc(f.situation)}</p>` : ""}<div><b>${t("Das soll in deinem Text vorkommen:")}</b><ul>${(f.brief || []).map((c) => `<li>${esc(c.text)}${c.must ? "" : ` <span class="muted small">${t("(optional)")}</span>`}</li>`).join("")}</ul></div>
      ${kbd()}<textarea id="wi-text" ${LA()} data-ans="__text" placeholder="${esc(t("Auf {lang} schreiben …", { lang: LN() }))}">${esc(run.answers.__text || "")}</textarea>
      <p class="small muted" id="wc">${t("{n} Wörter · Ziel {range}", { n: wordCount(run.answers.__text), range: (f.word_range || [20, 60]).join("–") })}</p>`;
    if (m === "SI") return head + warn + renderChat(run) + `</div>`;
    return head + warn + body + `<div class="row"><button class="btn" data-act="submit">${t("Abgeben")}</button></div></div>`;
  }

  function kbd() { return `<div class="keys" aria-label="${t("Sonderzeichen")}">${(META().keyboard || []).map((k) => `<button type="button" data-act="key" data-k="${esc(k)}">${k === "\u200c" ? "ZWNJ" : esc(k)}</button>`).join("")}<span class="small muted">${esc(t("Tipp: Tastatur für {lang} im System aktivieren.", { lang: LN() }))}</span></div>`; }
  function wordCount(t) { return (String(t || "").trim().match(/\S+/g) || []).length; }

  function renderItems(items, run, audio) {
    let prevInstr = null;
    return `<div>${(items || []).map((it, n) => {
      if (it.instruction) { const same = it.instruction === prevInstr; prevInstr = it.instruction; if (same) it = Object.assign({}, it, { instruction: "" }); }
      const v = run.answers[it.id] || "";
      const clip = audio && it.stimulus != null ? `<button class="btn secondary small" data-act="play" data-i="${it.stimulus}" ${(run.plays[it.stimulus] || 0) >= 2 ? "disabled" : ""}>▶ Clip ${it.stimulus + 1} (${t("{n}× übrig", { n: 2 - (run.plays[it.stimulus] || 0) })})</button>` : "";
      const input = it.type === "mcq"
        ? `<div class="opts">${(it.options || []).map((o) => `<label><input type="radio" name="q-${esc(it.id)}" value="${esc(o)}" data-ans="${esc(it.id)}" ${v === o ? "checked" : ""}> <span ${LA()}>${esc(o)}</span></label>`).join("")}</div>`
        : `<input type="text" ${LA()} data-ans="${esc(it.id)}" value="${esc(v)}" autocomplete="off">`;
      return `<div class="item"><div class="row">${clip}<span class="q">${n + 1}. ${itemLabel(it)}</span></div>${input}</div>`;
    }).join("")}</div>`;
  }

  function itemLabel(it) {
    if (!it.stem) return esc(it.prompt);
    const stem = esc(it.stem).split("___").join('<span class="gap">___</span>');
    return `${it.instruction ? `<span class="instr">${esc(it.instruction)}</span>` : ""}${it.context ? `<span class="ctx">${esc(it.context)}</span>` : ""}<span class="stem" ${LA()}>${stem}</span>${it.cue ? ` <span class="cue" ${LA()}>(${esc(it.cue)})</span>` : ""}`;
  }

  function renderChat(run) {
    const rp = run.form.roleplay;
    const bubbles = run.transcript.map((x) => `<div class="bubble ${x.speaker === "learner" ? "me" : "them"}" ${LA()}>${esc(x.text)}</div>`).join("");
    const over = run.chatOver;
    return `<p><b>${t("Dein Ziel:")}</b> ${esc(rp.learner_goal)}</p><p class="small muted">${esc(rp.setting)} ${t("Du schreibst, als ob du sprichst. Getippte Rollenspiele zeigen deinen Stand, vergeben aber kein Sprech-Abzeichen.")}</p>
      <div class="chat" id="chat">${bubbles}${run.thinking ? `<div class="bubble them"><span class="spinner"></span></div>` : ""}</div>
      ${over ? `<p class="muted">${t("Das Gespräch ist beendet.")}</p>` : `${kbd()}<div class="row"><input type="text" id="chat-in" ${LA()} placeholder="${esc(t("Deine Antwort auf {lang} …", { lang: LN() }))}" ${run.thinking ? "disabled" : ""}><button class="btn" data-act="send" ${run.thinking ? "disabled" : ""}>${t("Senden")}</button></div>`}
      <div class="row"><button class="btn ${over ? "" : "quiet"}" data-act="submit" ${run.transcript.filter((x) => x.speaker === "learner").length ? "" : "disabled"}>${t("Gespräch beenden und bewerten")}</button></div>`;
  }

  const tProxy = (o) => new Proxy(o, { get: (x, k) => (k in x ? t(x[k]) : undefined) });
  const BAND_DE = tProxy({ core: "Grundregel", variant: "Varianten", exception: "Ausnahmen", contrast: "Abgrenzung" });
  const BAND_HINT = tProxy({ core: "die Regel mit häufigen Wörtern", variant: "regelmäßige Unterfälle, z. B. Lautwechsel", exception: "Formen zum Auswendiglernen", contrast: "wann die Form gilt, gegen eine Verwechslungsform" });
  function issueUrl(a, it, given) {
    const title = `[${App.lang}] ${a.skill} ${it.id}: Antwort „${given}“`;
    const body = `**Baustein:** ${a.skill}\n**Aufgabe:** ${it.id} (${it.band || "?"}/${it.facet || "?"})\n**Satz:** ${it.stem || it.prompt}${it.cue ? " (" + it.cue + ")" : ""}\n**Meine Antwort:** ${given}\n**Akzeptiert:** ${(it.key || []).join(" / ")}\n\n**Warum ist meine Antwort auch richtig, oder was ist an der Aufgabe falsch?**\n\n`;
    return `${App.C.repo_url}/issues/new?labels=catalogue&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  }

  function renderResult(a, standalone) {
    if (!a) return `<p class="muted">${t("Test nicht gefunden.")}</p>`;
    const s = skillById(a.skill), isCheck = a.kind === "enabler_check";
    const title = isCheck ? TT(App.C.enablers[a.skill] || {}) : TT(s);
    const typed = s && !BADGEABLE.has(s.mode);
    const st = s && statusOf(s);
    const verdict = isCheck && !a.voided && a.outcome.breakdown ? "" : a.voided ? `<div class="verdict info"><b>${t("Als fehlerhaft markiert")}</b><span>${t("Dieser Test zählt nicht.")}</span></div>`
      : typed ? `<div class="verdict info"><b>${t("Einschätzung:")} ${ST_DE[LB.heatmapStatus(a.outcome)]}</b><span>${esc(trReason(a.outcome.reason))} · ${pct(a.outcome.score)}. ${t("Kein Sprech-Abzeichen aus getippten Gesprächen.")}</span></div>`
      : `<div class="verdict ${a.outcome.passed ? "pass" : "fail"}"><b>${t(a.outcome.passed ? "Bestanden" : "Nicht bestanden")}</b><span>${esc(trReason(a.outcome.reason))} · ${pct(a.outcome.score)} (${t("nötig:")} ${pct(a.outcome.threshold)})</span>
        ${!isCheck && st ? `<span>${st.status === "badge" ? "🏅 " + t("Abzeichen erhalten") + "." : t("Abzeichen: {n} von 2 bestanden.", { n: st.badge.passes || 0 }) + ` ${esc(trReason(st.badge.reason))}.`}</span>` : ""}</div>`;
    let detail = "";
    const f = a.form;
    if (isCheck && !a.voided && a.outcome.breakdown) {
      const bd = a.outcome.breakdown;
      const head = `<div class="verdict ${bd.status === "known" ? "pass" : bd.status === "shaky" ? "info" : "fail"}"><b>${ST_DE[bd.status]}</b><span>${esc(trReason(bd.verdict))} · ${t("{p} richtig (sicher ab {thr} und ohne Fehler bei der Grundregel)", { p: pct(bd.score), thr: pct(a.outcome.threshold) })}</span></div>`;
      const rows = LB.BANDS.filter((b) => bd.bands[b]).map((b) => { const x = bd.bands[b]; return `<tr><td>${BAND_DE[b]}</td><td class="num ${x.right === x.total ? "ok" : "bad"}">${x.right}/${x.total}</td><td class="small muted">${BAND_HINT[b]}</td></tr>`; }).join("");
      detail += head + `<div class="card stack"><h3>${t("Nach Art der Aufgabe")}</h3><table class="plain"><tbody>${rows}</tbody></table></div>`;
      detail += `<div class="card stack"><h3>${t("Deine Antworten")}</h3><table class="plain"><thead><tr><th>#</th><th>${t("Aufgabe")}</th><th>${t("Deine Antwort")}</th><th>${t("Lösung")}</th></tr></thead><tbody>${f.items.map((it, n) => {
        const ok = a.grade.item_results[it.id], given = (a.response.answers || {})[it.id] || "";
        const dispute = !ok && f.source === "catalogue" && App.C.repo_url ? ` <a class="small" target="_blank" rel="noopener" href="${esc(issueUrl(a, it, given))}">${t("Einspruch")}</a>` : "";
        return `<tr><td class="num">${n + 1}</td><td>${itemLabel(it)}${!ok && it.rule ? `<div class="small muted">${t("Regel:")} ${esc(it.rule)}</div>` : ""}</td><td ${LA()} class="${ok ? "ok" : "bad"}">${esc(given || "—")}</td><td><span ${LA()}>${esc((it.key || [])[0])}</span>${dispute}</td></tr>`;
      }).join("")}</tbody></table>${f.source === "catalogue" ? `<p class="small muted">${t("Aufgaben aus dem Fragenkatalog, bewertet nur nach Lösungsschlüssel. Ist deine Antwort auch richtig oder die Aufgabe fehlerhaft? „Einspruch“ öffnet eine Meldung auf GitHub.")}</p>` : ""}</div>`;
    } else if (f.items && f.items.length) {
      detail += `<div class="card stack"><h3>${t("Deine Antworten")}</h3><table class="plain"><thead><tr><th>#</th><th>${t("Frage")}</th><th>${t("Deine Antwort")}</th><th>${t("Lösung")}</th></tr></thead><tbody>${f.items.map((it, n) => {
        const ok = a.grade.item_results[it.id];
        return `<tr><td class="num">${n + 1}</td><td>${esc(it.prompt)}</td><td ${LA()} class="${ok ? "ok" : "bad"}">${esc((a.response.answers || {})[it.id] || "—")}</td><td ${LA()}>${esc((it.key || [])[0])}</td></tr>`;
      }).join("")}</tbody></table>
      ${(f.stimuli || []).some((x) => x.kind === "audio_script") ? `<details><summary>${t("Hörtexte anzeigen")}</summary>${f.stimuli.map((x, i) => `<p ${LA()}><b>Clip ${i + 1}:</b> ${esc(x.body)}</p>`).join("")}</details>` : ""}</div>`;
    }
    if (a.grade.criteria && a.grade.criteria.length) {
      const rub = App.C.rubrics[f.rubric];
      detail += `<div class="card stack"><h3>${t("Bewertung")}</h3>${a.feedback ? `<p>${esc(a.feedback)}</p>` : ""}<table class="plain"><thead><tr><th>${t("Kriterium")}</th><th>${t("Stufe")}</th><th>${t("Belege")}</th></tr></thead><tbody>${a.grade.criteria.map((c) => {
        const rc = rub.criteria.find((x) => x.id === c.id) || {};
        return `<tr><td>${esc(CRIT_DE0[c.id] ? t(CRIT_DE0[c.id]) : c.id)}${rc.must ? "" : ` <span class="muted small">${t("(optional)")}</span>`}</td><td class="${c.level >= 2 ? "ok" : "bad"}">${c.level} – ${LEVEL_DE0[c.level] ? t(LEVEL_DE0[c.level]) : ""}</td><td ${LA()}>${esc((c.evidence || []).join(" · "))}</td></tr>`;
      }).join("")}</tbody></table>${a.regraded ? `<p class="small muted">${t("Knapp am Grenzwert: dreimal unabhängig bewertet, der Median zählt.")}</p>` : ""}</div>`;
    }
    if (a.response.text) detail += `<div class="card stack"><h3>${t("Dein Text")}</h3><div class="doc" ${LA()}>${esc(a.response.text)}</div></div>`;
    if (a.response.transcript) detail += `<div class="card stack"><h3>${t("Gespräch")}</h3><div class="chat">${a.response.transcript.map((x) => `<div class="bubble ${x.speaker === "learner" ? "me" : "them"}" ${LA()}>${esc(x.text)}</div>`).join("")}</div></div>`;
    const errs = (a.grade.errors || []);
    if (errs.length) detail += `<div class="card stack"><h3>${t("Fehler")}</h3><table class="plain"><thead><tr><th>${t("Stelle")}</th><th>${t("Richtig")}</th><th>${t("Baustein")}</th></tr></thead><tbody>${errs.map((e) =>
      `<tr><td ${LA()} class="bad">${esc(e.span)}</td><td ${LA()}>${esc(e.correction)}</td><td>${e.chunk ? t("feste Wendung:") + " <span lang=\"" + esc(App.lang) + "\">" + esc(e.chunk) + "</span>" : esc(TT(App.C.enablers[e.enabler] || {}) || e.enabler || "—")}</td></tr>`).join("")}</tbody></table></div>`;
    if (!isCheck) {
      const dx = LB.diagnose(f, a.grade, App.C.enablers, enablerStatus());
      if (dx.holes.length || dx.chunks.length) {
        detail += `<div class="card stack"><h3>${t("Wahrscheinliche Lücken")}</h3>${dx.holes.slice(0, 4).map((h) => `<div class="stack"><div><b>${esc(TT(App.C.enablers[h.enabler] || h))}</b> <span class="muted small">${esc(h.cefr)} · ${t("{n} Hinweis(e)", { n: h.errors })}</span></div>
          <div class="row small">${t("Zuerst prüfen:")} ${h.check_first.filter((id) => (App.C.enablers[id] || {}).channel === "text").map((id) => `<button class="btn quiet small" data-act="start-check" data-id="${esc(id)}">${esc(TT(App.C.enablers[id]))}</button>`).join(" ") || "—"}</div></div>`).join("")}
          ${dx.chunks.length ? `<p class="small">${t("Feste Wendungen zum Üben (keine Grammatiklücke):")} <span ${LA()}>${dx.chunks.map(esc).join(", ")}</span></p>` : ""}</div>`;
      }
    }
    const actions = `<div class="row">${s && TESTABLE.has(s.mode) ? `<button class="btn" data-act="start-test" data-id="${esc(s.id)}">${t("Neuer Test")}</button>` : ""}${isCheck ? `<button class="btn" data-act="start-check" data-id="${esc(a.skill)}">${t("Neuer Check")}</button>` : ""}
      ${!a.voided ? `<button class="btn quiet" data-act="void" data-id="${esc(a.id)}">${t("Fehlerhafte Aufgabe melden (Test zählt nicht)")}</button>` : ""}</div>`;
    return (standalone ? `<p><button class="btn quiet" data-act="back">← ${t("Zurück")}</button></p>` : "") + `<h2>${esc(title)}</h2><p class="small muted">${esc(a.takenOn)}</p>${verdict}${detail}${actions}`;
  }

  // ------------------------------------------------------------------ test flow
  function newRun(type, title, mode) {
    return { type, title, mode, modeLabel: MODE_DE[mode] || (type === "check" ? "Check" : t("Einstufung")), phase: "busy", msg: "", answers: {}, plays: {}, transcript: [] };
  }
  function setRun(run, patch) { Object.assign(run, patch); if (App.screen && App.screen.run === run) render(); }

  function normalizeForm(raw, meta) {
    const f = Object.assign({ stimuli: [], items: [], brief: [] }, raw || {});
    f.items = (f.items || []).map((it, i) => Object.assign({}, it, {
      id: String(it.id || "i" + (i + 1)), type: it.type || (it.options ? "mcq" : "short_answer"),
      key: Array.isArray(it.key) ? it.key.map(String) : [String(it.key || "")], options: it.options ? it.options.map(String) : undefined,
      enablers: (it.enablers || []).filter((e) => App.C.enablers[e]),
    }));
    return Object.assign(f, meta);
  }

  function structural(form, mode) {
    const p = [];
    if (mode === "R" || mode === "L" || mode === "check") {
      if (form.items.length < 8) p.push("zu wenige Aufgaben");
      form.items.forEach((it) => { if (it.type === "mcq" && !(it.options || []).some((o) => LB.normalize(o) === LB.normalize(it.key[0]))) p.push(`Aufgabe ${it.id}: Lösung nicht unter den Optionen`); });
      if (mode === "L") form.items.forEach((it) => { if (it.stimulus == null || !form.stimuli[it.stimulus]) p.push(`Aufgabe ${it.id}: kein Clip`); });
      if (mode !== "check" && !form.stimuli.length) p.push("kein Material");
    }
    if (mode === "WI" && (form.brief.length < 3)) p.push("zu wenige Inhaltspunkte");
    if (mode === "SI" && !(form.roleplay && form.roleplay.opening_line && (form.roleplay.required_moves || []).length >= 3)) p.push("unvollständiges Rollenspiel");
    return p;
  }

  async function startTest(id) {
    const s = skillById(id), real = App.C.realizations[id];
    const run = newRun("test", TT(s), s.mode);
    App.screen = { kind: "run", run }; run.start = () => startTest(id);
    setRun(run, { phase: "busy", msg: t("Test wird erstellt …") });
    try {
      const seen = myAttempts().filter((a) => a.skill === id && a.form).map((a) => a.form.summary).filter(Boolean).slice(-8);
      const prev = myAttempts().filter((a) => a.skill === id && a.form);
      let form = null, warnings = [], avoid = "", seed = Math.floor(Math.random() * 1e6);
      for (let k = 0; k < 2; k++, seed++) {
        setRun(run, { msg: t(k ? "Neuer Versuch: Test wird erstellt …" : "Test wird erstellt …") });
        const raw = await ask(LB.genPrompt(s, real, App.C.enablers, seed, seen, settings().il, avoid), "default");
        form = normalizeForm(raw, { id: "f-" + rid(), kind: "full", skill: id, lang: App.lang, seed, mode: s.mode, rubric: s.rubric, template: s.mode, generator: "sample:default" });
        const probs = structural(form, s.mode);
        if (prev.some((a) => LB.formSimilarity(a.form, form) > App.cfg.max_form_similarity)) probs.push("zu ähnlich wie ein früherer Test");
        if (!probs.length && settings().validate) {
          setRun(run, { msg: t("Test wird geprüft …") });
          const v = await ask(LB.validatePrompt(form, real), "quick");
          const pr = (v && v.problems) || [];
          pr.filter((x) => x.severity === "blocker").forEach((x) => probs.push(`${x.where}: ${x.detail}`));
          warnings = pr.filter((x) => x.severity !== "blocker");
        }
        if (!probs.length) break;
        avoid = probs.join("; ");
        if (k === 1) warnings = [{ detail: t("Die Prüfung fand Probleme, die nicht behoben wurden: {p}. Wenn eine Aufgabe falsch ist, melde den Test als fehlerhaft.", { p: avoid }) }];
      }
      run.form = form; run.warnings = warnings;
      if (s.mode === "SI") run.transcript = [{ speaker: "interlocutor", text: form.roleplay.opening_line }];
      setRun(run, { phase: "ready" });
    } catch (e) { setRun(run, { phase: "error", msg: e.message }); }
  }

  async function startCheck(id) {
    const en = App.C.enablers[id], cat = App.C.checks[id];
    const run = newRun("check", "Check: " + TT(en), null);
    App.screen = { kind: "run", run }; run.start = () => startCheck(id);
    const n = en.items || 10, seed = Math.floor(Math.random() * 1e6);
    if (cat) {   // fixed catalogue: no Claude call, items spread over bands and facets, least-seen first
      const seen = {};
      myAttempts().filter((a) => a.skill === id && a.form && !a.voided).forEach((a) => (a.form.items || []).forEach((it) => (seen[it.id] = (seen[it.id] || 0) + 1)));
      const items = LB.catalogueForm(cat, LB.sampleCheck(cat, n, seen, seed), settings().il);
      run.form = { id: "f-" + rid(), kind: "enabler_check", skill: id, lang: App.lang, seed, source: "catalogue", rubric: "rubric.enabler-check.v1", template: "enabler-check.v1", items, stimuli: [], brief: [] };
      setRun(run, { phase: "ready" });
      return;
    }
    setRun(run, { phase: "busy", msg: t("Für diesen Baustein gibt es noch keinen Fragenkatalog. Check wird erstellt …") });
    try {
      const raw = await ask(LB.enablerCheckPrompt(en, settings().il, seed), "default");
      run.form = normalizeForm(raw, { id: "f-" + rid(), kind: "enabler_check", skill: id, lang: App.lang, seed, source: "generated", rubric: "rubric.enabler-check.v1", template: "enabler-check.v1" });
      run.form.items.forEach((it) => {
        if (!it.enablers.length) it.enablers = [id];
        if (it.format) it.type = it.format === "choice" ? "mcq" : "gap_fill";
        if (it.stem && !it.prompt) it.prompt = it.stem + (it.cue ? " (" + it.cue + ")" : "");
        it.rule = it.rule || it.facet || "";
      });
      const probs = structural(run.form, "check");
      run.warnings = probs.map((p) => ({ detail: p }));
      setRun(run, { phase: "ready" });
    } catch (e) { setRun(run, { phase: "error", msg: e.message }); }
  }

  async function gradeItems(form, answers, strict) {
    const { results, unsure } = LB.gradeKeyed(form, answers);
    if (unsure.length) {
      const items = unsure.map((id) => { const it = form.items.find((x) => x.id === id); return { id, type: strict ? "gap_fill" : it.type, prompt: it.prompt, key: it.key, answer: answers[id] }; });
      const j = await ask(LB.judgePrompt(items), "quick");
      ((j && j.results) || []).forEach((r) => { if (r && r.id in results && r.correct === true) results[r.id] = true; });
    }
    return { item_results: results, errors: [], grader: "key+judge:quick" };
  }

  async function gradeOpen(s, form, text) {
    const real = App.C.realizations[s.id], rub = App.C.rubrics[form.rubric], tier = settings().gradeTier;
    const prompt = LB.gradePrompt(s, form, rub, real, App.C.enablers, text, settings().il);
    const clean = (g) => ({ grader: "sample:" + tier, item_results: {}, criteria: rub.criteria.map((c) => {
      const x = ((g && g.criteria) || []).find((y) => y.id === c.id) || { level: 0, confidence: 0, evidence: ["nicht bewertet"] };
      return { id: c.id, level: Math.max(0, Math.min(3, Math.round(+x.level || 0))), confidence: +x.confidence || 0, evidence: x.evidence || [] };
    }), errors: ((g && g.errors) || []).map((e) => Object.assign({}, e, { enabler: e.enabler && (App.C.enablers[e.enabler] || String(e.enabler).startsWith("unlisted")) ? e.enabler : null })), feedback: g && g.feedback });
    let g = clean(await ask(prompt, tier));
    const thr = LB.thresholdFor(s, App.cfg);
    let regraded = false;
    if (LB.needsRegrade(rub, g, thr, App.cfg)) {
      const more = await Promise.all([ask(prompt, tier), ask(prompt, tier)]);
      const fb = g.feedback;
      g = LB.medianGrade([g, ...more.map(clean)]); g.feedback = fb; regraded = true;
    }
    return { grade: g, regraded };
  }

  async function submit(run) {
    const f = run.form;
    setRun(run, { phase: "busy", msg: t("Wird bewertet …") });
    try {
      let grade, feedback = null, regraded = false, response;
      if (run.type === "check") { response = { answers: run.answers }; grade = f.source === "catalogue" ? { item_results: LB.gradeKeyed(f, run.answers).results, errors: [], grader: "key:catalogue" } : await gradeItems(f, run.answers, true); }
      else if (run.mode === "R" || run.mode === "L") { response = { answers: run.answers }; grade = await gradeItems(f, run.answers, false); }
      else {
        const s = skillById(f.skill);
        const text = run.mode === "SI" ? run.transcript.map((x) => (x.speaker === "learner" ? "Lernende: " : "Gegenüber: ") + x.text).join("\n") : run.answers.__text || "";
        response = run.mode === "SI" ? { transcript: run.transcript } : { text };
        const r = await gradeOpen(s, f, text); grade = r.grade; regraded = r.regraded; feedback = grade.feedback; delete grade.feedback;
      }
      const rub = App.C.rubrics[f.rubric];
      const thr = run.type === "check" ? ((App.C.enablers[f.skill] || {}).threshold || 0.9) : LB.thresholdFor(skillById(f.skill), App.cfg);
      const outcome = LB.attemptOutcome(rub, grade, thr, App.cfg);
      if (run.type === "check") { const bd = LB.checkBreakdown(f.items, grade.item_results, thr); Object.assign(outcome, { passed: bd.status === "known", reason: bd.verdict, breakdown: bd }); }
      const a = { id: "a-" + Date.now().toString(36) + rid().slice(0, 4), lang: App.lang, skill: f.skill, kind: f.kind, mode: run.mode || "check",
        channel: run.mode === "L" ? "tts" : "text", seed: f.seed, takenOn: today(), at: nowIso(), form: f, response, grade, outcome, feedback, regraded, voided: false };
      App.attempts.push(a); saveAttempt(a);
      if (run.type === "check") { App.profile.checks[f.skill] = { score: outcome.score, status: outcome.breakdown.status, at: a.at, attempt: a.id, source: f.source || "generated" }; saveProfile(); }
      else {
        const s = skillById(f.skill), st = statusOf(s);
        if (st.status === "badge" && !App.profile.badges[pk(s.id)]) { App.profile.badges[pk(s.id)] = { awardedAt: a.at, pair: st.badge.pair }; saveProfile(); }
      }
      setRun(run, { phase: "result", attempt: a });
    } catch (e) { run.start = () => submit(run); setRun(run, { phase: "error", msg: e.message }); }
  }

  async function sendChat(run) {
    const inp = $("#chat-in"); const text = (inp && inp.value || "").trim();
    if (!text || run.thinking) return;
    run.transcript.push({ speaker: "learner", text });
    setRun(run, { thinking: true });
    try {
      const r = await ask(LB.interlocutorPrompt(run.form.roleplay, run.transcript, App.C.realizations[run.form.skill]), "default");
      run.transcript.push({ speaker: "interlocutor", text: String((r && r.text) || "…") });
      const turns = run.transcript.filter((x) => x.speaker === "interlocutor").length;
      setRun(run, { thinking: false, chatOver: !!(r && r.conversation_over) || turns >= (run.form.roleplay.max_turns || 12) });
    } catch (e) { setRun(run, { thinking: false }); setNote(e.message); }
  }

  // ------------------------------------------------------------------ placement
  // Skills with a placement catalogue are probed from it (no model call); the rest fall back to generated items.
  function canSpeak() { return !!ukVoice || (settings().tts === "claude" && !!App.tts); }
  async function startProbe(themeId) {
    const th = App.C.themes.find((x) => x.id === themeId);
    const skills = probeSkills(themeId);
    const run = newRun("probe", t("Einstufung") + ": " + TT(th), null);
    run.theme = themeId; run.revealed = {};
    App.screen = { kind: "run", run }; run.start = () => startProbe(themeId);
    setRun(run, { phase: "busy", msg: t("Einstufung wird erstellt …") });
    try {
      const seed = Math.floor(Math.random() * 1e9);
      const fromCat = skills.filter((s) => App.C.placement[s.id]);
      const rest = skills.filter((s) => !App.C.placement[s.id] && s.mode !== "SP");
      run.probe = fromCat.map((s) => {
        const cat = App.C.placement[s.id], prev = App.profile.probes[pk(s.id)];
        return { skill: s.id, source: "catalogue", items: LB.placementForm(cat, LB.samplePlacement(cat, (prev && prev.seen) || {}, seed), settings().il, seed) };
      });
      if (rest.length && App.sample) {
        const raw = await ask(LB.probePrompt(th, rest, App.C.realizations, App.C.enablers, settings().il, seed), "default");
        ((raw && raw.skills) || []).filter((x) => skillById(x.skill)).forEach((x) => run.probe.push({
          skill: x.skill, source: "generated",
          items: normalizeForm({ items: (x.items || []).slice(0, 3) }, {}).items.map((it, i) => Object.assign(it, { id: x.skill + "#" + i, audio: x.stimulus && x.stimulus.kind === "audio_script" ? x.stimulus.body : null, text: x.stimulus && x.stimulus.kind !== "audio_script" ? x.stimulus.body : null, shared: true })),
        }));
      } else if (rest.length) run.skipped = rest.map((s) => s.id);
      const order = skills.map((s) => s.id);
      run.probe.sort((a, b) => order.indexOf(a.skill) - order.indexOf(b.skill));
      if (!run.probe.length) throw new Error(t(rest.length ? "Für dieses Thema gibt es keinen Katalog; die Einstufung braucht einen KI-Anbieter (Einstellungen)." : "Die Einstufung kam leer zurück. Bitte erneut versuchen."));
      setRun(run, { phase: "ready" });
    } catch (e) { setRun(run, { phase: "error", msg: e.message }); }
  }

  function probeItem(run, it, n) {
    const v = run.answers[it.id] || "";
    const plays = run.plays[it.id] || 0;
    let audio = "";
    if (it.audio && !(it.shared && n > 0)) {
      audio = run.revealed[it.id] ? `<div class="doc" ${LA()}>${esc(it.audio)}</div><p class="small muted">${t("Text angezeigt: diese Kompetenz wird nicht gewertet.")}</p>`
        : `<div class="row"><button class="btn secondary small" data-act="play-probe" data-id="${esc(it.id)}" ${plays >= 2 ? "disabled" : ""}>▶ ${t("Anhören")} (${t("{n}× übrig", { n: 2 - plays })})</button>${canSpeak() ? "" : ` <button class="btn quiet small" data-act="reveal" data-id="${esc(it.id)}">${t("Keine Stimme? Text zeigen")}</button>`}</div>`;
    }
    const text = it.text && !(it.shared && n > 0) ? `<div class="doc" ${LA()}>${esc(it.text)}</div>` : "";
    const ctx = it.context ? `<div class="bubble them" ${LA()}>${esc(it.context)}</div>` : "";
    const stem = it.stem ? `<div><span class="stem" ${LA()}>${esc(it.stem).split("___").join('<span class="gap">___</span>')}</span>${it.cue ? ` <span class="cue" ${LA()}>(${esc(it.cue)})</span>` : ""}</div>` : "";
    const input = it.type === "mcq"
      ? `<div class="opts">${(it.options || []).map((o) => `<label><input type="radio" name="q-${esc(it.id)}" value="${esc(o)}" data-ans="${esc(it.id)}" ${v === o ? "checked" : ""}> <span ${LA()}>${esc(o)}</span></label>`).join("")}</div>`
      : `<input type="text" ${LA()} data-ans="${esc(it.id)}" value="${esc(v)}" autocomplete="off" placeholder="${t(it.stem ? "Lücke" : "Antwort")}">`;
    return `<div class="item stack"><span class="q">${esc(it.prompt)}</span>${audio}${text}${ctx}${stem}${input}</div>`;
  }

  function renderProbeForm(run) {
    const voiceNote = !canSpeak() && run.probe.some((p) => p.items.some((it) => it.audio))
      ? `<p class="note">${esc(t(App.tts ? "Für {lang} ist keine Stimme verfügbar, Hör-Aufgaben lassen sich nicht abspielen. Edge oder Chrome haben Online-Stimmen, oder wähle in den Einstellungen die Claude-Stimme. Mit „Text zeigen“ kannst du trotzdem weitermachen; Hören wird dann nicht gewertet." : "Für {lang} ist keine Stimme verfügbar, Hör-Aufgaben lassen sich nicht abspielen. Edge oder Chrome haben Online-Stimmen. Mit „Text zeigen“ kannst du trotzdem weitermachen; Hören wird dann nicht gewertet.", { lang: LN() }))}</p>` : "";
    const skipped = run.skipped && run.skipped.length ? `<p class="note info">${t("Ohne Katalog und ohne KI-Anbieter übersprungen:")} ${run.skipped.map((id) => esc(TT(skillById(id)))).join(", ")}.</p>` : "";
    return voiceNote + skipped + run.probe.map((p) => {
      const s = skillById(p.skill);
      return `<div class="card stack"><div class="row"><h3>${esc(TT(s))}</h3><span class="chip st-untested">${MODE_DE[s.mode]}</span></div>${p.items.map((it, n) => probeItem(run, it, n)).join("")}</div>`;
    }).join("") + kbd() + `<div class="row"><button class="btn" data-act="submit-probe">${t("Abgeben")}</button></div>`;
  }

  async function submitProbe(run) {
    setRun(run, { phase: "busy", msg: t("Wird ausgewertet …") });
    try {
      const results = {};
      run.probe.filter((p) => p.source === "catalogue").forEach((p) => p.items.forEach((it) => (results[it.id] = LB.placementCorrect(it, run.answers[it.id]))));
      const gen = run.probe.filter((p) => p.source !== "catalogue").flatMap((p) => p.items);
      if (gen.length) {
        const keyed = LB.gradeKeyed({ items: gen }, run.answers);
        const toJudge = gen.filter((it) => !keyed.results[it.id] && (run.answers[it.id] || "").trim() && it.type !== "mcq")
          .map((it) => ({ id: it.id, type: it.type, prompt: it.prompt, key: it.key, answer: run.answers[it.id] }));
        if (toJudge.length && App.sample) {
          const j = await ask(LB.judgePrompt(toJudge), "default");
          ((j && j.results) || []).forEach((r) => { if (r && r.id in keyed.results && r.correct === true) keyed.results[r.id] = true; });
        }
        Object.assign(results, keyed.results);
      }
      const at = nowIso();
      run.probeResults = run.probe.map((p) => {
        const correct = p.items.filter((it) => results[it.id]).length, total = p.items.length || 3;
        if (p.items.some((it) => run.revealed[it.id])) return { skill: p.skill, correct, total, status: null };
        const status = LB.probeStatus(correct, total);
        const prev = App.profile.probes[pk(p.skill)] || {};
        const seen = Object.assign({}, prev.seen || {});
        if (p.source === "catalogue") p.items.forEach((it) => (seen[it.itemId] = (seen[it.itemId] || 0) + 1));
        App.profile.probes[pk(p.skill)] = { status, correct, total, at, source: p.source, seen };
        return { skill: p.skill, correct, total, status };
      });
      run.itemResults = results;
      saveProfile();
      setRun(run, { phase: "result" });
    } catch (e) { run.start = () => submitProbe(run); setRun(run, { phase: "error", msg: e.message }); }
  }

  function probeIssueUrl(it, given) {
    const title = `[${App.lang}] Einstufung ${it.skill} ${it.itemId}: Antwort „${given}“`;
    const body = `**Kompetenz:** ${it.skill}\n**Aufgabe:** ${it.itemId} (${it.facet})\n**Aufgabe:** ${it.prompt}\n${it.context ? "**Kontext:** " + it.context + "\n" : ""}${it.stem ? "**Satz:** " + it.stem + (it.cue ? " (" + it.cue + ")" : "") + "\n" : ""}**Meine Antwort:** ${given}\n**Akzeptiert:** ${it.key.join(" / ")}\n\n**Warum ist meine Antwort auch richtig, oder was ist an der Aufgabe falsch?**\n\n`;
    return `${App.C.repo_url}/issues/new?labels=catalogue,placement&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  }

  function nextTheme(run) {
    const ids = App.C.themes.map((x) => x.id).filter((id) => probeSkills(id).length);
    const after = ids.slice(ids.indexOf(run.theme) + 1).concat(ids.slice(0, ids.indexOf(run.theme)));
    return after.find((id) => !probeSkills(id).some((s) => App.profile.probes[pk(s.id)])) || null;
  }

  function renderProbeResult(run) {
    const rows = run.probeResults.map((r) => { const s = skillById(r.skill); return `<tr><td>${esc(TT(s))}</td><td>${MODE_DE[s.mode]}</td><td class="num">${r.correct}/${r.total}</td><td>${r.status ? chip(r.status) : `<span class="small muted">${t("nicht gewertet")}</span>`}</td><td>${TESTABLE.has(s.mode) ? `<button class="btn quiet small" data-act="open-skill" data-id="${esc(s.id)}">${t("öffnen")}</button>` : ""}</td></tr>`; }).join("");
    const review = run.probe.map((p) => p.items.map((it) => {
      const ok = run.itemResults[it.id], given = run.answers[it.id] || "";
      const q = [it.facetLabel ? `<span class="small muted">${esc(it.facetLabel)}</span>` : "", esc(it.prompt), it.context ? `<span class="ctx" ${LA()}>${esc(it.context)}</span>` : "", it.stem ? `<span ${LA()}>${esc(it.stem)}${it.cue ? " (" + esc(it.cue) + ")" : ""}</span>` : ""].filter(Boolean).join("<br>");
      const dispute = !ok && given && it.source === "catalogue" && App.C.repo_url ? ` <a class="small" target="_blank" rel="noopener" href="${esc(probeIssueUrl(it, given))}">${t("Einspruch")}</a>` : "";
      return `<tr><td>${q}</td><td ${LA()} class="${ok ? "ok" : "bad"}">${esc(given || "—")}</td><td ${LA()}>${esc(it.type === "mcq" ? it.key[0] : it.key.join(" / "))}${dispute}</td></tr>`;
    }).join("")).join("");
    const nxt = nextTheme(run);
    return `<h2>${esc(run.title)}</h2><div class="card"><table class="plain"><thead><tr><th>${t("Kompetenz")}</th><th>${t("Modus")}</th><th>${t("Richtig")}</th><th>${t("Stand")}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <details class="card"><summary>${t("Alle Aufgaben ansehen")}</summary><table class="plain"><thead><tr><th>${t("Aufgabe")}</th><th>${t("Deine Antwort")}</th><th>${t("Lösung")}</th></tr></thead><tbody>${review}</tbody></table></details>
      <div class="row"><a class="btn" href="#karte" data-act="home">${t("Zur Karte")}</a>${nxt ? `<button class="btn quiet" data-act="start-probe" data-id="${esc(nxt)}">${t("Nächstes Thema:")} ${esc(TT(App.C.themes.find((x) => x.id === nxt)))}</button>` : `<a class="btn quiet" href="#einstufung" data-act="home">${t("Zur Übersicht")}</a>`}</div>`;
  }

  // ------------------------------------------------------------------ events
  function afterRender() {
    const wc = $("#wc"); const ta = $("#wi-text");
    if (ta && wc) ta.addEventListener("input", () => { wc.textContent = `${wordCount(ta.value)} Wörter · Ziel ${((App.screen.run.form.word_range) || [20, 60]).join("–")}`; });
    const chat = $("#chat"); if (chat) chat.scrollTop = chat.scrollHeight;
    const ci = $("#chat-in"); if (ci && !ci.disabled) { ci.focus(); ci.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendChat(App.screen.run); } }); }
  }

  let lastFocus = null;
  document.addEventListener("focusin", (e) => { if (e.target.matches("input[type=text], textarea")) lastFocus = e.target; });

  document.addEventListener("input", (e) => {
    const tg = e.target;
    if (tg.dataset && tg.dataset.ans && App.screen && App.screen.run) App.screen.run.answers[tg.dataset.ans] = tg.value;
  });
  document.addEventListener("change", (e) => {
    const tg = e.target;
    if (tg.dataset && tg.dataset.ans && App.screen && App.screen.run) App.screen.run.answers[tg.dataset.ans] = tg.value;
    if (tg.id === "lang-pick") { settings().lang = tg.value; useLanguage(tg.value); App.screen = null; saveProfile(); render(); return; }
    if (tg.id === "import-file" && tg.files && tg.files[0]) { importData(tg.files[0]); return; }
    if (tg.dataset && tg.dataset.ai) {
      const c = window.LBStandalone.getConfig(), path = tg.dataset.ai.split(".");
      if (path[0] === "provider") c.provider = tg.value; else { let o = c; path.slice(0, -1).forEach((k) => (o = o[k])); o[path[path.length - 1]] = tg.value.trim(); }
      window.LBStandalone.setConfig(c); App.sample = window.LBStandalone.makeSample(c);
      if (path[0] === "provider") render(); else { const m = $("#ai-msg"); if (m) m.textContent = t(App.sample ? "Gespeichert." : "Noch unvollständig."); }
      return;
    }
    if (tg.dataset && tg.dataset.setting) {
      settings()[tg.dataset.setting] = tg.type === "checkbox" ? tg.checked : tg.value;
      saveProfile(); render();
    }
  });

  document.addEventListener("click", async (e) => {
    const tab = e.target.closest("nav.tabs a");
    if (tab && tab.getAttribute("href") === (location.hash || "#karte")) { App.screen = null; render(); return; }  // same tab: leave the current run
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id, run = App.screen && App.screen.run;
    switch (act) {
      case "dismiss": App.note = ""; render(); break;
      case "ui": settings().il = id; saveProfile(); render(); break;
      case "open-skill": App.screen = { kind: "skill", id }; render(); window.scrollTo(0, 0); break;
      case "back": App.screen = App.screen && App.screen.kind === "attempt" && App.screen.from ? { kind: "skill", id: App.screen.from } : null; render(); break;
      case "abort": App.screen = null; render(); break;
      case "home": App.screen = null; render(); break;
      case "view-attempt": { const from = App.screen && App.screen.id; App.screen = { kind: "attempt", id, from }; render(); window.scrollTo(0, 0); break; }
      case "start-test": startTest(id); window.scrollTo(0, 0); break;
      case "start-check": startCheck(id); window.scrollTo(0, 0); break;
      case "start-probe": startProbe(id); window.scrollTo(0, 0); break;
      case "retry": if (run && run.start) run.start(); break;
      case "submit": if (run) submit(run); break;
      case "submit-probe": if (run) submitProbe(run); break;
      case "reveal": if (run && run.revealed) { run.revealed[id] = true; render(); } break;
      case "send": if (run) sendChat(run); break;
      case "key": if (lastFocus) { const el = lastFocus, k = b.dataset.k, p = el.selectionStart ?? el.value.length; el.value = el.value.slice(0, p) + k + el.value.slice(el.selectionEnd ?? p); el.focus(); el.selectionStart = el.selectionEnd = p + k.length; el.dispatchEvent(new Event("input", { bubbles: true })); } break;
      case "play": case "play-probe": {
        if (!run) break;
        const key = act === "play" ? +b.dataset.i : b.dataset.id;
        if ((run.plays[key] || 0) >= 2) break;
        const text = act === "play" ? run.form.stimuli[+b.dataset.i].body : run.probe.flatMap((p) => p.items).find((it) => it.id === key).audio;
        run.plays[key] = (run.plays[key] || 0) + 1;
        b.disabled = true;
        try { await speak(text); } catch (err) { setNote(err.message); run.plays[key]--; }
        render(); break;
      }
      case "void": {
        const a = App.attempts.find((x) => x.id === id); if (!a) break;
        a.voided = true; saveAttempt(a);
        if (a.kind === "enabler_check" && App.profile.checks[a.skill] && App.profile.checks[a.skill].attempt === a.id) { delete App.profile.checks[a.skill]; saveProfile(); }
        render(); break;
      }
      case "ai-test": {
        const m = $("#ai-msg");
        if (!App.sample) { m.textContent = t("Erst Anbieter, Schlüssel und Modell eintragen."); break; }
        m.textContent = t("Teste …");
        try { const r = await App.sample.json('Antworte mit {"ok": true}.', { modelTier: "quick" }); m.textContent = r && r.ok ? t("Verbindung funktioniert.") : t("Antwort erhalten, aber unerwartet:") + " " + JSON.stringify(r).slice(0, 80); }
        catch (err) { m.textContent = t("Fehler:") + " " + (err.message || err); }
        break;
      }
      case "download": {
        const data = JSON.stringify({ app: "lingbadge", version: 1, exportedAt: nowIso(), profile: App.profile, attempts: App.attempts }, null, 1);
        const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "lingbadge-" + today() + ".json"; document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        break;
      }
      case "export": {
        const data = JSON.stringify({ profile: App.profile, attempts: App.attempts }, null, 1);
        try { await navigator.clipboard.writeText(data); $("#export-msg").textContent = t("Kopiert ({n} KB).", { n: Math.round(data.length / 1024) }); }
        catch (err) { $("#export-msg").textContent = t("Kopieren nicht erlaubt in dieser Ansicht."); }
        break;
      }
    }
  });

  async function importData(file) {
    const msg = (t) => { const m = $("#export-msg"); if (m) m.textContent = t; };
    try {
      const d = JSON.parse(await file.text());
      if (!d || !d.profile || !Array.isArray(d.attempts)) throw new Error(t("keine LingBadge-Datei"));
      const have = new Set(App.attempts.map((a) => a.id));
      const added = d.attempts.filter((a) => a && a.id && !have.has(a.id));
      App.attempts = App.attempts.concat(added).sort((a, b) => (a.at < b.at ? -1 : 1));
      App.profile = { settings: Object.assign({}, App.profile.settings, d.profile.settings || {}), probes: Object.assign({}, App.profile.probes, d.profile.probes),
        checks: Object.assign({}, App.profile.checks, d.profile.checks), badges: Object.assign({}, App.profile.badges, d.profile.badges) };
      added.forEach(saveAttempt); await saveProfile();
      useLanguage(settings().lang || App.lang); render();
      msg(t("{n} Tests importiert.", { n: added.length }));
    } catch (e) { msg(t("Import fehlgeschlagen:") + " " + e.message); }
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    try { App.C = window.LB_CONTENT ? JSON.parse(JSON.stringify(window.LB_CONTENT)) : await fetch("content.json").then((r) => r.json()); }
    catch (e) { $("#app").innerHTML = `<p class="note">${t("Inhalte konnten nicht geladen werden. Bitte die Seite neu öffnen.")}</p>`; return; }
    App.C.allSkills = App.C.skills;
    App.cfg = LB.cfgFrom(App.C.mastery);
    useLanguage(App.C.default_lang);
    route(); render();
    window.addEventListener("hashchange", () => { route(); render(); });
    if (!window.claude || typeof window.claude.use !== "function") {
      // Outside claude.ai: local storage and the learner's own API key (app/platform.js).
      const P = window.LBStandalone;
      App.platform = "standalone";
      if (P) { App.db = P.db; App.uid = await P.user.id(); App.sample = P.makeSample(); await loadData(); }
      useLanguage(settings().lang || App.lang);
      App.connecting = false; render(); return;
    }
    App.platform = "claude.ai";
    const get = (n) => window.claude.use(n).catch(() => null);
    const [db, user, sample, tts] = await Promise.all([get("db"), get("user"), get("sample"), get("tts")]);
    App.sample = sample; App.tts = tts;
    if (db && user) {
      try { const uid = await user.id(); if (uid) { App.db = db; App.uid = uid; await loadData(); } } catch (e) { /* stays unsaved */ }
    }
    useLanguage(settings().lang || App.lang);
    App.connecting = false; render();
  }
  window.__lb = { App, render, renderResult, renderRun, statusOf };  // debugging hook
  boot();
})();
