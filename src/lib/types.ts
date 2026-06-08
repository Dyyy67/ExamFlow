export type ExamType = 'summative' | 'prelim' | 'final';
export type QuestionType = 'mc' | 'tf' | 'matching' | 'word_bank' | 'fill_blank' | 'short_answer';

export interface Profile {
  id: string;
  name: string;
  school_name: string;
  gemini_key?: string | null;
  mistral_key?: string | null;
  groq_key?: string | null;
  openrouter_key?: string | null;
  preferred_provider?: 'gemini' | 'mistral' | 'groq' | 'openrouter';
  created_at: string;
}

export interface Student {
  id: string;
  teacher_id: string;
  name: string;
  student_id_number: string;
  class_section: string;
  created_at: string;
}

export interface AnswerKeyItem {
  num: number;
  answer: string | null;
  prompt?: string;
  points?: number;
}

export interface AnswerKeySection {
  name: string;
  type: QuestionType;
  items: AnswerKeyItem[];
  choices?: string[];
  word_bank?: string[];
}

export interface AnswerKey {
  sections: AnswerKeySection[];
}

export interface Exam {
  id: string;
  teacher_id: string;
  title: string;
  exam_type: ExamType;
  total_items: number;
  answer_key: AnswerKey;
  exam_type_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ItemResult {
  marked: string | null;
  correct: string | null;
  is_correct: boolean;
  points_earned: number;
  points_possible: number;
}

export interface Submission {
  id: string;
  exam_id: string;
  student_id: string;
  score: number;
  total_scannable_score: number;
  total_manual_score: number;
  item_breakdown: Record<string, ItemResult>;
  scanned_at: string;
  verified: boolean;
}

export interface ParsedDocument {
  totalItems: number;
  sections: Array<{ name: string; type: QuestionType; count: number }>;
}
