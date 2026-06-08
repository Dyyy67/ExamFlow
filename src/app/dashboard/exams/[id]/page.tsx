'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Save, Printer, UploadCloud, Trash2, Plus, AlertTriangle, FileText } from 'lucide-react';
import Link from 'next/link';
import { Button, Input, Card, Modal, Select, Badge, useToast } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { Exam, AnswerKey, AnswerKeySection, AnswerKeyItem, QuestionType, Student } from '@/lib/types';
import PrintButton from '@/components/answer-sheet/PrintButton';
// We'll import parseDocument when the scanner-sheet-builder finishes building it.
// For now, we stub it if it doesn't exist, or just use a mock locally in handleUpload.

export default function ExamDetailPage() {
  const params = useParams();
  const examId = params.id as string;
  const { user } = useSupabaseAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const supabase = createClient();
  
  const [exam, setExam] = useState<Exam | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  
  // Local state for the answer key builder
  const [answerKey, setAnswerKey] = useState<AnswerKey>({ sections: [] });

  useEffect(() => {
    if (user && examId) {
      loadExamAndStudents();
    }
  }, [user, examId]);

  // Prevent accidental loss of progress on page refresh/leave
  useEffect(() => {
    if (!exam) return;
    
    // Normalize and compare saved key vs local key state
    const hasUnsavedChanges = JSON.stringify(exam.answer_key) !== JSON.stringify(answerKey);
    
    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'You have unsaved changes on your answer key. Are you sure you want to leave?';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [exam, answerKey]);

  async function loadExamAndStudents() {
    setLoading(true);
    const [examRes, studentsRes] = await Promise.all([
      supabase.from('exams').select('*').eq('id', examId).single(),
      supabase.from('students').select('*').eq('teacher_id', user?.id).order('name')
    ]);

    if (examRes.error) {
      addToast('error', 'Exam not found');
      router.push('/dashboard/exams');
      return;
    }

    setExam(examRes.data as Exam);
    setAnswerKey(examRes.data.answer_key || { sections: [] });
    setStudents(studentsRes.data as Student[]);
    setLoading(false);
  }

  const handleSaveExam = async () => {
    setIsSaving(true);
    // Recalculate total items
    let total = 0;
    answerKey.sections.forEach(sec => total += sec.items.length);

    const { error } = await supabase
      .from('exams')
      .update({
        answer_key: answerKey,
        total_items: total
      })
      .eq('id', examId);

    setIsSaving(false);
    if (error) {
      addToast('error', error.message);
    } else {
      addToast('success', 'Answer key saved successfully');
      setExam(prev => prev ? { ...prev, answer_key: answerKey, total_items: total } : null);
    }
  };

  const handleDelete = async () => {
    setIsSaving(true);
    const { error } = await supabase.from('exams').delete().eq('id', examId);
    if (error) {
      addToast('error', error.message);
      setIsSaving(false);
    } else {
      router.push('/dashboard/exams');
    }
  };

  // Section Management
  const addSection = () => {
    setAnswerKey(prev => ({
      sections: [
        ...prev.sections, 
        { name: `Part ${prev.sections.length + 1}`, type: 'mc', items: [], choices: [], word_bank: [] }
      ]
    }));
  };

  const removeSection = (index: number) => {
    setAnswerKey(prev => {
      const newSections = [...prev.sections];
      newSections.splice(index, 1);
      return { sections: newSections };
    });
  };

  const updateSection = (index: number, updates: Partial<AnswerKeySection>) => {
    setAnswerKey(prev => {
      const newSections = [...prev.sections];
      newSections[index] = { ...newSections[index], ...updates };
      return { sections: newSections };
    });
  };

  // Item Management
  const addItem = (sectionIndex: number) => {
    setAnswerKey(prev => {
      const newSections = [...prev.sections];
      const section = newSections[sectionIndex];
      // Auto-increment question number
      const lastNum = section.items.length > 0 ? section.items[section.items.length - 1].num : 0;
      let highestNumBeforeThisSection = 0;
      for(let i=0; i<sectionIndex; i++) {
         const s = newSections[i];
         if(s.items.length > 0) highestNumBeforeThisSection = Math.max(highestNumBeforeThisSection, s.items[s.items.length-1].num);
      }
      const newNum = lastNum > 0 ? lastNum + 1 : highestNumBeforeThisSection + 1;
      
      section.items.push({ num: newNum, answer: '', points: 1 });
      return { sections: newSections };
    });
  };

  const updateItem = (sectionIndex: number, itemIndex: number, updates: Partial<AnswerKeyItem>) => {
    setAnswerKey(prev => {
      const newSections = [...prev.sections];
      newSections[sectionIndex].items[itemIndex] = { ...newSections[sectionIndex].items[itemIndex], ...updates };
      return { sections: newSections };
    });
  };

  const removeItem = (sectionIndex: number, itemIndex: number) => {
    setAnswerKey(prev => {
      const newSections = [...prev.sections];
      newSections[sectionIndex].items.splice(itemIndex, 1);
      return { sections: newSections };
    });
  };

  // File Upload handler with API parser call
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsParsing(true);
    addToast('info', 'AI is parsing your exam document. This can take up to a minute...');
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/parse-exam', {
        method: 'POST',
        body: formData,
      });
      
      // Check if response is valid JSON before parsing
      const contentType = response.headers.get('content-type');
      let result;
      try {
        result = await response.json();
      } catch (parseError) {
        // If JSON parsing fails, the server likely returned an error page (HTML)
        const text = await response.text();
        throw new Error(`Server returned an invalid response. Status: ${response.status}. ${text.substring(0, 200)}`);
      }
      
      if (!response.ok) {
        // If the keys are not configured, display a link to Settings in the Toast
        if (result.error && (result.error.includes('key') || result.error.includes('configured') || result.error.includes('Settings'))) {
          addToast(
            'error',
            <div className="flex flex-col gap-1">
              <span>{result.error}</span>
              <Link href="/dashboard/settings" className="underline font-bold text-blue-300 hover:text-blue-100 flex items-center gap-1">
                Go to Settings &rarr;
              </Link>
            </div>,
            7000
          );
        } else {
          throw new Error(result.error || 'Failed to parse document');
        }
        return;
      }
      
      // Merge parsed sections with existing exam metadata
      const mergedAnswerKey = {
        ...exam.answer_key,
        sections: result.sections || [],
        total_questions: result.total_questions || 0
      };
      
      setAnswerKey(mergedAnswerKey);
      addToast('success', 'Document parsed and answer key populated successfully!');
      
      // Auto-save the parsed answer key to database
      setIsSaving(true);
      let total = 0;
      if (mergedAnswerKey.sections && Array.isArray(mergedAnswerKey.sections)) {
        mergedAnswerKey.sections.forEach((sec: AnswerKeySection) => total += sec.items?.length || 0);
      }

      const { error: saveError } = await supabase
        .from('exams')
        .update({
          answer_key: mergedAnswerKey,
          total_items: total
        })
        .eq('id', examId);

      setIsSaving(false);
      if (saveError) {
        addToast('info', 'Parsed data loaded but auto-save failed. Please click Save to preserve changes.');
      } else {
        addToast('success', 'Answer key auto-saved!');
        // Update exam in state
        setExam(prev => prev ? { ...prev, answer_key: mergedAnswerKey, total_items: total } : null);
      }
    } catch (err: any) {
      addToast('error', err.message || 'Failed to parse document');
    } finally {
      setIsParsing(false);
      // Clear input so same file can be uploaded again
      e.target.value = '';
    }
  };

  if (loading) return <div className="animate-pulse p-8"><div className="h-8 w-64 bg-white/10 rounded mb-8"></div></div>;
  if (!exam) return null;

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <Link href="/dashboard/exams" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
        <ArrowLeft size={16} /> Back to Exams
      </Link>

      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold text-white">{exam.title}</h1>
            <Badge variant={exam.exam_type === 'final' ? 'error' : 'info'} className="capitalize">{exam.exam_type}</Badge>
          </div>
          <p className="text-gray-400">Total Items: {exam.total_items} • Created {new Date(exam.created_at).toLocaleDateString()}</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <Button variant="danger" onClick={() => setIsDeleteModalOpen(true)} className="px-3">
            <Trash2 size={18} />
          </Button>
          <Button variant="secondary" onClick={handleSaveExam} loading={isSaving} className="gap-2 flex-1 md:flex-none">
            <Save size={18} /> Save Key
          </Button>
          {students.length > 0 && answerKey.sections.length > 0 && (
             <PrintButton 
               students={students} 
               exam={{...exam, answer_key: answerKey}} 
               schoolName={user?.user_metadata?.school_name || "SCHOOL"} 
               onUpdateExam={(updatedExam) => setExam(updatedExam)}
             />
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Answer Key Builder */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-white">Answer Key</h2>
            <Button variant="ghost" onClick={addSection} size="sm" className="gap-1 text-blue-400">
              <Plus size={16} /> Add Section
            </Button>
          </div>

          {answerKey.sections.length === 0 ? (
            <Card padding="lg" className="text-center border-dashed border-2 border-white/10">
              <FileText size={48} className="mx-auto mb-4 text-gray-500" />
              <p className="text-gray-400 mb-4">No sections added yet.</p>
              <div className="flex justify-center gap-4">
                <Button onClick={addSection}>Add Manual Section</Button>
                <div className="relative">
                  <input type="file" accept=".docx,.doc,.pdf,.txt" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={handleFileUpload} disabled={isParsing} />
                  <Button variant="secondary" className="gap-2 pointer-events-none" loading={isParsing}><UploadCloud size={16}/> Upload Document</Button>
                </div>
              </div>
            </Card>
          ) : (
            <div className="space-y-6">
              {answerKey.sections.map((section, sIdx) => (
                <Card key={sIdx} className="overflow-visible border-blue-500/20">
                  <div className="flex flex-col sm:flex-row gap-4 mb-6">
                    <Input 
                      value={section.name} 
                      onChange={e => updateSection(sIdx, { name: e.target.value })} 
                      placeholder="Section Name (e.g. Part I)"
                      className="flex-1"
                    />
                    <Select 
                      options={[
                        {value: 'mc', label: 'Multiple Choice (A-D)'},
                        {value: 'tf', label: 'True / False'},
                        {value: 'matching', label: 'Matching Type'},
                        {value: 'word_bank', label: 'Word Bank'},
                        {value: 'fill_blank', label: 'Fill in the Blank'},
                        {value: 'short_answer', label: 'Short Answer'}
                      ]}
                      value={section.type}
                      onChange={e => updateSection(sIdx, { type: e.target.value as QuestionType })}
                      className="w-full sm:w-48"
                    />
                    <button onClick={() => removeSection(sIdx)} className="mt-1 sm:mt-0 p-2 text-gray-500 hover:text-red-400 transition-colors self-start sm:self-center">
                      <Trash2 size={20} />
                    </button>
                  </div>

                  {/* Section specific editors (Choices/Word bank) */}
                  {(section.type === 'matching' || section.type === 'word_bank') && (
                    <div className="mb-6 p-4 bg-navy-900/50 rounded-xl border border-white/5">
                      <label className="text-sm font-medium text-gray-300 block mb-2">
                        {section.type === 'matching' ? 'Matching Choices (Comma separated)' : 'Word Bank Words (Comma separated)'}
                      </label>
                      <Input 
                        value={(section.choices || section.word_bank || []).join(', ')}
                        onChange={e => {
                          const arr = e.target.value.split(',').map(s => s.trim()).filter(s => s.length > 0);
                          updateSection(sIdx, section.type === 'matching' ? { choices: arr } : { word_bank: arr });
                        }}
                        placeholder="e.g. Photosynthesis, Mitosis, Osmosis"
                      />
                    </div>
                  )}

                  {/* Items List */}
                  <div className="space-y-2">
                    {section.items.map((item, iIdx) => (
                      <div key={iIdx} className="flex items-center gap-3 bg-white/5 p-2 rounded-lg border border-white/5">
                        <Input 
                          type="number" 
                          value={item.num} 
                          onChange={e => updateItem(sIdx, iIdx, { num: parseInt(e.target.value) || 0 })}
                          className="w-20 !py-1.5"
                        />
                        <span className="text-gray-500">.</span>
                        
                        {/* Answer Input based on type */}
                        {section.type === 'mc' && (
                          <div className="flex gap-2">
                            {['A','B','C','D'].map(opt => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => updateItem(sIdx, iIdx, { answer: opt })}
                                className={`w-8 h-8 rounded-full border-2 text-sm font-bold flex items-center justify-center transition-all
                                  ${item.answer === opt ? 'bg-blue-500 border-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'border-gray-600 text-gray-400 hover:border-gray-400'}`}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}

                        {section.type === 'tf' && (
                          <div className="flex gap-2">
                            {['T','F'].map(opt => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => updateItem(sIdx, iIdx, { answer: opt })}
                                className={`w-8 h-8 rounded-full border-2 text-sm font-bold flex items-center justify-center transition-all
                                  ${item.answer === opt ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-600 text-gray-400 hover:border-gray-400'}`}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}

                        {(section.type === 'matching' || section.type === 'word_bank') && (
                          <Input 
                            value={item.answer || ''} 
                            onChange={e => updateItem(sIdx, iIdx, { answer: e.target.value.toUpperCase().slice(0, 1) })}
                            placeholder="Letter (A-Z)"
                            className="w-24 !py-1.5 uppercase"
                            maxLength={1}
                          />
                        )}

                        {section.type === 'fill_blank' && (
                          <Input 
                            value={item.answer || ''} 
                            onChange={e => updateItem(sIdx, iIdx, { answer: e.target.value })}
                            placeholder="Correct word/phrase"
                            className="flex-1 !py-1.5"
                          />
                        )}

                        {section.type === 'short_answer' && (
                          <span className="text-sm text-gray-500 flex-1 italic">Manual grading required</span>
                        )}

                        {/* Points (for non-MC/TF) */}
                        {(section.type === 'fill_blank' || section.type === 'short_answer') && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">Pts:</span>
                            <Input 
                              type="number" 
                              value={item.points || 1} 
                              onChange={e => updateItem(sIdx, iIdx, { points: parseInt(e.target.value) || 1 })}
                              className="w-16 !py-1.5"
                            />
                          </div>
                        )}

                        <button onClick={() => removeItem(sIdx, iIdx)} className="p-1 text-gray-500 hover:text-red-400 transition-colors ml-auto">
                          <XIcon />
                        </button>
                      </div>
                    ))}
                    <Button type="button" variant="ghost" size="sm" onClick={() => addItem(sIdx)} className="w-full mt-2 border border-dashed border-white/10">
                      <Plus size={16} className="mr-2" /> Add Question
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Helpers & Submissions */}
        <div className="space-y-6">
          <Card padding="md" className="bg-gradient-to-b from-blue-900/20 to-transparent border-blue-500/20">
            <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
              <UploadCloud size={18} className="text-blue-400"/> AI Parsing
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Upload your test document to automatically extract questions and build the structure.
            </p>
            <div className="relative">
              <input type="file" accept=".docx,.doc,.pdf,.txt" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={handleFileUpload} disabled={isParsing} />
              <Button variant="secondary" className="w-full pointer-events-none" loading={isParsing}>Select File</Button>
            </div>
          </Card>

          <Card padding="none">
            <div className="p-4 border-b border-white/10">
              <h3 className="font-semibold text-white">Submissions Tracker</h3>
            </div>
            <div className="p-4 text-center text-sm text-gray-500">
              <p>Scores will appear here once you start scanning answer sheets.</p>
              <Link href="/scanner">
                <Button variant="ghost" size="sm" className="mt-4 w-full">Open Scanner</Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>

      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Delete Exam">
        <p className="text-gray-300 mb-6">Are you sure you want to delete this exam and all its submissions? This action cannot be undone.</p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setIsDeleteModalOpen(false)}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} loading={isSaving}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}

// Simple X icon for remove item
const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
);
