/* lingbadge core: pure logic shared by the page and the node tests.
   Port of src/lingbadge/policy.py and diagnosis.py, plus prompt builders. */
(function (root) {
  "use strict";

  const CREDIT = { 0: 0, 1: 0.5, 2: 1, 3: 1 };
  const DEFAULT_CFG = {
    score_threshold: 0.9, must_min_level: 2, forms_required: 2, min_days_between: 1, pair_window_days: 60,
    max_form_similarity: 0.3, borderline_margin: 0.05, low_confidence: 0.7, overrides: {},
  };

  function cfgFrom(mastery) {
    return Object.assign({}, DEFAULT_CFG, (mastery && mastery.global) || {}, { overrides: (mastery && mastery.overrides) || {} });
  }

  function thresholdFor(skill, cfg) {
    const o = cfg.overrides[skill && skill.id];
    if (o && o.score_threshold != null) return o.score_threshold;
    return skill && skill.threshold != null ? skill.threshold : cfg.score_threshold;
  }

  // ------------------------------------------------------------ key grading
  function normalize(s) {
    s = String(s == null ? "" : s).trim().toLowerCase();
    s = s.normalize("NFD").replace(/[\u0300\u0301]/g, "").normalize("NFC"); // drop stress marks, keep й ї
    s = s.replace(/[ʼ’`´]/g, "'");
    s = s.replace(/\s*(грн|uah|hrn)\.?$/, "");
    if (/^[\d\s\-():.]+$/.test(s)) s = s.replace(/[\s\-()]+/g, "");
    s = s.replace(/^0(\d:\d\d)$/, "$1");
    s = s.replace(/\s+/g, " ").replace(/^[\s.!?]+|[\s.!?]+$/g, "");
    return s;
  }

  function gradeKeyed(form, answers) {
    const results = {}, unsure = [];
    for (const item of form.items || []) {
      const given = normalize((answers || {})[item.id]);
      const ok = given !== "" && (item.key || []).some((k) => normalize(k) === given);
      results[item.id] = ok;
      if (!ok && given && item.type !== "mcq") unsure.push(item.id);
    }
    return { results, unsure };
  }

  // ------------------------------------------------------------ scoring
  function score(rubric, grade) {
    if (rubric.scale === "share") {
      const v = Object.values(grade.item_results || {});
      return v.length ? v.filter(Boolean).length / v.length : 0;
    }
    const lv = {}; (grade.criteria || []).forEach((c) => (lv[c.id] = c.level));
    const total = rubric.criteria.reduce((a, c) => a + c.weight, 0);
    return rubric.criteria.reduce((a, c) => a + c.weight * CREDIT[lv[c.id] || 0], 0) / total;
  }

  function attemptOutcome(rubric, grade, threshold, cfg) {
    cfg = cfg || DEFAULT_CFG;
    const s = score(rubric, grade);
    if (rubric.scale === "share") {
      const v = Object.values(grade.item_results || {});
      const n = v.filter(Boolean).length;
      return { passed: s >= threshold - 1e-9, score: s, threshold, failed_musts: [], reason: `${n}/${v.length} richtig` };
    }
    const lv = {}; (grade.criteria || []).forEach((c) => (lv[c.id] = c.level));
    const failed = rubric.criteria.filter((c) => c.must && (lv[c.id] || 0) < cfg.must_min_level).map((c) => c.id);
    const passed = failed.length === 0 && s >= threshold - 1e-9;
    const reason = failed.length ? "Pflichtkriterien unter „erfüllt“: " + failed.join(", ")
      : passed ? "alle Pflichtkriterien erfüllt" : `Punktzahl unter ${Math.round(threshold * 100)} %`;
    return { passed, score: s, threshold, failed_musts: failed, reason };
  }

  function needsRegrade(rubric, grade, threshold, cfg) {
    cfg = cfg || DEFAULT_CFG;
    if (rubric.scale === "share") return false;
    if (Math.abs(score(rubric, grade) - threshold) <= cfg.borderline_margin) return true;
    const musts = new Set(rubric.criteria.filter((c) => c.must).map((c) => c.id));
    return (grade.criteria || []).some((c) => musts.has(c.id) && (c.level === 1 || c.level === 2) && (c.confidence ?? 1) < cfg.low_confidence);
  }

  function medianLow(arr) { const a = [...arr].sort((x, y) => x - y); return a[Math.floor((a.length - 1) / 2)]; }
  function median(arr) { const a = [...arr].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }

  function medianGrade(grades) {
    const ids = grades[0].criteria.map((c) => c.id);
    const crit = ids.map((id) => {
      const cs = grades.map((g) => g.criteria.find((c) => c.id === id) || { level: 0, confidence: 0 });
      return { id, level: medianLow(cs.map((c) => c.level)), confidence: median(cs.map((c) => c.confidence ?? 1)), evidence: cs[0].evidence || [] };
    });
    const target = JSON.stringify(crit.map((c) => c.level));
    const match = grades.find((g) => JSON.stringify(ids.map((id) => (g.criteria.find((c) => c.id === id) || {}).level)) === target);
    return Object.assign({}, grades[0], { grader: grades[0].grader + "×" + grades.length, criteria: crit,
      errors: match ? match.errors : grades.flatMap((g) => g.errors || []) });
  }

  // ------------------------------------------------------------ badge rule
  function textOf(form) {
    const parts = (form.stimuli || []).map((s) => s.body).concat((form.items || []).flatMap((i) => i.key || []));
    if (form.roleplay) parts.push(form.roleplay.opening_line || "", form.roleplay.persona || "");
    return parts.join(" ").toLowerCase().replace(/\s+/g, " ");
  }

  function formSimilarity(a, b, n = 5) {
    const grams = (t) => { const s = new Set(); for (let i = 0; i <= Math.max(t.length - n, 0); i++) s.add(t.slice(i, i + n)); return s; };
    const ga = grams(textOf(a)), gb = grams(textOf(b));
    let inter = 0; ga.forEach((g) => gb.has(g) && inter++);
    const uni = ga.size + gb.size - inter;
    return uni ? inter / uni : 1;
  }

  function days(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }

  function badgeDecision(attempts, rubric, threshold, cfg) {
    cfg = cfg || DEFAULT_CFG;
    const passes = attempts.filter((a) => a.kind === "full" && !a.voided && a.channel !== "typed-speech"
      && attemptOutcome(rubric, a.grade, threshold, cfg).passed).sort((x, y) => (x.takenOn < y.takenOn ? -1 : 1));
    if (!passes.length) return { awarded: false, pair: null, passes: 0, reason: "noch kein bestandener Test" };
    for (let i = 0; i < passes.length; i++) for (let j = i + 1; j < passes.length; j++) {
      const a = passes[i], b = passes[j], d = days(a.takenOn, b.takenOn);
      if (a.seed === b.seed || formSimilarity(a.form, b.form) > cfg.max_form_similarity) continue;
      if (d >= cfg.min_days_between && d <= cfg.pair_window_days) return { awarded: true, pair: [a.id, b.id], passes: passes.length, reason: `zwei unabhängige Tests, ${d} Tag(e) auseinander` };
    }
    return { awarded: false, pair: null, passes: passes.length,
      reason: passes.length === 1 ? "1 von 2 bestanden – nächsten Test an einem anderen Tag" : "bestandene Tests, aber nicht an verschiedenen Tagen im Zeitfenster" };
  }

  function heatmapStatus(outcome) {
    if (outcome.passed) return "likely";
    if (outcome.failed_musts.length <= 1 && outcome.score >= 0.75) return "shaky";
    return "unknown";
  }

  function probeStatus(correct, total) { total = total || 3; return correct === total ? "likely" : correct === total - 1 ? "shaky" : "unknown"; }

  // ------------------------------------------------------------ diagnosis
  const WEAK = new Set(["unknown", "shaky", "untested", "suspect"]);

  function weakAncestors(id, enablers, status) {
    const out = [], seen = new Set();
    (function walk(e) {
      for (const r of (enablers[e] && enablers[e].requires) || []) {
        if (seen.has(r)) continue; seen.add(r); walk(r);
        if (WEAK.has(status[r] || "untested")) out.push(r);
      }
    })(id);
    return out;
  }

  function diagnose(form, grade, enablers, status) {
    status = status || {};
    const count = {}, ex = {};
    const add = (en, e) => { count[en] = (count[en] || 0) + 1; (ex[en] = ex[en] || []).push(e); };
    for (const e of grade.errors || []) if (e.enabler && !String(e.enabler).startsWith("unlisted")) add(e.enabler, `${e.span} → ${e.correction}`);
    const itemEn = {}; (form.items || []).forEach((i) => (itemEn[i.id] = i.enablers || []));
    for (const [id, ok] of Object.entries(grade.item_results || {})) if (!ok) (itemEn[id] || []).forEach((en) => add(en, "Aufgabe " + id));
    const holes = Object.keys(count).sort((a, b) => count[b] - count[a]).map((en) => ({
      enabler: en, title: (enablers[en] || {}).title || en, cefr: (enablers[en] || {}).cefr || "?", errors: count[en],
      examples: ex[en].slice(0, 3), check_first: weakAncestors(en, enablers, status).concat([en]),
    }));
    const chunks = [...new Set((grade.errors || []).filter((e) => e.chunk).map((e) => e.chunk))].sort();
    const unlisted = (grade.errors || []).filter((e) => e.enabler && String(e.enabler).startsWith("unlisted")).map((e) => `${e.span}: ${e.enabler}`);
    return { holes, chunks, unlisted };
  }

  // ------------------------------------------------------------ statuses
  function skillStatus(skill, attempts, probe, rubric, cfg) {
    const mine = attempts.filter((a) => a.skill === skill.id && !a.voided && a.kind === "full");
    const thr = thresholdFor(skill, cfg);
    const badge = badgeDecision(mine, rubric, thr, cfg);
    if (badge.awarded) return { status: "badge", badge, last: mine[mine.length - 1] };
    const last = mine.sort((x, y) => (x.at < y.at ? -1 : 1))[mine.length - 1];
    if (probe && (!last || probe.at > last.at)) return { status: probe.status, badge, source: "probe" };
    if (!last) return { status: "untested", badge };
    const out = attemptOutcome(rubric, last.grade, thr, cfg);
    return { status: out.passed ? "likely" : heatmapStatus(out), badge, last, source: "test" };
  }

  function enablerStatuses(enablers, checks, attempts) {
    const st = {};
    const errs = {};
    for (const a of attempts) if (!a.voided) for (const e of (a.grade && a.grade.errors) || []) if (e.enabler) errs[e.enabler] = (errs[e.enabler] || 0) + 1;
    for (const [id, e] of Object.entries(enablers)) {
      const c = checks[id];
      if (e.channel === "audio") st[id] = "audio";
      else if (c) st[id] = c.status || (c.score >= 0.9 ? "known" : c.score >= 0.7 ? "shaky" : "unknown");
      else st[id] = errs[id] ? "suspect" : "untested";
    }
    return st;
  }

  // ------------------------------------------------------------ prompts
  const LANG = { de: "Deutsch", en: "English" };
  // Target language of the prompts; set by the app from content/<lang>/language.yaml.
  const TL = { code: "uk", name: "Ukrainisch", variety: "Standard", pitfalls: "Lehnübersetzungen", informal: "ти", formal: "ви" };
  function setTarget(meta) {
    meta = meta || {};
    const nm = meta.name || {};
    Object.assign(TL, { code: meta.code || TL.code, name: (typeof nm === "string" ? nm : nm.de || nm.en) || TL.name,
      variety: meta.variety || "Standard", pitfalls: ((meta.prompt || {}).pitfalls) || "Lehnübersetzungen, Interferenz aus anderen Sprachen",
      informal: ((meta.registers || {}).informal) || "informell", formal: ((meta.registers || {}).formal) || "formell" });
    return TL;
  }

  function enablerTable(real, enablers) {
    return real.enablers.map((u) => { const e = enablers[u.id] || {}; return `- ${u.id} (${u.use}, ${e.cefr}): ${e.title}`; }).join("\n");
  }
  function wordLists(real, enablers) {
    return real.enablers.map((u) => enablers[u.id]).filter((e) => e && e.words).map((e) => `${e.id}: ${e.words.join(", ")}`).join("\n");
  }

  const SYSTEM_GEN = (il) => `Du schreibst Testformulare für ein Sprachzertifikat. Ein Formular testet genau eine Alltagskompetenz auf ${TL.name}.
Schreib wie eine Muttersprachlerin (${TL.name}, ${TL.variety}) authentisches Alltagsmaterial, aber auf Niveau A1: kurze Sätze, häufige Wörter, nur die angegebene Grammatik.
Regeln:
1. Text auf ${TL.name} NUR im Material (stimuli), in Lösungen (key) und in der Eröffnungszeile der Gesprächspartnerin. Alles, was sich an die lernende Person richtet (Fragen, Aufgaben, Ziele), auf ${LANG[il] || il}.
2. Grammatik mit use=formulaic nur in festen Wendungen wie in den Beispielen, nie frei gebildet.
3. Bevorzuge Wörter aus den Wortlisten. Andere Wörter sind für Realismus erlaubt (max. 15 % des Materials), aber keine Lösung und kein Pflichtpunkt darf von ihnen abhängen.
4. Jede Aufgabe, jeder Inhaltspunkt und jeder Pflichtschritt nennt die Enabler-IDs, die er prüft (nur aus der Liste).
5. Jede Aufgabe hat genau eine vertretbare Lösung; bei Kurzantworten alle akzeptablen Varianten in key.
6. Keine Russizismen, kein Surschyk, keine Lehnübersetzungen. Im Zweifel einfacher formulieren.
7. Wiederhole kein Material, keine Namen, Preise oder Uhrzeiten aus den bereits gesehenen Tests.
Antworte NUR mit JSON.`;

  const SHAPES = {
    R: `{"stimuli":[{"kind":"text","title":str,"body":str}],"items":[{"id":"i1","type":"mcq"|"short_answer","prompt":str,"options":[4 strings, nur bei mcq],"key":[str],"enablers":[str]}],"summary":str}
Genau 10 Aufgaben: 6 mcq, 4 short_answer. Material 40-150 Wörter, gestaltet wie das echte Dokument (Zeilenumbrüche mit \\n). Bei mcq ist key genau der Text der richtigen Option. Höchstens 2 Aufgaben mit Rechnen. Keine Aufgabe ohne das Material lösbar.`,
    L: `{"stimuli":[{"kind":"audio_script","title":"Clip 1","body":str}, ... 8-10 Clips],"items":[{"id":"c1","type":"mcq"|"short_answer","prompt":str,"options":[...nur mcq],"key":[str],"enablers":[str],"stimulus":0}],"summary":str}
Genau 10 Aufgaben, jede bezieht sich auf genau einen Clip (stimulus = Index). Jeder Clip 1-2 kurze Sätze, natürlich gesprochen. Zahlen als Ziffern in key, Uhrzeiten als HH:MM (24h und 12h Variante).`,
    WI: `{"stimuli":[{"kind":"message"|"text","title":str,"body":str}] (eingehende Nachricht oder Formular; darf leer sein),"situation":str,"brief":[{"id":"c1","text":str,"must":bool,"enablers":[str]}],"word_range":[20,60],"summary":str}
4-6 Inhaltspunkte, davon 3-5 must. Inhaltspunkte sagen, WAS mitgeteilt wird, nie die Wörter auf ${TL.name}. Mindestens zwei Punkte erfordern die Schlüsselstrukturen. Bei Formularen: gib eine fiktive Identität in der Anweisungssprache vor und liste die Formularfelder im body.`,
    SI: `{"roleplay":{"persona":str,"setting":str,"register":"formal"|"informal","learner_goal":str,"required_moves":[{"id":"m1","text":str,"enablers":[str]}],"complications":[str],"opening_line":str,"max_turns":12},"summary":str}
4-7 Pflichtschritte, 1-2 Komplikationen (z. B. Artikel nicht verfügbar, Rückfrage, Missverständnis). persona, setting, learner_goal, required_moves und complications in der Anweisungssprache; opening_line in der Zielsprache.`,
  };

  function genPrompt(skill, real, enablers, seed, seenSummaries, il, avoid) {
    return SYSTEM_GEN(il) + `

Kompetenz: ${skill.id} — ${skill.title}
Can-do: ${skill.can_do}
Modus: ${skill.mode} · Niveau: ${real.cefr}
Register: ${real.registers.join(", ")} · Varietät: ${real.variety}
Beispielwendungen: ${real.exponents.join(" | ")}
Schlüsselstrukturen: ${real.key_structures || "—"}
Enabler (id, Gebrauch, Niveau: Titel):
${enablerTable(real, enablers)}
Wortlisten:
${wordLists(real, enablers) || "—"}

Seed: ${seed} (nutze ihn, um Teilsituation, Namen, Zahlen und ggf. Komplikationen zu wählen)
Bereits gesehene Tests: ${seenSummaries.length ? seenSummaries.join(" || ") : "keine"}
${avoid ? "Vermeide diese Probleme der letzten Version: " + avoid : ""}

Antwortformat (JSON):
${SHAPES[skill.mode]}`;
  }

  function validatePrompt(form, real) {
    return `Du bist eine strenge Muttersprachlerin (${TL.name}) und prüfst Testmaterial auf Niveau ${real.cefr}. Du hast es nicht geschrieben. Finde Probleme, repariere nichts.
Formular:
${JSON.stringify(form)}
Schlüsselstrukturen: ${real.key_structures || "—"}
Prüfe: 1) Sprachfehler im Text auf ${TL.name}, ${TL.pitfalls}. 2) Grammatik über dem Niveau, die frei (nicht in fester Wendung) verwendet wird. 3) Aufgaben mit keiner oder mehr als einer vertretbaren Lösung, falsche oder unvollständige keys. 4) Aufgaben ohne Material lösbar. 5) Bei Rollenspielen: Sind alle Pflichtschritte auf A1 machbar? 6) Ist das Material realistisch?
Antworte NUR mit JSON: {"ok": bool, "problems": [{"where": str, "kind": str, "detail": str, "severity": "blocker"|"minor"}]}`;
  }

  function interlocutorPrompt(rp, transcript, real) {
    return `Du spielst: ${rp.persona}. Situation: ${rp.setting}. Du sprichst NUR ${TL.name} (${(real && real.variety) || TL.variety}), Register: ${rp.register === "informal" ? TL.informal : TL.formal}, mit einer lernenden Person auf Niveau A1.
