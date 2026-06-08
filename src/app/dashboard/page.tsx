'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, FileText, ClipboardCheck, TrendingUp, Plus, Camera } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { createClient } from '@/lib/supabase/client';

export default function DashboardOverview() {
  const { profile, user } = useSupabaseAuth();
  const [stats, setStats] = useState({
    students: 0,
    exams: 0,
    submissions: 0,
    avgScore: 0
  });
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function loadDashboardData() {
      if (!user) return;

      const [studentsRes, examsRes, submissionsRes] = await Promise.all([
        supabase.from('students').select('id', { count: 'exact' }).eq('teacher_id', user.id),
        supabase.from('exams').select('id', { count: 'exact' }).eq('teacher_id', user.id),
        supabase.from('submissions').select('score, exam_id, student_id, scanned_at, exams!inner(teacher_id)').eq('exams.teacher_id', user.id)
      ]);

      const subs = submissionsRes.data || [];
      const avg = subs.length > 0 ? subs.reduce((acc, curr) => acc + curr.score, 0) / subs.length : 0;

      setStats({
        students: studentsRes.count || 0,
        exams: examsRes.count || 0,
        submissions: subs.length,
        avgScore: Math.round(avg * 10) / 10
      });

      // Fetch recent activity
      const { data: recent } = await supabase
        .from('submissions')
        .select(`
          id, score, scanned_at,
          exams!inner(title, teacher_id),
          students!inner(name)
        `)
        .eq('exams.teacher_id', user.id)
        .order('scanned_at', { ascending: false })
        .limit(5);

      if (recent) setRecentActivity(recent);
      setLoading(false);
    }

    loadDashboardData();
  }, [user, supabase]);

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">
            Welcome back, {profile?.name?.split(' ')[0] || 'Teacher'} 👋
          </h1>
          <p className="text-gray-400">Here's what's happening in your classes today.</p>
        </div>
        <div className="flex gap-3">
          <Link href="/dashboard/exams">
            <Button variant="secondary" className="gap-2">
              <Plus size={18} /> New Exam
            </Button>
          </Link>
          <Link href="/scanner">
            <Button className="gap-2">
              <Camera size={18} /> Open Scanner
            </Button>
          </Link>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
            <Users size={24} />
          </div>
          <div>
            <p className="text-gray-400 text-sm font-medium">Total Students</p>
            <h3 className="text-2xl font-bold text-white">
              {loading ? <span className="animate-pulse bg-white/10 w-12 h-8 rounded inline-block" /> : stats.students}
            </h3>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
            <FileText size={24} />
          </div>
          <div>
            <p className="text-gray-400 text-sm font-medium">Total Exams</p>
            <h3 className="text-2xl font-bold text-white">
              {loading ? <span className="animate-pulse bg-white/10 w-12 h-8 rounded inline-block" /> : stats.exams}
            </h3>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <ClipboardCheck size={24} />
          </div>
          <div>
            <p className="text-gray-400 text-sm font-medium">Submissions</p>
            <h3 className="text-2xl font-bold text-white">
              {loading ? <span className="animate-pulse bg-white/10 w-12 h-8 rounded inline-block" /> : stats.submissions}
            </h3>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
            <TrendingUp size={24} />
          </div>
          <div>
            <p className="text-gray-400 text-sm font-medium">Average Score</p>
            <h3 className="text-2xl font-bold text-white">
              {loading ? <span className="animate-pulse bg-white/10 w-12 h-8 rounded inline-block" /> : `${stats.avgScore}`}
            </h3>
          </div>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card padding="none" className="overflow-hidden">
        <div className="p-6 border-b border-white/10 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-white">Recent Submissions</h2>
          <Link href="/dashboard/gradebook" className="text-sm text-blue-400 hover:text-blue-300">
            View Gradebook &rarr;
          </Link>
        </div>
        
        {loading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse flex justify-between items-center bg-white/5 p-4 rounded-xl">
                <div className="w-48 h-5 bg-white/10 rounded" />
                <div className="w-24 h-5 bg-white/10 rounded" />
              </div>
            ))}
          </div>
        ) : recentActivity.length > 0 ? (
          <div className="divide-y divide-white/10">
            {recentActivity.map((activity) => (
              <div key={activity.id} className="p-4 sm:p-6 flex items-center justify-between hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-gray-700 to-gray-600 flex items-center justify-center text-sm font-bold text-white">
                    {activity.students.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-medium text-white">{activity.students.name}</p>
                    <p className="text-sm text-gray-400">{activity.exams.title}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg text-white">{activity.score}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(activity.scanned_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center text-gray-400">
            <ClipboardCheck size={48} className="mx-auto mb-4 opacity-50" />
            <p>No submissions yet.</p>
            <p className="text-sm mt-1">Scan an exam sheet to see activity here.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
