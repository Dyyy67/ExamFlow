-- Exam types enum
CREATE TYPE exam_type AS ENUM ('summative', 'prelim', 'final');

-- Question types enum  
CREATE TYPE question_type AS ENUM ('mc', 'tf', 'matching', 'word_bank', 'fill_blank', 'short_answer');

-- profiles: teacher data linked to auth.users
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  school_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- students: student roster per teacher
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  student_id_number TEXT NOT NULL,
  class_section TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(teacher_id, student_id_number)
);

-- exams: exam definitions with structured answer keys
CREATE TABLE exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  exam_type exam_type NOT NULL DEFAULT 'summative',
  total_items INTEGER NOT NULL DEFAULT 0,
  answer_key JSONB NOT NULL DEFAULT '{}',
  exam_type_metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- submissions: scanned/graded student submissions
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score NUMERIC NOT NULL DEFAULT 0,
  total_scannable_score NUMERIC DEFAULT 0,
  total_manual_score NUMERIC DEFAULT 0,
  item_breakdown JSONB NOT NULL DEFAULT '{}',
  scanned_at TIMESTAMPTZ DEFAULT now(),
  verified BOOLEAN DEFAULT false,
  UNIQUE(exam_id, student_id)
);

-- RLS Policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Teachers can view own students" ON students FOR SELECT USING (auth.uid() = teacher_id);
CREATE POLICY "Teachers can insert own students" ON students FOR INSERT WITH CHECK (auth.uid() = teacher_id);
CREATE POLICY "Teachers can update own students" ON students FOR UPDATE USING (auth.uid() = teacher_id);
CREATE POLICY "Teachers can delete own students" ON students FOR DELETE USING (auth.uid() = teacher_id);

CREATE POLICY "Teachers can view own exams" ON exams FOR SELECT USING (auth.uid() = teacher_id);
CREATE POLICY "Teachers can insert own exams" ON exams FOR INSERT WITH CHECK (auth.uid() = teacher_id);
CREATE POLICY "Teachers can update own exams" ON exams FOR UPDATE USING (auth.uid() = teacher_id);
CREATE POLICY "Teachers can delete own exams" ON exams FOR DELETE USING (auth.uid() = teacher_id);

CREATE POLICY "Teachers can view submissions for their exams" ON submissions FOR SELECT USING (
  EXISTS (SELECT 1 FROM exams WHERE id = submissions.exam_id AND teacher_id = auth.uid())
);
CREATE POLICY "Teachers can insert submissions for their exams" ON submissions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM exams WHERE id = submissions.exam_id AND teacher_id = auth.uid())
);
CREATE POLICY "Teachers can update submissions for their exams" ON submissions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM exams WHERE id = submissions.exam_id AND teacher_id = auth.uid())
);
CREATE POLICY "Teachers can delete submissions for their exams" ON submissions FOR DELETE USING (
  EXISTS (SELECT 1 FROM exams WHERE id = submissions.exam_id AND teacher_id = auth.uid())
);

-- Realtime
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime;
COMMIT;
ALTER PUBLICATION supabase_realtime ADD TABLE submissions;

-- Triggers
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, name, school_name)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'school_name');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_exams_updated_at
  BEFORE UPDATE ON exams
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