So sprichst du: kurze, einfache Sätze mit häufigen Wörtern, wie eine geduldige Muttersprachlerin mit einer Ausländerin. Wenn die Person bittet zu wiederholen, langsamer zu sprechen oder zu buchstabieren, tu es einfacher. Wechsle nie die Sprache, übersetze nie, korrigiere nie, lobe nie die Sprache, gib keine Hinweise, was sie sagen soll. Bleib in der Rolle; reagiere auf das, was tatsächlich gesagt wurde: Ist etwas unklar, frag nach; ist es trotz Fehlern klar, mach weiter.
Verdecktes Skript – Ziel der Person: ${rp.learner_goal}. Schritte, die sie machen sollte: ${rp.required_moves.map((m) => m.text).join("; ")}. Komplikationen, die du natürlich einbaust: ${rp.complications.join("; ")}. Beende das Gespräch natürlich, wenn das Ziel erreicht ist, spätestens nach ${rp.max_turns || 12} deiner Beiträge.
Bisheriges Gespräch:
${transcript.map((t) => (t.speaker === "learner" ? "Lernende: " : "Du: ") + t.text).join("\n")}
Antworte NUR mit JSON: {"text": "<deine nächste Zeile auf ${TL.name}>", "conversation_over": bool}`;
  }

  function gradePrompt(skill, form, rubric, real, enablers, responseText, il) {
    const levels = rubric.criteria.map((c) => `- ${c.id} (${c.must ? "Pflicht" : "optional"}, Gewicht ${c.weight}): ` +
      Object.entries(c.levels || {}).map(([k, v]) => `${k}=${v}`).join(" | ")).join("\n");
    const task = form.roleplay ? `Rollenspiel: ${JSON.stringify(form.roleplay)}`
      : `Material: ${JSON.stringify(form.stimuli || [])}\nSituation: ${form.situation || ""}\nInhaltspunkte: ${JSON.stringify(form.brief || [])}`;
    return `Du bist eine strenge, faire Prüferin für ein kriterienbasiertes Zertifikat. Es bestätigt, dass die Person eine Alltagskompetenz auf ${real.cefr} ohne nennenswerte Lücken beherrscht. Bestehen heißt „sehr gut“: alles Geforderte vorhanden und korrekt, höchstens kleine Ausrutscher. Bewerte nur nach der Rubrik, nie nach Aufwand.
