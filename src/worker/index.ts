import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {
  fetchSourceDeduped,
  normalizeTextSource,
  d1UrlSourceStore,
  resolveUrlSource,
  UnusableSourceError,
  isTruncatedBody,
} from "./ingest";
import {
  generateMcq,
  UnusableMaterialError,
  normalizeLanguage,
  chatSseResponse,
  streamAskAnything,
  streamChatAboutQuestion,
  parseClientQuestionChatContext,
} from "./llm";
import {
  checkChoice,
  gradeAnswers,
  type GradeQuestion,
} from "../shared/grade";
import { cloudflareAiRateLimit } from "./rateLimit";
import {
  DEFAULT_QUIZ_COUNT,
  MAX_QUIZ_COUNT,
  MIN_QUIZ_COUNT,
  type PublicQuestion,
  type QuestionRow,
  type SourceRow,
} from "./types";

function toGradeQuestion(row: QuestionRow): GradeQuestion {
  return {
    id: row.id,
    stem: row.stem,
    options: JSON.parse(row.options_json) as string[],
    correctIndex: row.correct_index,
    explanation: row.explanation,
    tags: JSON.parse(row.tags_json) as string[],
  };
}

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
    useCache?: boolean;
  }>();

  if (body.type !== "text" && body.type !== "url") {
    return c.json({ error: 'type must be "text" or "url"' }, 400);
  }

  try {
    if (body.type === "url") {
      const resolved = await resolveUrlSource(
        d1UrlSourceStore(c.env.DB),
        (url) => fetchSourceDeduped(c.env.FIRECRAWL_API_KEY, url),
        body.url ?? "",
        () => crypto.randomUUID(),
        { useCache: body.useCache !== false },
      );
      return c.json({
        sourceId: resolved.sourceId,
        title: resolved.title,
        markdown: resolved.markdown,
        truncated: resolved.truncated,
        cached: resolved.cached,
      });
    }

    const fetched = normalizeTextSource(body.content ?? "");
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO sources (id, type, title, body_md, url)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, "text", fetched.title, fetched.markdown, null)
      .run();

    return c.json({
      sourceId: id,
      title: fetched.title,
      truncated: fetched.truncated,
      cached: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ingest failed";
    return c.json({ error: message }, 400);
  }
});

app.post(
  "/api/quizzes",
  cloudflareAiRateLimit<AppEnv>((c) => c.env.RATE_LIMITER_QUIZ),
  async (c) => {
    const body = await c.req.json<{
      sourceId?: string;
      count?: number;
      language?: string;
    }>();
    if (!body.sourceId) {
      return c.json({ error: "sourceId is required" }, 400);
    }

    const count = Math.min(
      MAX_QUIZ_COUNT,
      Math.max(MIN_QUIZ_COUNT, Number(body.count) || DEFAULT_QUIZ_COUNT),
    );
    const language = normalizeLanguage(body.language);

    const source = await c.env.DB.prepare(
      `SELECT id, type, title, body_md, url, created_at FROM sources WHERE id = ?`,
    )
      .bind(body.sourceId)
      .first<SourceRow>();

    if (!source) {
      return c.json({ error: "Source not found" }, 404);
    }

    try {
      const questions = await generateMcq(c.env, source.body_md, count, language);
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
        language,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Quiz generation failed";
      const status =
        err instanceof UnusableMaterialError || err instanceof UnusableSourceError
          ? 400
          : 500;
      return c.json({ error: message }, status);
    }
  },
);

