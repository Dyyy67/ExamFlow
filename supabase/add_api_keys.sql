-- Add API Key fields to the profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS gemini_key TEXT,
ADD COLUMN IF NOT EXISTS mistral_key TEXT,
ADD COLUMN IF NOT EXISTS groq_key TEXT,
ADD COLUMN IF NOT EXISTS openrouter_key TEXT,
ADD COLUMN IF NOT EXISTS preferred_provider TEXT DEFAULT 'gemini';

-- Force Supabase API (PostgREST) to reload schema cache immediately
NOTIFY pgrst, 'reload schema';
