#!/usr/bin/env node
const URL =
  process.argv[2] ||
  "https://semicolony.dev/codex/kubernetes/internals/controllers/";
const BASE = process.argv[3] || "http://localhost:5173";

function ms(n) {
  return (n / 1000).toFixed(2) + "s";
}

async function timed(label, fn) {
  const t0 = performance.now();
  process.stdout.write(`▶ ${label} ... `);
  try {
    const result = await fn();
    const elapsed = performance.now() - t0;
    console.log(`OK (${ms(elapsed)})`);
    return { ok: true, elapsed, result };
  } catch (err) {
    const elapsed = performance.now() - t0;
    console.log(`FAIL (${ms(elapsed)}): ${err.message}`);
    return { ok: false, elapsed, error: err };
  }
}

async function api(path, init) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Session-Id": "cli-bench",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `non-JSON ${res.status}: ${text.slice(0, 160).replace(/\s+/g, " ")}`,
    );
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const health = await timed("GET  /api/health", () => api("/api/health"));
if (!health.ok) process.exit(1);

console.log("BASE", BASE);
console.log("URL ", URL);
console.log("");

const cold = await timed(
  "POST /api/sources (useCache:false) — Browser Run fetch",
  () =>
    api("/api/sources", {
      method: "POST",
      body: JSON.stringify({ type: "url", url: URL, useCache: false }),
    }),
);
if (!cold.ok) process.exit(1);
console.log(
  "   ",
  JSON.stringify({
    sourceId: cold.result.sourceId,
    title: cold.result.title,
    truncated: cold.result.truncated,
    cached: cold.result.cached,
  }),
);

const warm = await timed(
  "POST /api/sources (useCache:true)  — expect D1 hit",
  () =>
    api("/api/sources", {
      method: "POST",
      body: JSON.stringify({ type: "url", url: URL, useCache: true }),
    }),
);
if (warm.ok) {
  console.log(
    "   ",
    JSON.stringify({
      sourceId: warm.result.sourceId,
      cached: warm.result.cached,
      title: warm.result.title,
    }),
  );
}

const sourceId = cold.result.sourceId;
const quiz = await timed(
  "POST /api/quizzes (count:5) — Workers AI generate",
  () =>
    api("/api/quizzes", {
      method: "POST",
      body: JSON.stringify({ sourceId, count: 5, language: "en" }),
    }),
);
if (!quiz.ok) process.exit(1);
console.log("   ", JSON.stringify(quiz.result));

const get = await timed("GET  /api/quizzes/:id — read back", () =>
  api("/api/quizzes/" + quiz.result.quizId),
);
if (get.ok) {
  console.log(
    "   ",
    JSON.stringify({
      questions: get.result.questions?.length,
      firstStem: get.result.questions?.[0]?.stem?.slice(0, 80),
    }),
  );
}

console.log("\n=== Summary ===");
const rows = [
  ["health", health.elapsed],
  ["sources cold (Browser)", cold.elapsed],
  ["sources warm (cache)", warm.ok ? warm.elapsed : NaN],
  ["quizzes generate (AI)", quiz.elapsed],
  ["quizzes get", get.ok ? get.elapsed : NaN],
];
for (const [name, t] of rows) {
  console.log(name.padEnd(28), Number.isFinite(t) ? ms(t) : "n/a");
}
const total = [cold, quiz, get]
  .filter((x) => x.ok)
  .reduce((a, x) => a + x.elapsed, 0);
console.log(
  "full generate path".padEnd(28),
  ms(total),
  "(cold fetch + AI + get)",
);
