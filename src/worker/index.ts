import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { fetchSource, normalizeTextSource } from "./ingest";
import { generateMcq } from "./llm";
import {
  DEFAULT_QUIZ_COUNT,
  MAX_QUIZ_COUNT,
  MIN_QUIZ_COUNT,
  type PublicQuestion,
  type QuestionRow,
  type SourceRow,
} from "./types";

type AppEnv = { Bindings: Env };

const app = new Hono<AppEnv>();
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

app.use("/api/*", async (c, next) => {
  const existing = getCookie(c, "dropbrain_sid");
  if (!existing) {
    const sessionId =
      c.req.header("X-Session-Id")?.trim() || crypto.randomUUID();
    setCookie(c, "dropbrain_sid", sessionId, {
      path: "/",
      maxAge: SESSION_MAX_AGE,
      sameSite: "Lax",
    });
  }
  await next();
});

app.get("/api/health", (c) => c.json({ ok: true, name: "Dropbrain" }));

app.post("/api/sources", async (c) => {
  const body = await c.req.json<{
    type?: string;
    content?: string;
    url?: string;
  }>();

  if (body.type !== "text" && body.type !== "url") {
    return c.json({ error: 'type must be "text" or "url"' }, 400);
  }

  try {
    const fetched =
      body.type === "text"
        ? normalizeTextSource(body.content ?? "")
        : await fetchSource(c.env.BROWSER, body.url ?? "");

    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO sources (id, type, title, body_md, url)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        body.type,
        fetched.title,
        fetched.markdown,
        body.type === "url" ? (body.url ?? null) : null,
      )
      .run();

    return c.json({
      sourceId: id,
      title: fetched.title,
      truncated: fetched.truncated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ingest failed";
    return c.json({ error: message }, 400);
  }
});

app.post("/api/quizzes", async (c) => {
  const body = await c.req.json<{ sourceId?: string; count?: number }>();
  if (!body.sourceId) {
    return c.json({ error: "sourceId is required" }, 400);
  }

  const count = Math.min(
    MAX_QUIZ_COUNT,
    Math.max(MIN_QUIZ_COUNT, Number(body.count) || DEFAULT_QUIZ_COUNT),
  );

  const source = await c.env.DB.prepare(
    `SELECT id, type, title, body_md, url, created_at FROM sources WHERE id = ?`,
  )
    .bind(body.sourceId)
    .first<SourceRow>();

  if (!source) {
    return c.json({ error: "Source not found" }, 404);
  }

  try {
    const questions = await generateMcq(c.env, source.body_md, count);
    const quizId = crypto.randomUUID();

    await c.env.DB.prepare(
      `INSERT INTO quizzes (id, source_id) VALUES (?, ?)`,
    )
      .bind(quizId, source.id)
      .run();

    const stmts = questions.map((q) =>
      c.env.DB.prepare(
        `INSERT INTO questions
          (id, quiz_id, stem, options_json, correct_index, explanation, tags_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        quizId,
        q.stem,
        JSON.stringify(q.options),
        q.correctIndex,
        q.explanation,
        JSON.stringify(q.tags),
      ),
    );
    await c.env.DB.batch(stmts);

    return c.json({
      quizId,
      sourceId: source.id,
      title: source.title,
      count: questions.length,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Quiz generation failed";
    return c.json({ error: message }, 500);
  }
});

app.get("/api/quizzes/:id", async (c) => {
  const quizId = c.req.param("id");
  const quiz = await c.env.DB.prepare(
    `SELECT q.id, q.source_id, q.created_at, s.title as source_title
     FROM quizzes q JOIN sources s ON s.id = q.source_id
     WHERE q.id = ?`,
  )
    .bind(quizId)
    .first<{
      id: string;
      source_id: string;
      created_at: string;
      source_title: string;
    }>();

  if (!quiz) {
    return c.json({ error: "Quiz not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, stem, options_json, tags_json FROM questions WHERE quiz_id = ?`,
  )
    .bind(quizId)
    .all<Pick<QuestionRow, "id" | "stem" | "options_json" | "tags_json">>();

  const questions: PublicQuestion[] = (
    results ?? ([] as Array<Pick<QuestionRow, "id" | "stem" | "options_json" | "tags_json">>)
  ).map((row) => ({
    id: row.id,
    stem: row.stem,
    options: JSON.parse(row.options_json) as string[],
    tags: JSON.parse(row.tags_json) as string[],
  }));

  return c.json({
    id: quiz.id,
    sourceId: quiz.source_id,
    title: quiz.source_title,
    questions,
  });
});

async function loadQuizQuestions(db: D1Database, quizId: string) {
  const quiz = await db
    .prepare(`SELECT id FROM quizzes WHERE id = ?`)
    .bind(quizId)
    .first<{ id: string }>();
  if (!quiz) return null;

  const { results } = await db
    .prepare(
      `SELECT id, stem, options_json, correct_index, explanation, tags_json
       FROM questions WHERE quiz_id = ?`,
    )
    .bind(quizId)
    .all<QuestionRow>();

  return { quiz, questions: results ?? [] };
}

function gradeAnswers(
  questions: QuestionRow[],
  answers: Array<{ questionId: string; choice: number }>,
) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  let correct = 0;
  const graded = answers.map((a) => {
    const q = byId.get(a.questionId);
    if (!q) {
      return {
        questionId: a.questionId,
        choice: a.choice,
        correct: false,
        correctIndex: -1,
        stem: "",
        options: [] as string[],
        explanation: "Question not found",
        tags: [] as string[],
      };
    }
    const isCorrect = a.choice === q.correct_index;
    if (isCorrect) correct += 1;
    return {
      questionId: q.id,
      choice: a.choice,
      correct: isCorrect,
      correctIndex: q.correct_index,
      stem: q.stem,
      options: JSON.parse(q.options_json) as string[],
      explanation: q.explanation,
      tags: JSON.parse(q.tags_json) as string[],
    };
  });

  const total = graded.length;
  const score = total === 0 ? 0 : correct / total;
  const weakTagCounts = new Map<string, number>();
  for (const g of graded) {
    if (!g.correct) {
      for (const tag of g.tags) {
        weakTagCounts.set(tag, (weakTagCounts.get(tag) ?? 0) + 1);
      }
    }
  }
  const weakTags = [...weakTagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, misses]) => ({ tag, misses }));

  return { graded, correct, total, score, weakTags };
}

