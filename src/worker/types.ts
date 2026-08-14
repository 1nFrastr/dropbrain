export type SourceType = "text" | "url";

export interface SourceRow {
  id: string;
  type: SourceType;
  title: string;
  body_md: string;
  url: string | null;
  created_at: string;
}

export interface QuizRow {
  id: string;
  source_id: string;
  created_at: string;
}

export interface QuestionRow {
  id: string;
  quiz_id: string;
  stem: string;
  options_json: string;
  correct_index: number;
  explanation: string;
  tags_json: string;
}

export interface GeneratedQuestion {
  stem: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  tags: string[];
}

export interface PublicQuestion {
  id: string;
  stem: string;
  options: string[];
  tags: string[];
}

export const DEFAULT_QUIZ_COUNT = 8;
export const MIN_QUIZ_COUNT = 3;
export const MAX_QUIZ_COUNT = 20;
/** How long URL page fetches stay reusable in D1 before re-scraping. */
export const SOURCE_URL_CACHE_TTL_DAYS = 10;

export {
  MAX_BODY_CHARS,
  MAX_CHAT_MATERIAL_CHARS,
  MAX_CHAT_MESSAGE_CHARS,
} from "../shared/limits";
