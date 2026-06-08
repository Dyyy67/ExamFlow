'use client';

import { useState, useEffect } from 'react';
import { Download, Search } from 'lucide-react';
import { Button, Card, useToast } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { Student, Exam, Submission } from '@/lib/types';
import { useRealtimeSubmissions } from '@/hooks/useRealtimeSubmissions';

export default function GradebookPage() {
  const { user } = useSupabaseAuth();
  const { addToast } = useToast();
  const supabase = createClient();
  
  const [students, setStudents] = useState<Student[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  
  // We use our custom hook to subscribe to real-time changes
  const { submissions, updatedIds } = useRealtimeSubmissions();

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  async function loadData() {
    setLoading(true);
    const [studentsRes, examsRes] = await Promise.all([
      supabase.from('students').select('*').eq('teacher_id', user?.id).order('name'),
      supabase.from('exams').select('*').eq('teacher_id', user?.id).order('created_at', { ascending: false })
    ]);

    if (studentsRes.error || examsRes.error) {
      addToast('error', 'Failed to load gradebook data');
    } else {
      setStudents(studentsRes.data as Student[]);
      setExams(examsRes.data as Exam[]);
    }
    setLoading(false);
  }

  // Get score for a specific cell
  const getScore = (studentId: string, examId: string) => {
    return submissions.find(s => s.student_id === studentId && s.exam_id === examId);
  };

  // Cell coloring logic
  const getScoreColorClass = (score: number, total: number) => {
    if (!total || total === 0) return 'text-gray-400';
    const ratio = score / total;
    if (ratio >= 0.8) return 'bg-emerald-500/10 text-emerald-400 font-bold';
    if (ratio >= 0.6) return 'bg-yellow-500/10 text-yellow-400 font-bold';
    return 'bg-red-500/10 text-red-400 font-bold';
  };

  const calculateStudentAverage = (studentId: string) => {
    const studentSubs = submissions.filter(s => s.student_id === studentId);
    if (studentSubs.length === 0) return null;
    let totalScore = 0;
    let totalPossible = 0;
    studentSubs.forEach(s => {
      const exam = exams.find(e => e.id === s.exam_id);
      if (exam) {
        totalScore += s.score;
        totalPossible += exam.total_items; // Rough estimation, accurate depends on points logic
      }
    });
    return totalPossible > 0 ? (totalScore / totalPossible) * 100 : null;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Gradebook</h1>
          <p className="text-gray-400 text-sm">Real-time sync from mobile scanner</p>
        </div>
        <Button variant="secondary" className="gap-2">
          <Download size={16} /> Export CSV
        </Button>
      </header>

      <Card padding="none" className="overflow-x-auto">
        <div className="min-w-max">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 border-b border-white/10">
              <tr>
                <th className="px-6 py-4 sticky left-0 bg-navy-800 z-10 border-r border-white/10 w-64 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]">
                  Student Name
                </th>
                {exams.map(exam => (
                  <th key={exam.id} className="px-6 py-4 font-medium text-gray-300 text-center min-w-[120px]">
                    <div className="truncate" title={exam.title}>{exam.title}</div>
                    <div className="text-xs text-gray-500 font-normal mt-1">{exam.total_items} pts</div>
                  </th>
                ))}
                <th className="px-6 py-4 text-center font-semibold text-blue-400">Average %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={exams.length + 2} className="px-6 py-8 text-center text-gray-500">
                    <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={exams.length + 2} className="px-6 py-8 text-center text-gray-500">
                    No students found. Add students to see the gradebook.
                  </td>
                </tr>
              ) : (
                students.map((student) => {
                  const avg = calculateStudentAverage(student.id);
                  return (
                    <tr key={student.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-3 sticky left-0 bg-navy-800 z-10 border-r border-white/10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)] font-medium text-white">
                        {student.name}
                      </td>
                      {exams.map(exam => {
                        const submission = getScore(student.id, exam.id);
                        // Check if this specific submission was just updated (pulse animation)
                        const isRecentlyUpdated = submission && updatedIds.has(submission.id);
                        
                        return (
                          <td 
                            key={exam.id} 
                            className={`px-6 py-3 text-center transition-all duration-500
                              ${submission ? getScoreColorClass(submission.score, exam.total_items) : 'text-gray-600'}
                              ${isRecentlyUpdated ? 'animate-pulse-highlight ring-2 ring-blue-500 ring-inset z-20 relative' : ''}
                            `}
                          >
                            {submission ? submission.score : '-'}
                          </td>
                        );
                      })}
                      <td className="px-6 py-3 text-center font-bold">
                        {avg !== null ? (
                          <span className={getScoreColorClass(avg, 100)}>{Math.round(avg)}%</span>
                        ) : '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
      
      {/* Legend */}
      <div className="flex gap-4 items-center text-xs text-gray-400 justify-end">
        <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500"></div> ≥80%</span>
        <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500"></div> 60-79%</span>
        <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500"></div> &lt;60%</span>
      </div>
    </div>
  );
}
