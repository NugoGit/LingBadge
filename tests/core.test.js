// node tests/core.test.js — runs the Stage 3 worked examples through app/core.js
const assert = require("assert");
const fs = require("fs");
const LB = require("../app/core.js");
// node tests/core.test.js [examples.json]   (examples.json from: python tools/examples_to_json.py)
const vm = require("vm");
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(__dirname + "/../app/content.js", "utf8"), sandbox);
const C = JSON.parse(JSON.stringify(sandbox.window.LB_CONTENT));  // same-realm objects for deepStrictEqual
Object.assign(C, { enablers: C.langs.uk.enablers, realizations: C.langs.uk.realizations });
const EX = JSON.parse(process.argv[2] ? fs.readFileSync(process.argv[2], "utf8")
  : require("child_process").execFileSync("python3", [__dirname + "/../tools/examples_to_json.py"], { encoding: "utf8" }));
const cfg = LB.cfgFrom(C.mastery);
const skill = (id) => C.skills.find((s) => s.id === id);
function build(a) {
  const form = a.form, rubric = C.rubrics[form.rubric];
  const grade = a.grade || { item_results: LB.gradeKeyed(form, a.response.answers).results };
  return { id: a.id, kind: form.kind || "full", seed: form.seed, takenOn: a.taken_on, at: a.taken_on, form, grade, rubric, skill: form.skill };
}
assert.strictEqual(LB.normalize("165 грн"), "165");
assert.strictEqual(LB.normalize("095 723 40 16"), "0957234016");
assert.strictEqual(LB.normalize("07:30"), "7:30");
assert.strictEqual(LB.normalize("п’ять"), LB.normalize("п'ять"));
assert.strictEqual(LB.normalize("Чоти́ри си́ри"), "чотири сири");
assert.strictEqual(LB.normalize("її"), "її");
// 1 menu
let ex = EX["01_food.menu.R.yaml"], at = ex.attempts.map(build), thr = LB.thresholdFor(skill("food.menu.R"), cfg);
at.forEach((a) => { const e = ex.expected[a.id]; assert.strictEqual(Object.values(a.grade.item_results).filter(Boolean).length, e.item_correct);
  assert.strictEqual(LB.attemptOutcome(a.rubric, a.grade, thr, cfg).passed, e.passed); });