/** Immediate single-question feedback (no attempt row). */
app.post("/api/quizzes/:id/check", async (c) => {
  const quizId = c.req.param("id");
  const body = await c.req.json<{ questionId?: string; choice?: number }>();
  if (!body.questionId || typeof body.choice !== "number") {
    return c.json({ error: "questionId and choice required" }, 400);
  }

  const loaded = await loadQuizQuestions(c.env.DB, quizId);
  if (!loaded) return c.json({ error: "Quiz not found" }, 404);

  const q = loaded.questions.find((row: QuestionRow) => row.id === body.questionId);
  if (!q) return c.json({ error: "Question not found" }, 404);

  const isCorrect = body.choice === q.correct_index;
  return c.json({
    questionId: q.id,
    choice: body.choice,
    correct: isCorrect,
    correctIndex: q.correct_index,
    explanation: q.explanation,
    tags: JSON.parse(q.tags_json) as string[],
  });
});

app.post("/api/quizzes/:id/submit", async (c) => {
  const quizId = c.req.param("id");
  const sessionId =
    getCookie(c, "dropbrain_sid") ??
    c.req.header("X-Session-Id")?.trim() ??
    crypto.randomUUID();

  const body = await c.req.json<{
    answers?: Array<{ questionId: string; choice: number }>;
  }>();

  if (!Array.isArray(body.answers) || body.answers.length === 0) {
    return c.json({ error: "answers required" }, 400);
  }

  const loaded = await loadQuizQuestions(c.env.DB, quizId);
  if (!loaded) return c.json({ error: "Quiz not found" }, 404);

  const { graded, correct, total, score, weakTags } = gradeAnswers(
    loaded.questions,
    body.answers,
  );

  const attemptId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO attempts (id, quiz_id, session_id, score, answers_json)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(attemptId, quizId, sessionId, score, JSON.stringify(graded))
    .run();

  setCookie(c, "dropbrain_sid", sessionId, {
    path: "/",
    maxAge: SESSION_MAX_AGE,
    sameSite: "Lax",
  });

  return c.json({
    attemptId,
    score,
    correct,
    total,
    weakTags,
    results: graded,
  });
});

export default app;
