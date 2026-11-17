/* lingobadge app: skill map, tests, grading, badges. Depends on core.js (window.LB). */
(function () {
  "use strict";
  const LB = window.LB;
  const MODES = ["R", "L", "SI", "SP", "WI"];
  const MODE_DE = { R: "Lesen", L: "Hören", SI: "Gespräch", SP: "Vortrag", WI: "Schreiben", WP: "Text" };
  const ST_DE = { badge: "Abzeichen", likely: "wahrscheinlich", shaky: "unsicher", unknown: "Lücke", untested: "ungetestet",
    suspect: "Verdacht", known: "sicher", audio: "nur mit Audio" };
  const TESTABLE = new Set(["R", "L", "WI", "SI"]);   // SP needs speech input
  const BADGEABLE = new Set(["R", "L", "WI"]);        // typed role-plays never award spoken badges
  const CRIT_DE = { task_completion: "Aufgabe erfüllt", comprehension: "Verstehen", key_structures: "Schlüsselstrukturen",
    lexis: "Wortschatz", appropriacy: "Angemessenheit", orthography: "Rechtschreibung", delivery: "Aussprache", item_accuracy: "Richtige Antworten" };
  const LEVEL_DE = ["fehlt", "unter Niveau", "erfüllt", "übertroffen"];

  const App = {
    C: null, cfg: null, db: null, sample: null, tts: null, uid: null,
    attempts: [], profile: { settings: { il: "de", tts: "browser", gradeTier: "default", validate: true }, probes: {}, checks: {}, badges: {} },
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

  // ------------------------------------------------------------------ storage
  const base = () => "data/users/" + App.uid;
  const attemptsCol = () => App.db.doc(base() + "/profile").collection("attempts");

  function queueSave(fn) {
    App.saving = App.saving.then(fn).catch((e) => setNote("Speichern fehlgeschlagen: " + (e && (e.message || e.code)) + ". Deine letzte Aktion ist evtl. nicht gespeichert."));
    return App.saving;
  }
  function saveProfile() { if (!App.db) return Promise.resolve(); const p = JSON.parse(JSON.stringify(App.profile)); return queueSave(() => App.db.doc(base() + "/profile").set(p)); }
  function saveAttempt(a) { if (!App.db) return Promise.resolve(); const d = JSON.parse(JSON.stringify(a)); return queueSave(() => attemptsCol().doc(a.id).set(d)); }

  async function loadData() {
    const timer = setTimeout(() => setNote("Deine gespeicherten Daten sind noch nicht erreichbar. Was du jetzt siehst, ist evtl. nicht aktuell."), 10000);
    try {
      const p = await App.db.doc(base() + "/profile").get();
      if (p.exists) {
        const d = p.data();
        App.profile = { settings: Object.assign({}, App.profile.settings, d.settings || {}), probes: d.probes || {}, checks: d.checks || {}, badges: d.badges || {} };
      }
      const snap = await attemptsCol().limit(1000).get();
      App.attempts = snap.docs.map((d) => d.data()).sort((a, b) => (a.at < b.at ? -1 : 1));
      clearTimeout(timer);
      if (App.note.startsWith("Deine gespeicherten")) App.note = "";
    } catch (e) {
      clearTimeout(timer);
      setNote("Daten konnten nicht geladen werden (" + (e.code || e.message) + "). Neue Ergebnisse werden trotzdem versucht zu speichern.");
    }
  }

  // ------------------------------------------------------------------ Claude calls
  async function ask(prompt, tier) {
    if (!App.sample) throw new Error("Claude ist in dieser Ansicht nicht verfügbar. Öffne die Seite auf claude.ai.");
    try {
      return await App.sample.json(prompt, { modelTier: tier || "default" });
    } catch (e) {
      if (e && e.code === "not_granted") throw new Error("Claude-Zugriff wurde nicht erlaubt. Erlaube ihn beim nächsten Klick, sonst funktionieren Tests nicht.");
      if (e && e.code === "rate_limited") throw new Error("Zu viele Anfragen gerade. Bitte in einer Minute erneut versuchen.");
      throw new Error("Claude-Anfrage fehlgeschlagen: " + ((e && (e.message || e.code)) || e));
    }
  }

  // ------------------------------------------------------------------ speech
  let ukVoice = null;
  function findVoice() {
    try { const vs = window.speechSynthesis ? speechSynthesis.getVoices() : []; ukVoice = vs.find((v) => /^uk/i.test(v.lang)) || null; } catch (e) { ukVoice = null; }
  }
  if (window.speechSynthesis) { findVoice(); speechSynthesis.onvoiceschanged = findVoice; }

  function browserSpeak(text) {
    return new Promise((res, rej) => {
      if (!window.speechSynthesis) return rej(new Error("Keine Sprachausgabe im Browser."));
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "uk-UA"; u.rate = 0.85; if (ukVoice) u.voice = ukVoice;
      u.onend = res; u.onerror = () => rej(new Error("Sprachausgabe fehlgeschlagen."));
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    });
  }
  async function speak(text) {
    if (settings().tts === "claude" && App.tts) {
      try { return await App.tts.speak(text, { language: "uk", rate: 0.85 }); } catch (e) { /* fall back */ }
    }
    if (!ukVoice && settings().tts === "browser") setNote("Dein Browser hat keine ukrainische Stimme. Wähle in den Einstellungen „Claude-Stimme“ oder installiere eine ukrainische Systemstimme.");
    return browserSpeak(text);
  }

  // ------------------------------------------------------------------ statuses
  function rubricOf(skill) { return App.C.rubrics[skill.rubric]; }
  function statusOf(skill) {
    const atts = App.attempts.filter((a) => a.skill === skill.id && !a.voided && a.kind === "full")
      .map((a) => BADGEABLE.has(skill.mode) ? a : Object.assign({}, a, { channel: "typed-speech" }));
    return LB.skillStatus(skill, atts, App.profile.probes[skill.id], rubricOf(skill), App.cfg);
  }
  function enablerStatus() { return LB.enablerStatuses(App.C.enablers, App.profile.checks, App.attempts); }

  // ------------------------------------------------------------------ routing
  const VIEWS = ["karte", "einstufung", "grammatik", "einstellungen"];
  function route() { const h = location.hash.replace("#", ""); App.view = VIEWS.includes(h) ? h : "karte"; App.screen = null; }

  // ------------------------------------------------------------------ render
  function render() {
    const nav = VIEWS.map((v) => `<a href="#${v}" ${App.view === v && !App.screen ? 'aria-current="page"' : ""}>${{ karte: "Karte", einstufung: "Einstufung", grammatik: "Grammatik & Wortschatz", einstellungen: "Einstellungen" }[v]}</a>`).join("");
    let notes = "";
    if (App.connecting) notes += `<p class="note info"><span class="spinner"></span>Verbinde mit claude.ai …</p>`;
    else if (!App.sample) notes += `<p class="note">Claude ist hier nicht verfügbar: Tests lassen sich nur auf claude.ai erstellen und bewerten.</p>`;
    if (!App.connecting && !App.db) notes += `<p class="note">Speichern ist hier nicht verfügbar (nicht angemeldet oder außerhalb von claude.ai). Ergebnisse gehen beim Schließen verloren.</p>`;
    if (App.note) notes += `<p class="note">${esc(App.note)} <button class="btn quiet small" data-act="dismiss">OK</button></p>`;
    let main;
    if (App.screen && App.screen.kind === "skill") main = renderSkill(skillById(App.screen.id));
    else if (App.screen && App.screen.kind === "run") main = renderRun(App.screen.run);
    else if (App.screen && App.screen.kind === "attempt") main = renderResult(App.attempts.find((a) => a.id === App.screen.id), true);
    else main = ({ karte: renderMap, einstufung: renderPlacement, grammatik: renderEnablers, einstellungen: renderSettings })[App.view]();
    $("#app").innerHTML = `<header class="top"><h1>Kompetenzkarte Ukrainisch</h1><span class="sub">A1 · ${App.C.skills.length} Alltagskompetenzen</span><nav class="tabs">${nav}</nav></header>${notes}${main}`;
    afterRender();
  }

  function renderMap() {
    const counts = { badge: 0, likely: 0, shaky: 0, unknown: 0, untested: 0 };
    const st = {}; App.C.skills.forEach((s) => { st[s.id] = statusOf(s); counts[st[s.id].status]++; });
    const tiles = [["badge", "Abzeichen"], ["likely", "wahrscheinlich"], ["shaky", "unsicher"], ["unknown", "Lücken"], ["untested", "ungetestet"]]
      .map(([k, l]) => `<div class="tile"><b>${counts[k]}</b><span>${l}</span></div>`).join("");
    const legend = ["badge", "likely", "shaky", "unknown", "untested"].map((k) => chip(k)).join("") +
      `<span>· Gespräch und Vortrag: nur Einschätzung, Abzeichen erst mit Spracheingabe</span>`;
    const themes = App.C.themes.map((t) => {
      const skills = App.C.skills.filter((s) => s.theme === t.id);
      if (!skills.length) return "";
      const tasks = [...new Set(skills.map((s) => s.task))];
      const rows = tasks.map((task) => {
        const ts = skills.filter((s) => s.task === task);
        const lead = ts.find((s) => s.mode === "SI") || ts[0];
        const cells = MODES.map((m) => {
          const s = ts.find((x) => x.mode === m);
          if (!s) return `<td><span class="dot" aria-hidden="true">·</span></td>`;
          const x = st[s.id];
          const label = x.status === "likely" && x.badge && x.badge.passes === 1 ? "1/2 bestanden" : ST_DE[x.status];
          return `<td><button class="cellbtn" data-act="open-skill" data-id="${esc(s.id)}" title="${esc(s.title)}">${chip(x.status, label)}</button></td>`;
        }).join("");
        return `<tr><td class="task">${esc(lead.title)}<small>${esc(ts.map((s) => s.id).join(" · "))}</small></td>${cells}</tr>`;
      }).join("");
      return `<section class="theme"><h2>${esc(t.title)}</h2><table class="grid"><thead><tr><th>Aufgabe</th>${MODES.map((m) => `<th>${MODE_DE[m]}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></section>`;
    }).join("");
    const empty = counts.untested === App.C.skills.length
      ? `<p class="note info">Noch keine Ergebnisse. Starte mit der <a href="#einstufung">Einstufung</a> (ein Thema dauert 5–10 Minuten) oder öffne eine Kompetenz und mach einen Test.</p>` : "";
    return `${empty}<div class="tiles">${tiles}</div><div class="legend">${legend}</div>${themes}`;
  }

  function renderSkill(s) {
    const x = statusOf(s), real = App.C.realizations[s.id], est = enablerStatus();
    const atts = App.attempts.filter((a) => a.skill === s.id && a.kind === "full").slice().reverse();
    const thr = LB.thresholdFor(s, App.cfg);
    const badgeLine = !BADGEABLE.has(s.mode)
      ? `<p class="small muted">${s.mode === "SP" ? "Vortrag braucht Spracheingabe – noch nicht testbar." : "Getippte Rollenspiele zeigen deinen Stand, vergeben aber kein Sprech-Abzeichen."}</p>`
      : x.status === "badge" ? `<p class="ok">Abzeichen erhalten – ${esc(x.badge.reason)}.</p>`
      : `<p class="small">Abzeichen: ${x.badge.passes || 0} von 2 bestandenen Tests (an verschiedenen Tagen, innerhalb von 60 Tagen). Bestehen ab ${pct(thr)}${s.rubric.includes("interaction") || s.rubric.includes("written") ? " und alle Pflichtkriterien erfüllt" : ""}.</p>`;
    const ens = real.enablers.filter((u) => u.role === "required").map((u) => {
      const e = App.C.enablers[u.id] || {};
      return `<div class="en"><div>${esc(e.title)}<small>${esc(e.cefr)} · ${u.use === "formulaic" ? "feste Wendung" : "selbst bilden"}</small></div>${chip(est[u.id])}</div>`;
    }).join("");
    const list = atts.length ? `<table class="plain"><thead><tr><th>Datum</th><th>Ergebnis</th><th>Punkte</th><th></th></tr></thead><tbody>${atts.map((a) =>
      `<tr><td class="num">${esc(a.takenOn)}</td><td>${a.voided ? '<span class="muted">ungültig</span>' : a.outcome.passed ? '<span class="ok">bestanden</span>' : '<span class="bad">nicht bestanden</span>'}</td><td class="num">${pct(a.outcome.score)}</td><td><button class="btn quiet small" data-act="view-attempt" data-id="${esc(a.id)}">ansehen</button></td></tr>`).join("")}</tbody></table>`
      : `<p class="muted small">Noch keine Tests.</p>`;
    const probe = App.profile.probes[s.id];
    return `<p><button class="btn quiet" data-act="back">← Karte</button></p>
      <div class="card stack"><div class="row"><h2>${esc(s.title)}</h2>${chip(x.status)}<span class="chip st-untested">${MODE_DE[s.mode]} · ${esc(s.cefr)} · Umfang ${esc(s.size)}</span></div>
      <p>${esc(s.can_do)}</p>${badgeLine}
      ${probe ? `<p class="small muted">Einstufung am ${esc(probe.at.slice(0, 10))}: ${probe.correct}/3 → ${ST_DE[probe.status]}</p>` : ""}
      <div class="row">${TESTABLE.has(s.mode) ? `<button class="btn" data-act="start-test" data-id="${esc(s.id)}">${s.mode === "SI" ? "Rollenspiel starten" : "Test starten"}</button>` : ""}</div></div>
      <div class="card stack"><h3>Bisherige Tests</h3>${list}</div>
      <div class="card stack"><h3>Bausteine in dieser Kompetenz</h3><div class="ens">${ens}</div></div>`;
  }

  function renderEnablers() {
    const est = enablerStatus();
    const groups = {};
    Object.values(App.C.enablers).forEach((e) => (groups[e.kind] = groups[e.kind] || []).push(e));
    const KIND_DE = { grammar: "Grammatik", lexis: "Wortschatz", pragmatics: "Pragmatik", script: "Schrift", orthography: "Rechtschreibung", phonology: "Aussprache" };
    const order = ["grammar", "lexis", "pragmatics", "script", "orthography", "phonology"];
    return `<p class="muted">Bausteine hinter den Kompetenzen. „Verdacht“ heißt: In Tests gab es Fehler, die hierauf zeigen. Ein Check (10 Aufgaben, ~5 Minuten) klärt es. A2-Bausteine kommen in A1-Aufgaben nur als feste Wendungen vor.</p>` +
      order.filter((k) => groups[k]).map((k) => `<div class="card stack"><h2>${KIND_DE[k]}</h2><div class="ens">${groups[k].sort((a, b) => (a.cefr + a.title).localeCompare(b.cefr + b.title)).map((e) => {
        const c = App.profile.checks[e.id];
        return `<div class="en"><div>${esc(e.title)}<small>${esc(e.cefr)}${c ? " · Check " + pct(c.score) + " am " + esc(c.at.slice(0, 10)) : ""}</small></div><div class="row">${chip(est[e.id])}${e.channel === "text" ? `<button class="btn quiet small" data-act="start-check" data-id="${esc(e.id)}">Check</button>` : ""}</div></div>`;
      }).join("")}</div></div>`).join("");
  }

  function renderPlacement() {
    const rows = App.C.themes.map((t) => {
      const skills = App.C.skills.filter((s) => s.theme === t.id && s.mode !== "SP");
      if (!skills.length) return "";
      const done = skills.filter((s) => App.profile.probes[s.id]).length;
      const chips = skills.map((s) => { const p = App.profile.probes[s.id]; return chip(p ? p.status : "untested", MODE_DE[s.mode] + (p ? " " + p.correct + "/3" : "")); }).join(" ");
      return `<tr><td><b>${esc(t.title)}</b><br><span class="small muted">${skills.length} Kompetenzen · ${done} eingestuft</span></td><td>${chips}</td><td><button class="btn ${done ? "quiet" : ""}" data-act="start-probe" data-id="${esc(t.id)}">${done ? "Wiederholen" : "Starten"}</button></td></tr>`;
    }).join("");
    return `<div class="card stack"><h2>Einstufung</h2><p>Pro Thema je 3 kurze Aufgaben pro Kompetenz. Ergebnis: 3/3 wahrscheinlich, 2/3 unsicher, sonst Lücke. Einstufungen vergeben keine Abzeichen; sie zeigen dir, wo du testen solltest. Du kannst jederzeit unterbrechen; jedes Thema wird einzeln gespeichert.</p>
      <p class="small muted">Gespräch und Schreiben werden hier mit kurzen „Was sagst/schreibst du?“-Aufgaben eingeschätzt. Vortrag (Sprechen) ist ausgenommen.</p></div>
      <div class="card"><table class="plain"><thead><tr><th>Thema</th><th>Stand</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderSettings() {
    const s = settings();
    const opt = (name, val, label) => `<label><input type="radio" name="${name}" value="${val}" ${s[name] === val ? "checked" : ""} data-setting="${name}"> ${label}</label>`;
    return `<div class="card stack"><h2>Einstellungen</h2>
      <fieldset class="stack"><legend><b>Sprache der Aufgaben</b></legend><div class="opts">${opt("il", "de", "Deutsch")}${opt("il", "en", "Englisch")}</div></fieldset>
      <fieldset class="stack"><legend><b>Sprachausgabe für Hörtests</b></legend><div class="opts">${opt("tts", "browser", "Browser-Stimme (Ukrainisch, " + (ukVoice ? "gefunden: " + esc(ukVoice.name) : "keine ukrainische Stimme gefunden") + ")")}${opt("tts", "claude", "Claude-Stimme" + (App.tts ? "" : " (hier nicht verfügbar)"))}</div></fieldset>
      <fieldset class="stack"><legend><b>Bewertung</b></legend><div class="opts">${opt("gradeTier", "default", "Standard (spart Nutzung)")}${opt("gradeTier", "complex", "Gründlich (stärkeres Modell, verbraucht mehr)")}</div></fieldset>
      <label><input type="checkbox" data-setting="validate" ${s.validate ? "checked" : ""}> Jeden Test vor dem Anzeigen zusätzlich prüfen lassen (empfohlen)</label>
      <div class="row"><button class="btn quiet" data-act="export">Alle Daten als JSON kopieren</button><span class="small muted" id="export-msg"></span></div>
      <p class="small muted">${App.attempts.length} Tests gespeichert. Daten liegen privat in deinem Bereich dieses Artefakts.</p></div>`;
  }

  // ------------------------------------------------------------------ test runs
  function renderRun(run) {
    const head = `<p><button class="btn quiet" data-act="abort">← Abbrechen</button></p><div class="card stack"><div class="row"><h2>${esc(run.title)}</h2>${run.mode ? `<span class="chip st-untested">${esc(run.modeLabel)}</span>` : ""}</div>`;
    if (run.phase === "busy") return head + `<p><span class="spinner"></span>${esc(run.msg)}</p></div>`;
    if (run.phase === "error") return head + `<p class="bad">${esc(run.msg)}</p><div class="row"><button class="btn" data-act="retry">Erneut versuchen</button></div></div>`;
    if (run.phase === "result") return `<p><button class="btn quiet" data-act="back">← Zurück</button></p>` + (run.type === "probe" ? renderProbeResult(run) : renderResult(run.attempt, false));
    // phase: ready
    const warn = run.warnings && run.warnings.length ? `<p class="note small">Hinweis der Testprüfung: ${esc(run.warnings.map((w) => w.detail || w).join(" · "))}</p>` : "";
    if (run.type === "probe") return head + warn + renderProbeForm(run) + `</div>`;
    const f = run.form, m = run.mode;
    let body = "";
    if (m === "R") body = `<p class="muted small">Lies das Dokument und beantworte die Fragen. Zeit: etwa 10 Minuten.</p>${(f.stimuli || []).map((s) => `<div class="doc" lang="uk">${esc(s.body)}</div>`).join("")}${renderItems(f.items, run)}`;
    if (m === "L") body = `<p class="muted small">Jeder Clip kann zweimal abgespielt werden. Der Text wird erst nach der Abgabe gezeigt.</p>${renderItems(f.items, run, true)}`;
    if (run.type === "check") body = `<p class="muted small">Setze die richtige Form ein. Nur die Form zählt, nicht die Großschreibung.</p>${renderItems(f.items, run)}`;
    if (m === "WI") body = `${(f.stimuli || []).map((s) => `<div class="stack"><span class="small muted">${esc(s.title || "")}</span><div class="${s.kind === "message" ? "msg" : "doc"}" lang="uk">${esc(s.body)}</div></div>`).join("")}
      ${f.situation ? `<p>${esc(f.situation)}</p>` : ""}<div><b>Das soll in deinem Text vorkommen:</b><ul>${(f.brief || []).map((c) => `<li>${esc(c.text)}${c.must ? "" : ' <span class="muted small">(optional)</span>'}</li>`).join("")}</ul></div>
      ${kbd()}<textarea id="wi-text" lang="uk" data-ans="__text" placeholder="Auf Ukrainisch schreiben …">${esc(run.answers.__text || "")}</textarea>
      <p class="small muted" id="wc">${wordCount(run.answers.__text)} Wörter · Ziel ${(f.word_range || [20, 60]).join("–")}</p>`;
    if (m === "SI") return head + warn + renderChat(run) + `</div>`;
    return head + warn + body + `<div class="row"><button class="btn" data-act="submit">Abgeben</button></div></div>`;
  }

  function kbd() { return `<div class="keys" aria-label="Sonderzeichen">${["і", "ї", "є", "ґ", "ʼ", "и", "щ"].map((k) => `<button type="button" data-act="key" data-k="${k}">${k}</button>`).join("")}<span class="small muted">Tipp: ukrainische Tastatur im System aktivieren.</span></div>`; }
  function wordCount(t) { return (String(t || "").trim().match(/\S+/g) || []).length; }

  function renderItems(items, run, audio) {
    return `<div>${(items || []).map((it, n) => {
      const v = run.answers[it.id] || "";
      const clip = audio && it.stimulus != null ? `<button class="btn secondary small" data-act="play" data-i="${it.stimulus}" ${(run.plays[it.stimulus] || 0) >= 2 ? "disabled" : ""}>▶ Clip ${it.stimulus + 1} (${2 - (run.plays[it.stimulus] || 0)}× übrig)</button>` : "";
      const input = it.type === "mcq"
        ? `<div class="opts">${(it.options || []).map((o) => `<label><input type="radio" name="q-${esc(it.id)}" value="${esc(o)}" data-ans="${esc(it.id)}" ${v === o ? "checked" : ""}> <span lang="uk">${esc(o)}</span></label>`).join("")}</div>`
        : `<input type="text" lang="uk" data-ans="${esc(it.id)}" value="${esc(v)}" autocomplete="off">`;
      return `<div class="item"><div class="row">${clip}<span class="q">${n + 1}. ${esc(it.prompt)}</span></div>${input}</div>`;
    }).join("")}</div>`;
  }

  function renderChat(run) {
    const rp = run.form.roleplay;
    const bubbles = run.transcript.map((t) => `<div class="bubble ${t.speaker === "learner" ? "me" : "them"}" lang="uk">${esc(t.text)}</div>`).join("");
    const over = run.chatOver;
    return `<p><b>Dein Ziel:</b> ${esc(rp.learner_goal)}</p><p class="small muted">${esc(rp.setting)} Du schreibst, als ob du sprichst. Getippte Rollenspiele zeigen deinen Stand, vergeben aber kein Sprech-Abzeichen.</p>
      <div class="chat" id="chat">${bubbles}${run.thinking ? `<div class="bubble them"><span class="spinner"></span></div>` : ""}</div>
      ${over ? `<p class="muted">Das Gespräch ist beendet.</p>` : `${kbd()}<div class="row"><input type="text" id="chat-in" lang="uk" placeholder="Deine Antwort auf Ukrainisch …" ${run.thinking ? "disabled" : ""}><button class="btn" data-act="send" ${run.thinking ? "disabled" : ""}>Senden</button></div>`}
      <div class="row"><button class="btn ${over ? "" : "quiet"}" data-act="submit" ${run.transcript.filter((t) => t.speaker === "learner").length ? "" : "disabled"}>Gespräch beenden und bewerten</button></div>`;
  }

  function renderResult(a, standalone) {
    if (!a) return `<p class="muted">Test nicht gefunden.</p>`;
    const s = skillById(a.skill), isCheck = a.kind === "enabler_check";
    const title = isCheck ? (App.C.enablers[a.skill] || {}).title : s.title;
    const typed = s && !BADGEABLE.has(s.mode);
    const st = s && statusOf(s);
    const verdict = a.voided ? `<div class="verdict info"><b>Als fehlerhaft markiert</b><span>Dieser Test zählt nicht.</span></div>`
      : typed ? `<div class="verdict info"><b>Einschätzung: ${ST_DE[LB.heatmapStatus(a.outcome)]}</b><span>${esc(a.outcome.reason)} · ${pct(a.outcome.score)}. Kein Sprech-Abzeichen aus getippten Gesprächen.</span></div>`
      : `<div class="verdict ${a.outcome.passed ? "pass" : "fail"}"><b>${a.outcome.passed ? "Bestanden" : "Nicht bestanden"}</b><span>${esc(a.outcome.reason)} · ${pct(a.outcome.score)} (nötig: ${pct(a.outcome.threshold)})</span>
        ${!isCheck && st ? `<span>${st.status === "badge" ? "🏅 Abzeichen erhalten." : `Abzeichen: ${st.badge.passes || 0} von 2 bestanden. ${esc(st.badge.reason)}.`}</span>` : ""}</div>`;
    let detail = "";
    const f = a.form;
    if (f.items && f.items.length) {
      detail += `<div class="card stack"><h3>Deine Antworten</h3><table class="plain"><thead><tr><th>#</th><th>Frage</th><th>Deine Antwort</th><th>Lösung</th></tr></thead><tbody>${f.items.map((it, n) => {
        const ok = a.grade.item_results[it.id];
        return `<tr><td class="num">${n + 1}</td><td>${esc(it.prompt)}</td><td lang="uk" class="${ok ? "ok" : "bad"}">${esc((a.response.answers || {})[it.id] || "—")}</td><td lang="uk">${esc((it.key || [])[0])}</td></tr>`;
      }).join("")}</tbody></table>
      ${(f.stimuli || []).some((x) => x.kind === "audio_script") ? `<details><summary>Hörtexte anzeigen</summary>${f.stimuli.map((x, i) => `<p lang="uk"><b>Clip ${i + 1}:</b> ${esc(x.body)}</p>`).join("")}</details>` : ""}</div>`;
    }
    if (a.grade.criteria && a.grade.criteria.length) {
      const rub = App.C.rubrics[f.rubric];
      detail += `<div class="card stack"><h3>Bewertung</h3>${a.feedback ? `<p>${esc(a.feedback)}</p>` : ""}<table class="plain"><thead><tr><th>Kriterium</th><th>Stufe</th><th>Belege</th></tr></thead><tbody>${a.grade.criteria.map((c) => {
        const rc = rub.criteria.find((x) => x.id === c.id) || {};
        return `<tr><td>${esc(CRIT_DE[c.id] || c.id)}${rc.must ? "" : ' <span class="muted small">(optional)</span>'}</td><td class="${c.level >= 2 ? "ok" : "bad"}">${c.level} – ${LEVEL_DE[c.level] || ""}</td><td lang="uk">${esc((c.evidence || []).join(" · "))}</td></tr>`;
      }).join("")}</tbody></table>${a.regraded ? `<p class="small muted">Knapp am Grenzwert: dreimal unabhängig bewertet, der Median zählt.</p>` : ""}</div>`;
    }
    if (a.response.text) detail += `<div class="card stack"><h3>Dein Text</h3><div class="doc" lang="uk">${esc(a.response.text)}</div></div>`;
    if (a.response.transcript) detail += `<div class="card stack"><h3>Gespräch</h3><div class="chat">${a.response.transcript.map((t) => `<div class="bubble ${t.speaker === "learner" ? "me" : "them"}" lang="uk">${esc(t.text)}</div>`).join("")}</div></div>`;
    const errs = (a.grade.errors || []);
    if (errs.length) detail += `<div class="card stack"><h3>Fehler</h3><table class="plain"><thead><tr><th>Stelle</th><th>Richtig</th><th>Baustein</th></tr></thead><tbody>${errs.map((e) =>
      `<tr><td lang="uk" class="bad">${esc(e.span)}</td><td lang="uk">${esc(e.correction)}</td><td>${e.chunk ? "feste Wendung: <span lang=\"uk\">" + esc(e.chunk) + "</span>" : esc((App.C.enablers[e.enabler] || {}).title || e.enabler || "—")}</td></tr>`).join("")}</tbody></table></div>`;
    if (!isCheck) {
      const dx = LB.diagnose(f, a.grade, App.C.enablers, enablerStatus());
      if (dx.holes.length || dx.chunks.length) {
        detail += `<div class="card stack"><h3>Wahrscheinliche Lücken</h3>${dx.holes.slice(0, 4).map((h) => `<div class="stack"><div><b>${esc(h.title)}</b> <span class="muted small">${esc(h.cefr)} · ${h.errors} Hinweis(e)</span></div>
          <div class="row small">Zuerst prüfen: ${h.check_first.filter((id) => (App.C.enablers[id] || {}).channel === "text").map((id) => `<button class="btn quiet small" data-act="start-check" data-id="${esc(id)}">${esc(App.C.enablers[id].title)}</button>`).join(" ") || "—"}</div></div>`).join("")}
          ${dx.chunks.length ? `<p class="small">Feste Wendungen zum Üben (keine Grammatiklücke): <span lang="uk">${dx.chunks.map(esc).join(", ")}</span></p>` : ""}</div>`;
      }
    }
    const actions = `<div class="row">${s && TESTABLE.has(s.mode) ? `<button class="btn" data-act="start-test" data-id="${esc(s.id)}">Neuer Test</button>` : ""}${isCheck ? `<button class="btn" data-act="start-check" data-id="${esc(a.skill)}">Neuer Check</button>` : ""}
      ${!a.voided ? `<button class="btn quiet" data-act="void" data-id="${esc(a.id)}">Fehlerhafte Aufgabe melden (Test zählt nicht)</button>` : ""}</div>`;
    return (standalone ? `<p><button class="btn quiet" data-act="back">← Zurück</button></p>` : "") + `<h2>${esc(title)}</h2><p class="small muted">${esc(a.takenOn)}</p>${verdict}${detail}${actions}`;
  }

  // ------------------------------------------------------------------ test flow
  function newRun(type, title, mode) {
    return { type, title, mode, modeLabel: MODE_DE[mode] || (type === "check" ? "Check" : "Einstufung"), phase: "busy", msg: "", answers: {}, plays: {}, transcript: [] };
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
    const run = newRun("test", s.title, s.mode);
    App.screen = { kind: "run", run }; run.start = () => startTest(id);
    setRun(run, { phase: "busy", msg: "Test wird erstellt …" });
    try {
      const seen = App.attempts.filter((a) => a.skill === id && a.form).map((a) => a.form.summary).filter(Boolean).slice(-8);
      const prev = App.attempts.filter((a) => a.skill === id && a.form);
      let form = null, warnings = [], avoid = "", seed = Math.floor(Math.random() * 1e6);
      for (let t = 0; t < 2; t++, seed++) {
        setRun(run, { msg: t ? "Neuer Versuch: Test wird erstellt …" : "Test wird erstellt …" });
        const raw = await ask(LB.genPrompt(s, real, App.C.enablers, seed, seen, settings().il, avoid), "default");
        form = normalizeForm(raw, { id: "f-" + rid(), kind: "full", skill: id, lang: "uk", seed, mode: s.mode, rubric: s.rubric, template: s.mode, generator: "sample:default" });
        const probs = structural(form, s.mode);
        if (prev.some((a) => LB.formSimilarity(a.form, form) > App.cfg.max_form_similarity)) probs.push("zu ähnlich wie ein früherer Test");
        if (!probs.length && settings().validate) {
          setRun(run, { msg: "Test wird geprüft …" });
          const v = await ask(LB.validatePrompt(form, real), "quick");
          const pr = (v && v.problems) || [];
          pr.filter((x) => x.severity === "blocker").forEach((x) => probs.push(`${x.where}: ${x.detail}`));
          warnings = pr.filter((x) => x.severity !== "blocker");
        }
        if (!probs.length) break;
        avoid = probs.join("; ");
        if (t === 1) warnings = [{ detail: "Die Prüfung fand Probleme, die nicht behoben wurden: " + avoid + ". Wenn eine Aufgabe falsch ist, melde den Test als fehlerhaft." }];
      }
      run.form = form; run.warnings = warnings;
      if (s.mode === "SI") run.transcript = [{ speaker: "interlocutor", text: form.roleplay.opening_line }];
      setRun(run, { phase: "ready" });
    } catch (e) { setRun(run, { phase: "error", msg: e.message }); }
  }

  async function startCheck(id) {
    const en = App.C.enablers[id];
    const run = newRun("check", "Check: " + en.title, null);
    App.screen = { kind: "run", run }; run.start = () => startCheck(id);
    setRun(run, { phase: "busy", msg: "Check wird erstellt …" });
    try {
      const seed = Math.floor(Math.random() * 1e6);
      const raw = await ask(LB.enablerCheckPrompt(en, settings().il, seed), "default");
      run.form = normalizeForm(raw, { id: "f-" + rid(), kind: "enabler_check", skill: id, lang: "uk", seed, rubric: "rubric.enabler-check.v1", template: "enabler-check.v1" });
      run.form.items.forEach((it) => { if (!it.enablers.length) it.enablers = [id]; });
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
    setRun(run, { phase: "busy", msg: "Wird bewertet …" });
    try {
      let grade, feedback = null, regraded = false, response;
      if (run.type === "check") { response = { answers: run.answers }; grade = await gradeItems(f, run.answers, true); }
      else if (run.mode === "R" || run.mode === "L") { response = { answers: run.answers }; grade = await gradeItems(f, run.answers, false); }
      else {
        const s = skillById(f.skill);
        const text = run.mode === "SI" ? run.transcript.map((t) => (t.speaker === "learner" ? "Lernende: " : "Gegenüber: ") + t.text).join("\n") : run.answers.__text || "";
        response = run.mode === "SI" ? { transcript: run.transcript } : { text };
        const r = await gradeOpen(s, f, text); grade = r.grade; regraded = r.regraded; feedback = grade.feedback; delete grade.feedback;
      }
      const rub = App.C.rubrics[f.rubric];
      const thr = run.type === "check" ? 0.9 : LB.thresholdFor(skillById(f.skill), App.cfg);
      const outcome = LB.attemptOutcome(rub, grade, thr, App.cfg);
      const a = { id: "a-" + Date.now().toString(36) + rid().slice(0, 4), skill: f.skill, kind: f.kind, mode: run.mode || "check",
        channel: run.mode === "L" ? "tts" : "text", seed: f.seed, takenOn: today(), at: nowIso(), form: f, response, grade, outcome, feedback, regraded, voided: false };
      App.attempts.push(a); saveAttempt(a);
      if (run.type === "check") { App.profile.checks[f.skill] = { score: outcome.score, at: a.at, attempt: a.id }; saveProfile(); }
      else {
        const s = skillById(f.skill), st = statusOf(s);
        if (st.status === "badge" && !App.profile.badges[s.id]) { App.profile.badges[s.id] = { awardedAt: a.at, pair: st.badge.pair }; saveProfile(); }
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
      const turns = run.transcript.filter((t) => t.speaker === "interlocutor").length;
      setRun(run, { thinking: false, chatOver: !!(r && r.conversation_over) || turns >= (run.form.roleplay.max_turns || 12) });
    } catch (e) { setRun(run, { thinking: false }); setNote(e.message); }
  }

  // ------------------------------------------------------------------ placement
  async function startProbe(themeId) {
    const t = App.C.themes.find((x) => x.id === themeId);
    const skills = App.C.skills.filter((s) => s.theme === themeId && s.mode !== "SP");
    const run = newRun("probe", "Einstufung: " + t.title, null);
    App.screen = { kind: "run", run }; run.start = () => startProbe(themeId);
    setRun(run, { phase: "busy", msg: "Einstufung wird erstellt …" });
    try {
      const raw = await ask(LB.probePrompt(t, skills, App.C.realizations, App.C.enablers, settings().il, Math.floor(Math.random() * 1e6)), "default");
      run.probe = ((raw && raw.skills) || []).filter((x) => skillById(x.skill)).map((x) => ({
        skill: x.skill, stimulus: x.stimulus || null,
        items: normalizeForm({ items: (x.items || []).slice(0, 3) }, {}).items.map((it, i) => Object.assign(it, { id: x.skill + "#" + i })),
      }));
      if (!run.probe.length) throw new Error("Die Einstufung kam leer zurück. Bitte erneut versuchen.");
      setRun(run, { phase: "ready" });
    } catch (e) { setRun(run, { phase: "error", msg: e.message }); }
  }

  function renderProbeForm(run) {
    return run.probe.map((p, pi) => {
      const s = skillById(p.skill);
      const stim = !p.stimulus ? "" : p.stimulus.kind === "audio_script"
        ? `<button class="btn secondary small" data-act="play-probe" data-i="${pi}" ${(run.plays["p" + pi] || 0) >= 2 ? "disabled" : ""}>▶ Anhören (${2 - (run.plays["p" + pi] || 0)}× übrig)</button>`
        : `<div class="doc" lang="uk">${esc(p.stimulus.body)}</div>`;
      const items = p.items.map((it) => {
        const v = run.answers[it.id] || "";
        const input = it.type === "mcq" ? `<div class="opts">${(it.options || []).map((o) => `<label><input type="radio" name="q-${esc(it.id)}" value="${esc(o)}" data-ans="${esc(it.id)}" ${v === o ? "checked" : ""}> <span lang="uk">${esc(o)}</span></label>`).join("")}</div>`
          : `<input type="text" lang="uk" data-ans="${esc(it.id)}" value="${esc(v)}" autocomplete="off">`;
        return `<div class="item"><span class="q">${esc(it.prompt)}</span>${input}</div>`;
      }).join("");
      return `<div class="card stack"><div class="row"><h3>${esc(s.title)}</h3><span class="chip st-untested">${MODE_DE[s.mode]}</span></div>${stim}${items}</div>`;
    }).join("") + kbd() + `<div class="row"><button class="btn" data-act="submit-probe">Abgeben</button></div>`;
  }

  async function submitProbe(run) {
    setRun(run, { phase: "busy", msg: "Wird ausgewertet …" });
    try {
      const all = run.probe.flatMap((p) => p.items);
      const form = { items: all };
      const keyed = LB.gradeKeyed(form, run.answers);
      const toJudge = all.filter((it) => !keyed.results[it.id] && (run.answers[it.id] || "").trim() && (it.type !== "mcq"))
        .map((it) => ({ id: it.id, type: it.type, prompt: it.prompt, key: it.key, answer: run.answers[it.id] }));
      if (toJudge.length) {
        const j = await ask(LB.judgePrompt(toJudge), "default");
        ((j && j.results) || []).forEach((r) => { if (r && r.id in keyed.results && r.correct === true) keyed.results[r.id] = true; });
      }
      const at = nowIso();
      run.probeResults = run.probe.map((p) => {
        const correct = p.items.filter((it) => keyed.results[it.id]).length;
        const status = LB.probeStatus(correct, p.items.length || 3);
        App.profile.probes[p.skill] = { status, correct, total: p.items.length, at };
        return { skill: p.skill, correct, total: p.items.length, status };
      });
      run.itemResults = keyed.results;
      saveProfile();
      setRun(run, { phase: "result" });
    } catch (e) { run.start = () => submitProbe(run); setRun(run, { phase: "error", msg: e.message }); }
  }

  function renderProbeResult(run) {
    const rows = run.probeResults.map((r) => { const s = skillById(r.skill); return `<tr><td>${esc(s.title)}</td><td>${MODE_DE[s.mode]}</td><td class="num">${r.correct}/${r.total}</td><td>${chip(r.status)}</td><td>${TESTABLE.has(s.mode) ? `<button class="btn quiet small" data-act="open-skill" data-id="${esc(s.id)}">öffnen</button>` : ""}</td></tr>`; }).join("");
    const review = run.probe.map((p) => p.items.map((it) => `<tr><td>${esc(it.prompt)}</td><td lang="uk" class="${run.itemResults[it.id] ? "ok" : "bad"}">${esc(run.answers[it.id] || "—")}</td><td lang="uk">${esc(it.key.join(" / "))}</td></tr>`).join("")).join("");
    return `<h2>${esc(run.title)}</h2><div class="card"><table class="plain"><thead><tr><th>Kompetenz</th><th>Modus</th><th>Richtig</th><th>Stand</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <details class="card"><summary>Alle Aufgaben ansehen</summary><table class="plain"><thead><tr><th>Aufgabe</th><th>Deine Antwort</th><th>Lösung</th></tr></thead><tbody>${review}</tbody></table></details>
      <div class="row"><a class="btn" href="#karte" data-act="home">Zur Karte</a><a class="btn quiet" href="#einstufung" data-act="home">Nächstes Thema</a></div>`;
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
    const t = e.target;
    if (t.dataset && t.dataset.ans && App.screen && App.screen.run) App.screen.run.answers[t.dataset.ans] = t.value;
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.ans && App.screen && App.screen.run) App.screen.run.answers[t.dataset.ans] = t.value;
    if (t.dataset && t.dataset.setting) {
      settings()[t.dataset.setting] = t.type === "checkbox" ? t.checked : t.value;
      saveProfile(); render();
    }
  });

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id, run = App.screen && App.screen.run;
    switch (act) {
      case "dismiss": App.note = ""; render(); break;
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
      case "send": if (run) sendChat(run); break;
      case "key": if (lastFocus) { const el = lastFocus, k = b.dataset.k, p = el.selectionStart ?? el.value.length; el.value = el.value.slice(0, p) + k + el.value.slice(el.selectionEnd ?? p); el.focus(); el.selectionStart = el.selectionEnd = p + k.length; el.dispatchEvent(new Event("input", { bubbles: true })); } break;
      case "play": case "play-probe": {
        if (!run) break;
        const key = act === "play" ? +b.dataset.i : "p" + b.dataset.i;
        if ((run.plays[key] || 0) >= 2) break;
        const text = act === "play" ? run.form.stimuli[+b.dataset.i].body : run.probe[+b.dataset.i].stimulus.body;
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
      case "export": {
        const data = JSON.stringify({ profile: App.profile, attempts: App.attempts }, null, 1);
        try { await navigator.clipboard.writeText(data); $("#export-msg").textContent = "Kopiert (" + Math.round(data.length / 1024) + " KB)."; }
        catch (err) { $("#export-msg").textContent = "Kopieren nicht erlaubt in dieser Ansicht."; }
        break;
      }
    }
  });

  // ------------------------------------------------------------------ boot
  async function boot() {
    try { App.C = await fetch("content.json").then((r) => r.json()); }
    catch (e) { $("#app").innerHTML = `<p class="note">Inhalte konnten nicht geladen werden. Bitte die Seite neu öffnen.</p>`; return; }
    App.cfg = LB.cfgFrom(App.C.mastery);
    route(); render();
    window.addEventListener("hashchange", () => { route(); render(); });
    if (!window.claude || typeof window.claude.use !== "function") { App.connecting = false; render(); return; }
    const get = (n) => window.claude.use(n).catch(() => null);
    const [db, user, sample, tts] = await Promise.all([get("db"), get("user"), get("sample"), get("tts")]);
    App.sample = sample; App.tts = tts;
    if (db && user) {
      try { const uid = await user.id(); if (uid) { App.db = db; App.uid = uid; await loadData(); } } catch (e) { /* stays unsaved */ }
    }
    App.connecting = false; render();
  }
  window.__lb = { App, render, renderResult, renderRun, statusOf };  // debugging hook
  boot();
})();
