// node tests/core.test.js — runs the Stage 3 worked examples through app/core.js
const assert = require("assert");
const fs = require("fs");
const LB = require("../app/core.js");
const C = JSON.parse(fs.readFileSync(__dirname + "/../app/content.json", "utf8"));
const EX = JSON.parse(fs.readFileSync(process.argv[2] || "/tmp/ex.json", "utf8"));
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
console.log("core.js: all checks passed");
