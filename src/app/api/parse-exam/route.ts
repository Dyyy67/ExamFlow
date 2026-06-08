import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import mammoth from 'mammoth';
// @ts-ignore
import WordExtractor from 'word-extractor';

export const maxDuration = 60; // Allow up to 60 seconds on Vercel

const QuestionTypeSchema = z.enum([
  'mc',
  'tf',
  'matching',
  'word_bank',
  'fill_blank',
  'short_answer',
  'essay'
]);

const AnswerKeyItemSchema = z.object({
  num: z.number().describe('Question number'),
  answer: z.string().nullable().optional().describe('Correct answer'),
  prompt: z.string().describe('Question text or description'),
  points: z.number().optional().default(1).describe('Points awarded')
}).strict();

const AnswerKeySectionSchema = z.object({
  name: z.string().describe('Section name'),
  type: QuestionTypeSchema.describe('Question type'),
  items: z.array(AnswerKeyItemSchema).describe('Questions in this section'),
  choices: z.array(z.string()).optional().describe('Answer choices for MC'),
  word_bank: z.array(z.string()).optional().describe('Word bank options')
}).strict();

const AnswerKeySchema = z.object({
  exam_title: z.string().optional().describe('Exam or test name'),
  exam_type: z.string().optional().describe('Type of exam (midterm, final, quiz, etc)'),
  exam_language: z.string().optional().describe('Language of the exam (English, Spanish, French, etc.)'),
  exam_subject: z.string().optional().describe('Academic subject (Mathematics, Biology, History, etc.)'),
  total_questions: z.number().optional().describe('Total number of questions'),
  sections: z.array(AnswerKeySectionSchema).describe('Question sections')
}).strict();

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch user's API keys and preference from DB
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('gemini_key, mistral_key, groq_key, openrouter_key, preferred_provider')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ 
        error: 'Failed to retrieve profile. Please configure API keys in Settings first.' 
      }, { status: 400 });
    }

    // 3. Initialize AI provider based on preference
    const getRandomKey = (rawStr: string | null) => {
      if (!rawStr) return '';
      const keys = rawStr.split(',').map(k => k.trim()).filter(k => k.length > 0);
      return keys.length > 0 ? keys[Math.floor(Math.random() * keys.length)] : '';
    };

    const providerName = profile.preferred_provider || 'gemini';
    let apiKey = '';
    let modelInstance;
    
    try {
      if (providerName === 'gemini') {
        apiKey = getRandomKey(profile.gemini_key);
        if (!apiKey) {
          throw new Error('Gemini API key is not configured. Please add it on the Settings page.');
        }
        const provider = createGoogleGenerativeAI({ apiKey });
        modelInstance = provider('gemini-2.5-flash');
      } else if (providerName === 'mistral') {
        apiKey = getRandomKey(profile.mistral_key);
        if (!apiKey) {
          throw new Error('Mistral API key is not configured. Please add it on the Settings page.');
        }
        const provider = createMistral({ apiKey });
        modelInstance = provider('mistral-large-latest');
      } else if (providerName === 'groq') {
        apiKey = getRandomKey(profile.groq_key);
        if (!apiKey) {
          throw new Error('Groq API key is not configured. Please add it on the Settings page.');
        }
        const provider = createOpenAI({
          baseURL: 'https://api.groq.com/openai/v1',
          apiKey,
        });
        modelInstance = provider('llama-3.3-70b-versatile');
      } else if (providerName === 'openrouter') {
        apiKey = getRandomKey(profile.openrouter_key);
        if (!apiKey) {
          throw new Error('OpenRouter API key is not configured. Please add it on the Settings page.');
        }
        const provider = createOpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey,
        });
        modelInstance = provider('google/gemini-2.5-flash');
      } else {
        throw new Error(`Unsupported provider: ${providerName}`);
      }
    } catch (err: any) {
      throw new Error(`Provider initialization failed: ${err.message}`);
    }

    // 4. Extract text from uploaded document
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    let documentText = '';
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (file.name.toLowerCase().endsWith('.docx')) {
      try {
        const mammothResult = await mammoth.extractRawText({ buffer });
        documentText = mammothResult.value || '';
      } catch (err: any) {
        // Fallback to word-extractor if mammoth fails
        try {
          const extractor = new WordExtractor();
          const doc = await extractor.extract(buffer);
          documentText = doc.getBody() || '';
        } catch (innerErr: any) {
          // Double fallback: Check if it's actually a renamed plain text/HTML/RTF file
          try {
            const textContent = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            if (textContent.trim().length > 0) {
              documentText = textContent;
            } else {
              throw err;
            }
          } catch (fallbackErr) {
            return NextResponse.json({ error: `Failed to parse DOCX document: ${err.message}` }, { status: 500 });
          }
        }
      }
    } else if (file.name.toLowerCase().endsWith('.doc')) {
      try {
        const extractor = new WordExtractor();
        const doc = await extractor.extract(buffer);
        documentText = doc.getBody() || '';
      } catch (err: any) {
        // Fallback: Check if it's actually a renamed plain text, RTF, or HTML file disguised as .doc
        try {
          const textContent = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
          if (textContent.trim().length > 0) {
            documentText = textContent;
          } else {
            throw err;
          }
        } catch (fallbackErr) {
          return NextResponse.json({ 
            error: `Failed to parse legacy DOC document: The file format is unrecognized or corrupted. Please make sure it is a valid Word document, or convert/save it as PDF first. (Error: ${err.message})` 
          }, { status: 500 });
        }
      }
    } else if (file.name.toLowerCase().endsWith('.txt')) {
      documentText = file.name.endsWith('.txt') ? new TextDecoder().decode(bytes) : '';
    } else {
      return NextResponse.json({ error: 'Unsupported file format. Please upload a DOCX, DOC, or TXT file.' }, { status: 400 });
    }

    if (!documentText.trim()) {
      return NextResponse.json({ error: 'The uploaded file is empty or no readable text could be extracted.' }, { status: 400 });
    }

    // 5. Generate structured answer key using Vercel AI SDK
    const systemPrompt = `You are an EXPERT exam parser with STRICT accuracy requirements. Your analysis must be PRECISE and VERIFIABLE.

MANDATORY DETECTION TASKS:
1. LANGUAGE DETECTION: Identify the primary language of the exam (English, Spanish, French, etc.) and set exam_language field accordingly
2. SUBJECT DETECTION: Identify the academic subject (Mathematics, Biology, History, Chemistry, Physics, Literature, etc.) based on content, terminology, and question types
3. TEST TYPE DETECTION: Classify as (midterm, final, quiz, practice test, homework, standardized test, entrance exam, certification test)
4. QUESTION TYPE CLASSIFICATION: For each question, accurately identify the type from: mc, tf, matching, word_bank, fill_blank, short_answer, essay
5. ANSWER KEY EXTRACTION: Extract ALL correct answers with 100% accuracy from the document

STRICT RULES - NO EXCEPTIONS:
- Question numbers MUST be consecutive integers starting from 1 (no gaps, no duplicates)
- Every question MUST have a non-empty 'prompt' field containing the FULL question text
- For MC questions: answer must be exactly one letter (A, B, C, D, or E if present)
- For TF questions: answer must be exactly "T" or "F" (uppercase only)
- For matching questions: include ALL options in the 'choices' array in the order they appear
- For word_bank questions: include ALL words in the 'word_bank' array exactly as provided
- For fill_blank: answer is the word/phrase that fills the blank (if provided in answer key)
- For short_answer/essay: answer must be null (these require manual grading)
- Points must be a positive integer (default 1 if not specified)
- If an answer key is present in the document, YOU MUST USE IT - do not attempt to solve questions
- If no answer key is present, leave answer fields as null and DO NOT guess or attempt to solve
- Exam title: extract from document header or title (if unclear, use null)
- Exam type: infer from context clues (midterm, final, chapter test, unit quiz, etc.)
- Subject: be specific (e.g., "Algebra II" not just "Math", "AP Biology" not just "Biology")

OUTPUT FORMAT:
Return ONLY a valid JSON object matching the schema. Do NOT include:
- Explanatory text before or after JSON
- Markdown code blocks
- Additional fields not in the schema
- Comments or notes

If you cannot determine an answer with certainty, use null. Accuracy over completeness.`

    const truncatedText = documentText.length > 15000 
      ? documentText.substring(0, 15000) + '\n... [document truncated]'
      : documentText;

    let result;
    try {
      const { object } = await generateObject({
        model: modelInstance,
        schema: AnswerKeySchema,
        prompt: `Parse this exam document and extract the answer key structure:\n\n${truncatedText}`,
        system: systemPrompt,
        temperature: 0.3,
      });
      result = object;
    } catch (schemaError: any) {
      // If strict schema fails, try with more lenient parsing
      console.error('Initial schema parsing failed:', schemaError.message);
      
      // Create a more lenient schema as fallback
      const LenientAnswerKeySchema = z.object({
        exam_title: z.string().optional(),
        exam_type: z.string().optional(),
        total_questions: z.number().optional(),
        sections: z.array(z.object({
          name: z.string(),
          type: z.string(),
          items: z.array(z.object({
            num: z.number(),
            answer: z.any().optional(),
            prompt: z.string().optional(),
            points: z.number().optional()
          })).optional(),
          choices: z.array(z.any()).optional(),
          word_bank: z.array(z.any()).optional()
        })).optional()
      });

      const { object: lenientObject } = await generateObject({
        model: modelInstance,
        schema: LenientAnswerKeySchema,
        prompt: `Parse this exam document and extract questions and answers:\n\n${truncatedText}`,
        system: systemPrompt,
        temperature: 0.3,
      });
      result = lenientObject;
    }

    if (!result.sections || !Array.isArray(result.sections) || result.sections.length === 0) {
      throw new Error('No sections were extracted from the document. Please ensure the file contains valid exam content.');
    }

    // Return only the sections - preserve exam metadata on the frontend
    return NextResponse.json({
      sections: result.sections,
      total_questions: result.sections.reduce((sum: number, sec: any) => sum + (sec.items?.length || 0), 0)
    });

  } catch (error: any) {
    console.error('Error parsing exam document:', error);
    // Ensure we always return JSON, never HTML error pages
    const errorMessage = error?.message || 'An unexpected error occurred during exam parsing.';
    const statusCode = error?.status || 500;
    return NextResponse.json({ 
      error: errorMessage,
      details: error?.cause?.message || undefined
    }, { status: statusCode, headers: { 'Content-Type': 'application/json' } });
  }
}
