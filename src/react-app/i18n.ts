export type AppLanguage = "en" | "zh";

const STORAGE_KEY = "dropbrain_lang";

export function detectOsLanguage(): AppLanguage {
  if (typeof navigator === "undefined") return "en";
  const candidates = [
    navigator.language,
    ...(navigator.languages ?? []),
  ].filter(Boolean);
  for (const raw of candidates) {
    const lang = raw.toLowerCase();
    if (lang.startsWith("zh")) return "zh";
  }
  return "en";
}

export function loadStoredLanguage(): AppLanguage | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "en" || raw === "zh") return raw;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveLanguage(lang: AppLanguage) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
}

export function resolveInitialLanguage(): AppLanguage {
  return loadStoredLanguage() ?? detectOsLanguage();
}

export function contentLanguageLabel(lang: AppLanguage): string {
  return lang === "zh" ? "中文" : "English";
}

export function chatTruncatedHint(lang: AppLanguage): string {
  return lang === "zh"
    ? "回复被截断了，可以让我继续。"
    : "Reply was cut off. Ask me to continue.";
}

/** Suggested follow-ups match the content language. */
export function chatSuggestions(lang: AppLanguage): string[] {
  if (lang === "zh") {
    return [
      "为什么正确答案是对的？",
      "原文哪里提到这一点？",
      "错误选项常见误区是什么？",
    ];
  }
  return [
    "Why is the correct answer right?",
    "Where does the material say this?",
    "What misconception does the wrong option trap?",
  ];
}

/** Open-ended home chat prompts. */
export function askAnythingSuggestions(lang: AppLanguage): string[] {
  if (lang === "zh") {
    return [
      "用简单的话解释一个概念",
      "帮我做一个 3 题小测",
      "怎样更高效地记忆？",
    ];
  }
  return [
    "Explain a concept in simple terms",
    "Quiz me with 3 quick questions",
    "How can I remember this better?",
  ];
}