So bewertest du:
- Jedes Kriterium einzeln, genau nach den Stufenbeschreibungen. Zitiere die Worte der Person als Beleg.
- key_structures – Ausrutscher oder Lücke: Ist eine Zielstruktur an einer Stelle falsch, aber an anderer Stelle in DIESER Antwort richtig, ist es ein Ausrutscher (Stufe 2 möglich). Ist sie falsch und nirgends in dieser Antwort richtig, ist es eine Lücke (höchstens Stufe 1). Zwei oder mehr Ausrutscher ergeben Stufe 1.
- Feste Wendungen: Enabler mit use=formulaic sind auswendig gelernte Wendungen. Bewerte sie als Ganzes. Ist eine kaputt, trage den Fehler mit "chunk" (die Wendung) ein und lass "enabler" leer.
- Fehler außerhalb der Zielstrukturen, die die Bedeutung nicht blockieren, senken key_structures nicht; trage sie trotzdem ein.
- Jeder Fehler: genaue Stelle (span), Korrektur, betroffenes Kriterium, und der produktive Enabler aus der Liste unten, oder "unlisted: <kurze Beschreibung>".
- Akzeptiere jede korrekte Variante, die Muttersprachler akzeptieren würden. Belohne keine Länge.
- confidence je Kriterium (0-1).
- feedback: 2-3 Sätze auf ${LANG[il] || il} an die Person: was gut war, was fehlt.

