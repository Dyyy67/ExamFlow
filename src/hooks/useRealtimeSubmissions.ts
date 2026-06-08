'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Submission } from '@/lib/types';
import { useSupabaseAuth } from './useSupabaseAuth';

export function useRealtimeSubmissions() {
  const { user } = useSupabaseAuth();
  const supabase = createClient();
  
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [updatedIds, setUpdatedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;

    // Load initial data
    const loadInitial = async () => {
      const { data } = await supabase
        .from('submissions')
        .select('*, exams!inner(teacher_id)')
        .eq('exams.teacher_id', user.id);
        
      if (data) {
        setSubmissions(data as Submission[]);
      }
    };
    
    loadInitial();

    // Subscribe to realtime inserts and updates
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'submissions',
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newSub = payload.new as Submission;
            setSubmissions(prev => [...prev, newSub]);
            highlightUpdate(newSub.id);
          } else if (payload.eventType === 'UPDATE') {
            const updatedSub = payload.new as Submission;
            setSubmissions(prev => prev.map(s => s.id === updatedSub.id ? updatedSub : s));
            highlightUpdate(updatedSub.id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, supabase]);

  const highlightUpdate = (id: string) => {
    setUpdatedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    
    // Remove highlight after 3 seconds
    setTimeout(() => {
      setUpdatedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 3000);
  };

  return { submissions, updatedIds };
}
