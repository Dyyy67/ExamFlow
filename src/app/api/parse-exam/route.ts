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
  answer: z.string().nullable().describe('The correct answer. For MC: A, B, C, or D. For TF: T or F. For matching/word bank: the matching letter/word. For fill blank: the correct word/phrase. For short answer: null.'),
  prompt: z.string().optional().describe('Brief description or snippet of the question prompt'),
  points: z.number().optional().default(1).describe('Points for this question')
});

const AnswerKeySectionSchema = z.object({
  name: z.string().describe('The name of the section, e.g., Part I: Multiple Choice'),
  type: QuestionTypeSchema,
  items: z.array(AnswerKeyItemSchema),
  choices: z.array(z.string()).optional().describe('Array of choices for Multiple Choice or Matching, e.g. ["A", "B", "C", "D"]'),
  word_bank: z.array(z.string()).optional().describe('List of words in the word bank')
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

    const providerName = profile.preferred_provider || 'gemini';
    let apiKey = '';
    let modelInstance;

    // 3. Initialize AI provider based on preference
    const getRandomKey = (rawStr: string | null) => {
      if (!rawStr) return '';
      const keys = rawStr.split(',').map(k => k.trim()).filter(k => k.length > 0);
      return keys.length > 0 ? keys[Math.floor(Math.random() * keys.length)] : '';
    };

    try {
      if (providerName === 'gemini') {
        apiKey = getRandomKey(profile.gemini_key);
        if (!apiKey) {
          return NextResponse.json({ 
            error: 'Gemini API key is not configured. Please add it on the Settings page.' 
          }, { status: 400 });
        }
        const provider = createGoogleGenerativeAI({ apiKey });
        modelInstance = provider('gemini-2.5-flash');
      } else if (providerName === 'mistral') {
        apiKey = getRandomKey(profile.mistral_key);
        if (!apiKey) {
          return NextResponse.json({ 
            error: 'Mistral API key is not configured. Please add it on the Settings page.' 
          }, { status: 400 });
        }
        const provider = createMistral({ apiKey });
        modelInstance = provider('mistral-large-latest');
      } else if (providerName === 'groq') {
        apiKey = getRandomKey(profile.groq_key);
        if (!apiKey) {
          return NextResponse.json({ 
            error: 'Groq API key is not configured. Please add it on the Settings page.' 
          }, { status: 400 });
        }
        const provider = createOpenAI({
          baseURL: 'https://api.groq.com/openai/v1',
          apiKey,
        });
        modelInstance = provider('llama-3.3-70b-versatile');
      } else if (providerName === 'openrouter') {
        apiKey = getRandomKey(profile.openrouter_key);
        if (!apiKey) {
          return NextResponse.json({ 
            error: 'OpenRouter API key is not configured. Please add it on the Settings page.' 
          }, { status: 400 });
        }
        const provider = createOpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey,
        });
        modelInstance = provider('google/gemini-2.5-flash');
      } else {
        return NextResponse.json({ error: `Unsupported provider: ${providerName}` }, { status: 400 });
      }
    } catch (err: any) {
      return NextResponse.json({ error: `Provider initialization failed: ${err.message}` }, { status: 400 });
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
    const systemPrompt = `You are an expert exam parser. Analyze the provided exam text, extract the questions, detect their types, and build the Answer Key.

    Analyze the test content, look for any explicit answer key if provided at the end of the text or marked in the questions (e.g. bolded answers, answers in parentheses like "(A)", or answers followed by an asterisk "*").
    If no answer key is explicitly provided, try to solve the questions to find the correct answer, or leave the answers empty/null if they cannot be determined.
    
    Here are the supported question types:
    - mc: Multiple Choice. Questions with option letters (A, B, C, D). Always populate the choices array (e.g., ["A", "B", "C", "D"]).
    - tf: True or False. Answers must be "T" or "F".
    - matching: Matching Type. Questions mapping prompts to a list of choices (e.g., Column A matching with Column B).
    - word_bank: Word Bank. Questions where answers are selected from a provided list of words. Populate the word_bank array.
    - fill_blank: Fill in the Blank. Correct answers are words or short phrases.
    - short_answer: Short Answer / Essay. Requires manual grading, set the answer field to null.
    
    Crucial rules:
    1. Keep question numbering consecutive across the entire exam (e.g. Section 1 has 1-10, Section 2 starts with 11, NOT 1).
    2. Try to populate the 'prompt' field with a very short snippet/summary of the question text to help the teacher identify it.
    3. If you find an Answer Key section at the end of the document, prioritize its answers.
    4. Ensure the returned JSON strictly adheres to the requested Zod schema.`;

    const { object } = await generateObject({
      model: modelInstance,
      schema: AnswerKeySchema,
      prompt: `Please parse the following exam document:\n\n${documentText}`,
      system: systemPrompt,
    });

    return NextResponse.json(object);

  } catch (error: any) {
    console.error('Error parsing exam document:', error);
    return NextResponse.json({ 
      error: error.message || 'An unexpected error occurred during exam parsing.' 
    }, { status: 500 });
  }
}