Kompetenz: ${skill.title} — ${skill.can_do}
${task}
Rubrik:
${levels}
Schlüsselstrukturen: ${real.key_structures || "—"}
Enabler (id, Gebrauch, Niveau: Titel):
${enablerTable(real, enablers)}

Antwort der Person:
"""
${responseText}
"""
Antworte NUR mit JSON: {"criteria":[{"id":str,"level":0-3,"confidence":number,"evidence":[str]}],"errors":[{"span":str,"correction":str,"criterion":str,"enabler":str|null,"chunk":str|null,"blocks_meaning":bool}],"feedback":str}`;
  }

  function judgePrompt(items) {
    return `Entscheide für jede Kurzantwort, ob sie dasselbe bedeutet wie eine der akzeptierten Lösungen. Bei Grammatik-Aufgaben (gap_fill, transform) streng: eine falsche Endung ist falsch. Bei Verständnis-Aufgaben (short_answer, produce bei Lesen/Hören) bei Rechtschreibung nachsichtig, wenn eindeutig das Richtige gemeint ist. Bei produce-Aufgaben (Sprechen/Schreiben): richtig nur, wenn die Antwort (${TL.name}) grammatisch korrekt und angemessen ist; die Musterlösungen sind Beispiele, andere korrekte Formulierungen zählen auch.
