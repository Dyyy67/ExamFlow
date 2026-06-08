'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, FileText, Calendar, Clock, ChevronRight } from 'lucide-react';
import { Button, Input, Card, Modal, Select, Badge, useToast } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { Exam, ExamType } from '@/lib/types';

export default function ExamsPage() {
  const { user } = useSupabaseAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const supabase = createClient();
  
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newExam, setNewExam] = useState<{ title: string; type: ExamType }>({ title: '', type: 'summative' });

  useEffect(() => {
    if (user) loadExams();
  }, [user]);

  async function loadExams() {
    setLoading(true);
    const { data, error } = await supabase
      .from('exams')
      .select('*')
      .eq('teacher_id', user?.id)
      .order('created_at', { ascending: false });
      
    if (error) {
      addToast('error', 'Failed to load exams');
    } else {
      setExams(data as Exam[]);
    }
    setLoading(false);
  }

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSubmitting(true);

    const { data, error } = await supabase
      .from('exams')
      .insert({
        teacher_id: user.id,
        title: newExam.title,
        exam_type: newExam.type,
        total_items: 0,
        answer_key: { sections: [] }
      })
      .select()
      .single();

    setIsSubmitting(false);

    if (error) {
      addToast('error', error.message);
    } else if (data) {
      addToast('success', 'Exam created successfully');
      router.push(`/dashboard/exams/${data.id}`);
    }
  };

  const getBadgeType = (type: string) => {
    if (type === 'final') return 'error';
    if (type === 'prelim') return 'warning';
    return 'info';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Exams</h1>
          <p className="text-gray-400 text-sm">Create and manage your test materials</p>
        </div>
        <Button onClick={() => setIsCreateModalOpen(true)} className="gap-2">
          <Plus size={16} /> Create Exam
        </Button>
      </header>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse h-48">
              <div className="w-3/4 h-6 bg-white/10 rounded mb-4" />
              <div className="w-1/4 h-5 bg-white/10 rounded mb-8" />
              <div className="flex gap-4">
                <div className="w-16 h-4 bg-white/10 rounded" />
                <div className="w-24 h-4 bg-white/10 rounded" />
              </div>
            </Card>
          ))}
        </div>
      ) : exams.length === 0 ? (
        <Card padding="lg" className="text-center">
          <FileText size={48} className="mx-auto mb-4 opacity-20" />
          <h3 className="text-xl font-semibold mb-2 text-white">No exams yet</h3>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">
            Create your first exam to build an answer key and start generating printable answer sheets.
          </p>
          <Button onClick={() => setIsCreateModalOpen(true)}>Create First Exam</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {exams.map((exam) => (
            <Link key={exam.id} href={`/dashboard/exams/${exam.id}`}>
              <Card className="hover:border-blue-500/50 hover:shadow-[0_0_20px_rgba(59,130,246,0.15)] transition-all cursor-pointer h-full flex flex-col group relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-600 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left" />
                
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-semibold text-white line-clamp-2 leading-tight pr-4">
                      {exam.title}
                    </h3>
                  </div>
                  <Badge variant={getBadgeType(exam.exam_type)} className="mb-6 capitalize">
                    {exam.exam_type} Exam
                  </Badge>
                  
                  <div className="flex flex-col gap-2 mt-auto">
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <Clock size={14} />
                      <span>{exam.total_items} items total</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <Calendar size={14} />
                      <span>{new Date(exam.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                
                <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-blue-400 text-sm font-medium group-hover:text-blue-300">
                  Manage Exam
                  <ChevronRight size={16} className="transform group-hover:translate-x-1 transition-transform" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal 
        isOpen={isCreateModalOpen} 
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Exam"
      >
        <form onSubmit={handleCreateExam} className="space-y-4">
          <Input 
            label="Exam Title" 
            placeholder="e.g. Midterm Examination in Biology" 
            required 
            value={newExam.title}
            onChange={e => setNewExam({...newExam, title: e.target.value})}
          />
          <Select
            label="Exam Type"
            options={[
              { value: 'summative', label: 'Summative Test' },
              { value: 'prelim', label: 'Prelim Exam' },
              { value: 'final', label: 'Final Exam' }
            ]}
            value={newExam.type}
            onChange={e => setNewExam({...newExam, type: e.target.value as ExamType})}
            required
          />
          
          <div className="p-4 rounded-xl border border-white/10 bg-white/5 mt-6 mb-2">
            <h4 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
              <FileText size={16} /> Import from document (Optional)
            </h4>
            <p className="text-xs text-gray-400 mb-4">
              You can upload a .docx or .pdf file on the next screen to automatically extract questions and build your answer key.
            </p>
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Create & Continue
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