app.get("/api/quizzes/:id", async (c) => {
  const quizId = c.req.param("id");
  const quiz = await c.env.DB.prepare(
    `SELECT q.id, q.source_id, q.created_at, s.title as source_title,
            s.url as source_url, s.body_md
     FROM quizzes q JOIN sources s ON s.id = q.source_id
     WHERE q.id = ?`,
  )
    .bind(quizId)
    .first<{
      id: string;
      source_id: string;
      created_at: string;
      source_title: string;
      source_url: string | null;
      body_md: string;
    }>();

  if (!quiz) {
    return c.json({ error: "Quiz not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, stem, options_json, correct_index, explanation, tags_json
     FROM questions WHERE quiz_id = ?`,
  )
    .bind(quizId)
    .all<QuestionRow>();

  const rows = results ?? [];
  const questions: PublicQuestion[] = rows.map((row) => ({
    id: row.id,
    stem: row.stem,
    options: JSON.parse(row.options_json) as string[],
    tags: JSON.parse(row.tags_json) as string[],
  }));
  // Included so the client can grade offline after the first download.
  const answerKey = rows.map((row) => ({
    questionId: row.id,
    correctIndex: row.correct_index,
    explanation: row.explanation,
    tags: JSON.parse(row.tags_json) as string[],
  }));

  return c.json({
    id: quiz.id,
    sourceId: quiz.source_id,
    title: quiz.source_title,
    sourceUrl: quiz.source_url,
    markdown: quiz.body_md,
    truncated: isTruncatedBody(quiz.body_md),
    createdAt: quiz.created_at,
    questions,
    answerKey,
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

/** Open-ended study chat from the home page (SSE stream). */
app.post(
  "/api/chat",
  cloudflareAiRateLimit<AppEnv>((c) => c.env.RATE_LIMITER_CHAT),
  async (c) => {
    const body = await c.req.json<{
      language?: string;
      messages?: Array<{ role?: string; content?: string }>;
    }>();

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: "messages required" }, 400);
    }

    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const m of body.messages.slice(-12)) {
      if (
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim()
      ) {
        history.push({ role: m.role, content: m.content.trim() });
      }
    }
    if (history.length === 0 || history[history.length - 1]?.role !== "user") {
      return c.json({ error: "messages must end with a user turn" }, 400);
    }

    const language = normalizeLanguage(body.language);
    return chatSseResponse(streamAskAnything(c.env, language, history));
  },
);

/** Deeper Q&A about one question after answering (SSE stream). */
app.post(
  "/api/quizzes/:id/chat",
  cloudflareAiRateLimit<AppEnv>((c) => c.env.RATE_LIMITER_CHAT),
  async (c) => {
    const quizId = c.req.param("id");
    const body = await c.req.json<{
      questionId?: string;
      choice?: number;
      language?: string;
      messages?: Array<{ role?: string; content?: string }>;
      context?: unknown;
    }>();

    if (!body.questionId) {
      return c.json({ error: "questionId is required" }, 400);
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: "messages required" }, 400);
    }

    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const m of body.messages.slice(-12)) {
      if (
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim()
      ) {
        history.push({ role: m.role, content: m.content.trim() });
      }
    }
    if (history.length === 0 || history[history.length - 1]?.role !== "user") {
      return c.json({ error: "messages must end with a user turn" }, 400);
    }

    const language = normalizeLanguage(body.language);

    const quiz = await c.env.DB.prepare(
      `SELECT q.id, q.source_id, s.body_md
       FROM quizzes q JOIN sources s ON s.id = q.source_id
       WHERE q.id = ?`,
    )
      .bind(quizId)
      .first<{ id: string; source_id: string; body_md: string }>();

    const question = quiz
      ? await c.env.DB.prepare(
          `SELECT id, stem, options_json, correct_index, explanation, tags_json
           FROM questions WHERE id = ? AND quiz_id = ?`,
        )
          .bind(body.questionId, quizId)
          .first<QuestionRow>()
      : null;

    if (quiz && !question) {
      return c.json({ error: "Question not found" }, 404);
    }

    const ctx = question
      ? {
          stem: question.stem,
          options: JSON.parse(question.options_json) as string[],
          correctIndex: question.correct_index,
          explanation: question.explanation,
          tags: JSON.parse(question.tags_json) as string[],
          material: quiz!.body_md,
          userChoice: typeof body.choice === "number" ? body.choice : undefined,
          language,
        }
      : parseClientQuestionChatContext(
          body.context,
          language,
          typeof body.choice === "number" ? body.choice : undefined,
        );

    if (!ctx) return c.json({ error: "Quiz not found" }, 404);

    return chatSseResponse(streamChatAboutQuestion(c.env, ctx, history));
  },
);

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

  return c.json(checkChoice(toGradeQuestion(q), body.choice));
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
    loaded.questions.map(toGradeQuestion),
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
