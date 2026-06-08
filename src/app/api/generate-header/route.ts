import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

export const maxDuration = 45; // Allow up to 45 seconds

const GenerateHeaderSchema = z.object({
  html: z.string().describe('The generated HTML string with inline styles matching the image layout, containing the requested placeholder tags.')
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

    // 3. Parse file
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No image file uploaded' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Image = buffer.toString('base64');
    const dataUrl = `data:${file.type};base64,${base64Image}`;

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
          return NextResponse.json({ error: 'Gemini API key is not configured. Please add it on the Settings page.' }, { status: 400 });
        }
        const provider = createGoogleGenerativeAI({ apiKey });
        modelInstance = provider('gemini-2.5-flash');
      } else if (providerName === 'openrouter') {
        apiKey = getRandomKey(profile.openrouter_key);
        if (!apiKey) {
          return NextResponse.json({ error: 'OpenRouter API key is not configured. Please add it on the Settings page.' }, { status: 400 });
        }
        const provider = createOpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey,
        });
        modelInstance = provider('google/gemini-2.5-flash');
      } else if (providerName === 'mistral') {
        apiKey = getRandomKey(profile.mistral_key);
        if (!apiKey) {
          return NextResponse.json({ error: 'Mistral API key is not configured. Please add it on the Settings page.' }, { status: 400 });
        }
        const provider = createMistral({ apiKey });
        modelInstance = provider('pixtral-large-latest');
      } else if (providerName === 'groq') {
        apiKey = getRandomKey(profile.groq_key);
        if (!apiKey) {
          return NextResponse.json({ error: 'Groq API key is not configured. Please add it on the Settings page.' }, { status: 400 });
        }
        const provider = createOpenAI({
          baseURL: 'https://api.groq.com/openai/v1',
          apiKey,
        });
        modelInstance = provider('llama-3.2-11b-vision-preview');
      } else {
        return NextResponse.json({ error: `Unsupported provider: ${providerName}` }, { status: 400 });
      }
    } catch (err: any) {
      return NextResponse.json({ error: `Provider initialization failed: ${err.message}` }, { status: 400 });
    }

    // 5. Generate custom header HTML using AI
    const systemPrompt = `You are an expert front-end designer and OMR answer sheet layout builder. Your task is to analyze the uploaded image of a school header or exam letterhead, and write high-quality HTML and CSS that replicates it.
    
    Rules:
    1. Output ONLY the raw HTML string inside the "html" property. Do NOT include html/body/head boilerplate wrappers.
    2. Use inline styles exclusively for layout, margins, padding, fonts, and borders. Do NOT use tailwind or bootstrap.
    3. Ensure the layout matches the uploaded image in terms of arrangement, text positions, double lines, lines, or font sizes.
    4. Replace text dynamically using these exact double-braces placeholder tags:
       - {{SCHOOL_NAME}} for the name of the school or college
       - {{EXAM_TITLE}} for the exam title
       - {{STUDENT_NAME}} for the student's name value
       - {{STUDENT_SECTION}} for the section name value
       - {{STUDENT_ID}} for the student's ID number or LRN
       - {{DATE}} for the date line or placeholder
    5. Placeholders must be correctly styled to look like form fields. E.g. Name: {{STUDENT_NAME}} (using border-bottom, underline or a styled blank space).
    6. Since this is for printed sheets, use high-contrast black text on white backgrounds, minimal padding/margins (optimized for 210mm width), and simple solid/dotted lines.
    7. If there is a logo/emblem, design a compact inline box with a dashed border representing the logo: <div style="border: 1px dashed #aaa; padding: 4px; display: inline-block; font-size: 10px;">[Logo]</div>.
    8. Do NOT try to include a QR code. The system will handle rendering the QR code separately.
    9. Ensure the returned JSON strictly adheres to the requested Zod schema.`;

    const promptText = `Recreate the layout of the exam header shown in the uploaded image. Make sure it incorporates the placeholders: {{SCHOOL_NAME}}, {{EXAM_TITLE}}, {{STUDENT_NAME}}, {{STUDENT_SECTION}}, {{STUDENT_ID}}, and {{DATE}}.`;

    const { object } = await generateObject({
      model: modelInstance,
      schema: GenerateHeaderSchema,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            { type: 'image', image: dataUrl }
          ]
        }
      ],
      system: systemPrompt,
    });

    return NextResponse.json(object);

  } catch (error: any) {
    console.error('Error generating custom header:', error);
    return NextResponse.json({ 
      error: error.message || 'An unexpected error occurred during custom header generation.' 
    }, { status: 500 });
  }
}
