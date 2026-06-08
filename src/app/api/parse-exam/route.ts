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
  'short_answer'
]);

const AnswerKeyItemSchema = z.object({
  num: z.number().describe('The question number'),
  answer: z.string().nullable().optional().describe('The correct answer (or null for short answer)'),
  prompt: z.string().optional().describe('Brief snippet of the question'),
  points: z.number().optional().default(1).describe('Points for this question')
});

const AnswerKeySectionSchema = z.object({
  name: z.string().describe('Section name (e.g., Part I: Multiple Choice)'),
  type: QuestionTypeSchema,
  items: z.array(AnswerKeyItemSchema),
  choices: z.array(z.string()).optional().describe('Array of choices for MC/Matching'),
  word_bank: z.array(z.string()).optional().describe('List of words for word bank')
});

const AnswerKeySchema = z.object({
  sections: z.array(AnswerKeySectionSchema)
});

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
    const systemPrompt = `You are an expert exam parser. Your task is to parse the exam document and extract a structured answer key.

For each section or question group, identify:
1. The section name (e.g., "Part 1: Multiple Choice")
2. The question type (mc, tf, matching, word_bank, fill_blank, or short_answer)
3. Each question with: number, answer, prompt (brief snippet), and points
4. For MC/Matching questions, include the choices array
5. For word_bank questions, include the word_bank array

IMPORTANT RULES:
- Question numbers must be consecutive across all sections
- Always try to find the correct answers from an answer key if present in the document
- For MC questions with options A, B, C, D - the answer should be the letter
- For True/False - the answer should be "T" or "F"
- For fill-in-blank questions - the answer should be the word or phrase
- For short answer/essay - set answer to null
- Always include a prompt field with a brief snippet of the question

Return ONLY valid JSON that matches the structure requested.`;

    const truncatedText = documentText.length > 12000 
      ? documentText.substring(0, 12000) + '\n... [document truncated for processing]'
      : documentText;

    const { object } = await generateObject({
      model: modelInstance,
      schema: AnswerKeySchema,
      prompt: `Parse this exam document and extract the answer key structure:\n\n${truncatedText}`,
      system: systemPrompt,
      temperature: 0.2,
    });

    if (!object.sections || !Array.isArray(object.sections) || object.sections.length === 0) {
      throw new Error('No sections were extracted from the document. Please ensure the file contains valid exam content.');
    }

    return NextResponse.json(object);

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