Aufgaben:
${JSON.stringify(items)}
Antworte NUR mit JSON: {"results":[{"id":str,"correct":bool,"reason":str,"enabler":str|null}]}`;
  }

  function enablerCheckPrompt(en, il, seed) {
    return SYSTEM_GEN(il) + `

Erstelle einen Kurz-Check für genau einen Baustein:
${en.id} (${en.kind}, ${en.cefr}): ${en.title}
${en.words ? "Wortliste: " + en.words.join(", ") : ""}
Seed: ${seed}
${en.kind === "lexis" ? `12 Aufgaben, nur Wörter aus der Liste: 6× Bedeutung → Wort (format "type": Anweisung auf ${LANG[il] || il} nennt die Bedeutung, Antwort ist das Wort), 6× Wort → Bedeutung (format "choice": 4 Bedeutungen auf ${LANG[il] || il}).`
  : `10 Aufgaben: kurze natürliche Sätze aus A1-Situationen, die Zielform ist die einzige Lücke ___.
Teile den Baustein in Unterregeln (facets) und ordne jede einem Band zu:
- core: die Grundregel mit häufigen Wörtern (4 Aufgaben)
- variant: regelmäßige Unterfälle, die Lernende stolpern lassen, z. B. Lautwechsel, weiche Stämme (3 Aufgaben)
- exception: Formen, die man auswendig lernen muss (1-2 Aufgaben, falls es welche auf A1 gibt)
- contrast: wann die Form gilt, gegen eine verwechselbare Nachbarform (1-2 Aufgaben)
Format je Unterregel, für alle ihre Aufgaben gleich:
- "choice", wenn man aus einer kleinen geschlossenen Menge von Wörtern WÄHLT (z. B. у/в, ти/ви, він/вона/воно, eine Form gegen ihre Verwechslungsform). options = die vollständige Menge, nie ausgedachte Ablenker.
- "type", wenn man eine Form BILDET (Endungen, Konjugation, Deklination). Grundform als "cue", keine options.
Kein Satz darf die Lösung verraten (z. B. kein Adjektiv mit Genus-Endung neben der Lücke, wenn das Genus gefragt ist).`}
Antwortformat: {"items":[{"id":"g1","band":"core"|"variant"|"exception"|"contrast","facet":str (kurze Unterregel auf ${LANG[il] || il}),"format":"choice"|"type","instruction":str (auf ${LANG[il] || il}),"stem":str (Satz auf ${TL.name} mit ___),"cue":str|null,"options":[nur bei choice],"key":[str]}],"summary":str}`;
  }

  // ------------------------------------------------------------ question catalogues (mirrors src/lingbadge/checks.py)
  const BANDS = ["core", "variant", "exception", "contrast"];
  const DEFAULT_BLUEPRINT = { core: 0.4, variant: 0.3, exception: 0.15, contrast: 0.15 };
  const tx = (t, il) => (t == null ? "" : typeof t === "string" ? t : t[il] || t.en || Object.values(t)[0] || "");

  function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(arr, r) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

  function quotas(n, available, weights) {
    weights = weights || DEFAULT_BLUEPRINT;
    const bands = BANDS.filter((b) => available[b]);
    if (!bands.length) return {};
    let w = {}; bands.forEach((b) => (w[b] = Number(weights[b] || 0)));
    const tot = bands.reduce((a, b) => a + w[b], 0);
    bands.forEach((b) => (w[b] = tot ? w[b] / tot : 1 / bands.length));
    const q = {}; bands.forEach((b) => (q[b] = n >= bands.length ? 1 : 0));
    let left = n - bands.reduce((a, b) => a + q[b], 0);
    while (left > 0) {
      const open = bands.filter((b) => q[b] < available[b]);
      if (!open.length) break;
      open.sort((x, y) => (w[y] * n - q[y]) - (w[x] * n - q[x]) || BANDS.indexOf(x) - BANDS.indexOf(y));
      q[open[0]]++; left--;
    }
    return q;
  }

  // Pick n items: band mix from the blueprint, spread over facets, least-seen items first.
  function sampleCheck(cat, n, seen, seed) {
    const r = rng(seed == null ? Date.now() : seed); seen = seen || {};
    const facets = {}; cat.facets.forEach((f) => (facets[f.id] = f));
    const byBand = {};
    cat.items.forEach((it) => { const b = facets[it.facet].band; ((byBand[b] = byBand[b] || {})[it.facet] = byBand[b][it.facet] || []).push(it); });
    const avail = {}; Object.keys(byBand).forEach((b) => (avail[b] = Object.values(byBand[b]).reduce((a, g) => a + g.length, 0)));
    const q = quotas(n, avail, cat.blueprint);
    const picked = [];
    for (const [b, k0] of Object.entries(q)) {
      let k = k0;
      const groups = shuffle(Object.values(byBand[b]).map((g) => g.map((it) => [seen[it.id] || 0, r(), it]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2])), r);
      groups.sort((x, y) => (seen[x[0].id] || 0) - (seen[y[0].id] || 0));
      let i = 0;
      while (k > 0 && groups.some((g) => g.length)) { const g = groups[i % groups.length]; if (g.length) { picked.push(g.shift()); k--; } i++; }
    }
    return shuffle(picked, r);
  }

  // Turn catalogue items into form items the app can render and grade.
  function catalogueForm(cat, picked, il) {
    const facets = {}; cat.facets.forEach((f) => (facets[f.id] = f));
    return picked.map((it) => {
      const f = facets[it.facet];
      return { id: it.id, type: f.format === "choice" ? "mcq" : "gap_fill", band: f.band, facet: f.id,
        instruction: tx(f.instruction, il), context: tx(it.context, il) || null, stem: it.stem, cue: it.cue || null,
        prompt: (it.context ? tx(it.context, il) + " " : "") + it.stem + (it.cue ? " (" + it.cue + ")" : ""),
        options: f.format === "choice" ? (it.options || f.options).slice() : undefined, key: it.answer.slice(), rule: tx(f.rule, il),
        enablers: [cat.enabler] };
    });
  }

  // Per band: right/total; status = known only if the share passes AND every core item is right.
  function checkBreakdown(items, results, threshold) {
    const bands = {};
    items.forEach((it) => { const b = it.band || "core"; bands[b] = bands[b] || { right: 0, total: 0, wrong: [] }; bands[b].total++; if (results[it.id]) bands[b].right++; else bands[b].wrong.push(it.id); });
    const v = Object.values(results), score = v.length ? v.filter(Boolean).length / v.length : 0;
    const coreOk = !bands.core || bands.core.right === bands.core.total;
    const status = score >= threshold && coreOk ? "known" : score >= 0.7 ? "shaky" : "unknown";
    let verdict;
    if (status === "known") verdict = "Sitzt.";
    else if (!coreOk) verdict = "Die Grundregel sitzt noch nicht.";
    else if (bands.exception && bands.exception.wrong.length && (!bands.variant || !bands.variant.wrong.length) && (!bands.contrast || !bands.contrast.wrong.length)) verdict = "Die Regel sitzt; einzelne Ausnahmen fehlen noch.";
    else if (bands.contrast && bands.contrast.wrong.length && (!bands.variant || !bands.variant.wrong.length)) verdict = "Die Formen sitzen, aber wann man sie verwendet, ist noch unsicher.";
    else verdict = "Die Grundregel sitzt; Unterfälle sind noch unsicher.";
    return { score, status, bands, coreOk, verdict };
  }

  function probePrompt(theme, skills, reals, enablers, il, seed) {
    const list = skills.map((s) => { const r = reals[s.id]; return `- ${s.id} (${s.mode}): ${s.can_do} | Beispiele: ${r.exponents.slice(0, 3).join(" | ")} | Schlüsselstrukturen: ${r.key_structures || "—"}`; }).join("\n");
    return SYSTEM_GEN(il) + `