assert.strictEqual(LB.badgeDecision(at.slice(0, 1), at[0].rubric, thr, cfg).awarded, false);
const bd = LB.badgeDecision(at, at[0].rubric, thr, cfg); assert.ok(bd.awarded); assert.deepStrictEqual(bd.pair, ["a1", "a2"]);
assert.strictEqual(LB.badgeDecision([at[0], Object.assign({}, at[0], { id: "a2", takenOn: "2026-11-20" })], at[0].rubric, thr, cfg).awarded, false);
// 2 plans
ex = EX["02_relations.plans.WI.yaml"]; let a = build(ex.attempts[0]), e = ex.expected.a1; thr = LB.thresholdFor(skill("relations.plans.WI"), cfg);
let o = LB.attemptOutcome(a.rubric, a.grade, thr, cfg);
assert.strictEqual(o.passed, e.passed); assert.deepStrictEqual(o.failed_musts, e.failed_musts); assert.strictEqual(Math.round(o.score * 1000) / 1000, e.score);
assert.strictEqual(LB.needsRegrade(a.rubric, a.grade, thr, cfg), e.needs_regrade);
const med = LB.medianGrade(ex.attempts[0].regrades);
assert.strictEqual(med.criteria.find((c) => c.id === "key_structures").level, e.median_key_structures);
assert.deepStrictEqual(LB.diagnose(a.form, med, C.enablers, ex.enabler_status).holes[0].check_first, e.check_first);
// 3 cafe
ex = EX["03_food.cafe.SI.yaml"]; a = build(ex.attempts[0]); e = ex.expected.a1; thr = LB.thresholdFor(skill("food.cafe.SI"), cfg);
o = LB.attemptOutcome(a.rubric, a.grade, thr, cfg);
assert.strictEqual(o.passed, e.passed); assert.strictEqual(LB.heatmapStatus(o), e.heatmap);
let dx = LB.diagnose(a.form, a.grade, C.enablers, ex.enabler_status);
assert.strictEqual(dx.holes[0].enabler, e.top_hole); assert.strictEqual(dx.holes[0].errors, 2); assert.deepStrictEqual(dx.chunks, e.chunks);
assert.ok(!dx.holes.some((h) => h.enabler === "uk.gram.noun.gen-sg")); assert.deepStrictEqual(dx.holes[0].check_first, e.check_first);
// 4 numbers
ex = EX["04_comm.numbers.L.yaml"]; a = build(ex.attempts[0]); e = ex.expected.a1; thr = LB.thresholdFor(skill("comm.numbers.L"), cfg);
assert.strictEqual(Object.values(a.grade.item_results).filter(Boolean).length, e.item_correct);
o = LB.attemptOutcome(a.rubric, a.grade, thr, cfg); assert.strictEqual(o.threshold, e.threshold); assert.strictEqual(o.passed, e.passed);
assert.strictEqual(LB.diagnose(a.form, a.grade, C.enablers).holes[0].enabler, e.top_hole);
// 5 enabler check
ex = EX["05_enabler-check.gen-sg.yaml"]; a = build(ex.attempts[0]); e = ex.expected.a1;
assert.deepStrictEqual(Object.entries(a.grade.item_results).filter(([, v]) => !v).map(([k]) => k).sort(), e.wrong);
assert.strictEqual(LB.attemptOutcome(a.rubric, a.grade, 0.9, cfg).passed, e.passed);
// prompts build without throwing
const s = skill("food.cafe.SI"), r = C.realizations[s.id];
assert.ok(LB.genPrompt(s, r, C.enablers, 1, [], "de").includes("Schlüsselstrukturen"));
assert.ok(LB.gradePrompt(s, { roleplay: EX["03_food.cafe.SI.yaml"].attempts[0].form.roleplay }, C.rubrics[s.rubric], r, C.enablers, "x", "de").length > 1000);

// question catalogues: sampling and band breakdown
assert.deepStrictEqual(LB.quotas(10, { core: 20, variant: 8, exception: 4, contrast: 6 }), { core: 4, variant: 3, exception: 2, contrast: 1 });
assert.deepStrictEqual(LB.quotas(10, { core: 20, exception: 1 }), { core: 9, exception: 1 });
for (const [code, L] of Object.entries(C.langs)) for (const [id, cat] of Object.entries(L.checks || {})) {
  const n = L.enablers[id].items, picked = LB.sampleCheck(cat, n, {}, 42);
  assert.strictEqual(new Set(picked.map((x) => x.id)).size, Math.min(n, cat.items.length), id);
  const items = LB.catalogueForm(cat, picked, "de");
  items.forEach((it) => { assert.ok(it.stem.includes("___"), it.id); if (it.type === "mcq") assert.ok(it.options.some((o) => LB.normalize(o) === LB.normalize(it.key[0])), it.id); });
  const seen = {}; picked.forEach((x) => (seen[x.id] = 1));
  const again = LB.sampleCheck(cat, n, seen, 43), overlap = again.filter((x) => seen[x.id]).length;
  assert.ok(overlap <= Math.max(0, 2 * n - cat.items.length) + 2, id + " overlap " + overlap);
  const all = {}; items.forEach((it) => (all[it.id] = true));
  assert.strictEqual(LB.checkBreakdown(items, all, 0.9).status, "known");
  const coreMiss = Object.assign({}, all); const firstCore = items.find((it) => it.band === "core"); if (firstCore) { coreMiss[firstCore.id] = false; assert.notStrictEqual(LB.checkBreakdown(items, coreMiss, 0.9).status, "known"); }
}
LB.setTarget(C.langs.fa.meta); assert.ok(LB.enablerCheckPrompt(C.langs.fa.enablers[Object.keys(C.langs.fa.enablers)[0]], "de", 1).includes("Persisch"));
LB.setTarget(C.langs.uk.meta);
console.log("core.js: all checks passed");
