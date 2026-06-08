import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
// @ts-ignore
import WordExtractor from 'word-extractor';

export const maxDuration = 60; // Allow up to 60 seconds

const StudentSchema = z.object({
  name: z.string().describe('The student\'s full name'),
  student_id_number: z.string().describe('The student\'s unique ID number or LRN. If not specified in the document, use empty string.'),
  class_section: z.string().describe('The class section, grade level, or room. If not specified in the document, use empty string.')
});

const ParseStudentsResponseSchema = z.object({
  students: z.array(StudentSchema)
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

    if (file.name.toLowerCase().endsWith('.pdf')) {
      try {
        const pdfInstance = new PDFParse(new Uint8Array(bytes));
        const pdfData = await pdfInstance.getText();
        documentText = pdfData.text || '';
      } catch (err: any) {
        return NextResponse.json({ error: `Failed to parse PDF document: ${err.message}` }, { status: 500 });
      }
    } else if (file.name.toLowerCase().endsWith('.docx')) {
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
      documentText = new TextDecoder().decode(bytes);
    } else {
      return NextResponse.json({ error: 'Unsupported file format. Please upload a DOCX, DOC, PDF, or TXT file.' }, { status: 400 });
    }

    if (!documentText.trim()) {
      return NextResponse.json({ error: 'The uploaded file is empty or no readable text could be extracted.' }, { status: 400 });
    }

    // 5. Generate structured student list using Vercel AI SDK
    const systemPrompt = `You are an expert data extraction assistant. Your task is to extract a list of students from the provided document text.
    For each student, extract:
    1. name: The student's full name (normalize capitalization to title case, e.g. "JUAN DELA CRUZ" to "Juan Dela Cruz").
    2. student_id_number: The student's ID number, student number, or LRN if present. If not found, use empty string.
    3. class_section: The class section, grade, level, or room if present. If not found, use empty string.
    
    Rules:
    1. Extract every student mentioned in the document. Ignore headers, instructions, or unrelated text.
    2. If the document contains a list or table of students, parse all rows.
    3. Ensure the output strictly conforms to the requested schema.`;

    const { object } = await generateObject({
      model: modelInstance,
      schema: ParseStudentsResponseSchema,
      prompt: `Please extract the student list from the following document:\n\n${documentText}`,
      system: systemPrompt,
    });

    return NextResponse.json(object);

  } catch (error: any) {
    console.error('Error parsing student list document:', error);
    return NextResponse.json({ 
      error: error.message || 'An unexpected error occurred during student document parsing.' 
    }, { status: 500 });
  }
}
