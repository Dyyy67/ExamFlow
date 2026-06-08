import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

export const maxDuration = 30; // Allow up to 30 seconds

const ColumnMappingSchema = z.object({
  name: z.string().describe('The exact header name representing the student\'s name. Must be one of the provided headers, or empty string.'),
  id: z.string().describe('The exact header name representing the student\'s ID/LRN. Must be one of the provided headers, or empty string.'),
  section: z.string().describe('The exact header name representing the class/section/grade. Must be one of the provided headers, or empty string.')
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

    // 3. Check parameters
    const { headers, sampleRows } = await req.json();
    if (!headers || !Array.isArray(headers) || headers.length === 0) {
      return NextResponse.json({ error: 'Headers are required' }, { status: 400 });
    }

    const providerName = profile.preferred_provider || 'gemini';
    let apiKey = '';
    let modelInstance;

    // 4. Initialize AI provider based on preference
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
            error: 'Gemini API key is not configured.' 
          }, { status: 400 });
        }
        const provider = createGoogleGenerativeAI({ apiKey });
        modelInstance = provider('gemini-2.5-flash');
      } else if (providerName === 'mistral') {
        apiKey = getRandomKey(profile.mistral_key);
        if (!apiKey) {
          return NextResponse.json({ 
            error: 'Mistral API key is not configured.' 
          }, { status: 400 });
        }
        const provider = createMistral({ apiKey });
        modelInstance = provider('mistral-large-latest');
      } else if (providerName === 'groq') {
        apiKey = getRandomKey(profile.groq_key);
        if (!apiKey) {
          return NextResponse.json({ 
            error: 'Groq API key is not configured.' 
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
            error: 'OpenRouter API key is not configured.' 
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

    // 5. Generate column mapping using AI
    const systemPrompt = `You are an expert data analyst assistant. Your task is to identify and map the columns of an uploaded file to the three expected target fields:
    - name: The student's name (full name, learner name, student name, etc.)
    - id: The student's unique ID number, student number, LRN, etc.
    - section: The class, grade, section, strand, or level.
    
    You will be given the headers of the file, and a list of sample rows (up to 5) to help you understand the context of the data in each column.
    
    Rules:
    1. The values returned in the JSON MUST be exact matches of one of the provided headers (case-sensitive, with same spaces/characters).
    2. If no column matches one of the expected fields, return an empty string for that field.
    3. Be intelligent: sometimes a column named "LRN" or "No." represents the ID, and sometimes columns like "Grade" or "Room" or "Year & Section" represent the section.
    4. Ensure the returned JSON strictly adheres to the requested Zod schema.`;

    const prompt = `Here are the columns and sample data of the uploaded student spreadsheet:
    
    Headers: ${JSON.stringify(headers)}
    Sample Rows: ${JSON.stringify(sampleRows)}
    
    Identify the column mapping for 'name', 'id', and 'section'.`;

    const { object } = await generateObject({
      model: modelInstance,
      schema: ColumnMappingSchema,
      prompt,
      system: systemPrompt,
    });

    // Validate that returned values are either empty strings or exist in headers
    const result = {
      name: headers.includes(object.name) ? object.name : '',
      id: headers.includes(object.id) ? object.id : '',
      section: headers.includes(object.section) ? object.section : ''
    };

    return NextResponse.json(result);

  } catch (error: any) {
    console.error('Error detecting columns with AI:', error);
    return NextResponse.json({ 
      error: error.message || 'An unexpected error occurred during column detection.' 
    }, { status: 500 });
  }
}