Erstelle eine kurze Einstufung (Probe) für das Thema „${theme.title}“. Für JEDE Kompetenz unten genau 3 Aufgaben, die die wichtigsten Punkte prüfen.
- Lesen (R) / Hören (L): ein kurzes Material (R: Text 20-60 Wörter; L: 1-3 Sätze als audio_script) und 3 Aufgaben (mcq oder short_answer).
- Schreiben/Sprechen (WI, SI, SP): kein Material; 3 Aufgaben vom Typ "produce": eine kurze Situation in der Anweisungssprache („Sie möchten …, was schreiben/sagen Sie?“), key = 1-3 korrekte Musterlösungen auf ${TL.name}.
Kompetenzen:
${list}
Seed: ${seed}
Antwortformat: {"skills":[{"skill":str,"stimulus":{"kind":"text"|"audio_script","body":str}|null,"items":[{"id":str (eindeutig, z. B. s1i1),"type":"mcq"|"short_answer"|"produce","prompt":str,"options":[nur mcq],"key":[str],"enablers":[str]}]}]}`;
  }

  const api = { CREDIT, DEFAULT_CFG, cfgFrom, thresholdFor, normalize, gradeKeyed, score, attemptOutcome, needsRegrade, medianGrade,
    formSimilarity, badgeDecision, heatmapStatus, probeStatus, diagnose, skillStatus, enablerStatuses,
    genPrompt, validatePrompt, interlocutorPrompt, gradePrompt, judgePrompt, enablerCheckPrompt, probePrompt,
    TL, setTarget, BANDS, quotas, sampleCheck, catalogueForm, checkBreakdown, tx };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.LB = api;
})(typeof window !== "undefined" ? window : globalThis);
