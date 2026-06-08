'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, Plus, Upload, Edit2, Trash2, Users, FileSpreadsheet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button, Input, Card, Modal, Select, useToast } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { Student } from '@/lib/types';
import * as XLSX from 'xlsx';

export default function StudentsPage() {
  const { user } = useSupabaseAuth();
  const { addToast } = useToast();
  const supabase = createClient();
  
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);
  
  // Form state
  const [currentStudent, setCurrentStudent] = useState<Partial<Student>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importData, setImportData] = useState<Record<string, string>[]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importFileName, setImportFileName] = useState('');
  const [columnMap, setColumnMap] = useState<{ name: string; id: string; section: string }>({ name: '', id: '', section: '' });
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; skipped: number; errors: string[] } | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [aiDetectionStatus, setAiDetectionStatus] = useState<'idle' | 'detecting' | 'success' | 'unavailable'>('idle');
  const [isAiParsingFile, setIsAiParsingFile] = useState(false);
  const [isAiParsedFile, setIsAiParsedFile] = useState(false);

  useEffect(() => {
    if (user) loadStudents();
  }, [user]);

  async function loadStudents() {
    setLoading(true);
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('teacher_id', user?.id)
      .order('name');
      
    if (error) {
      addToast('error', 'Failed to load students');
    } else {
      setStudents(data as Student[]);
    }
    setLoading(false);
  }

  // ---- File Import Logic ----
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Reset previous state
    setImportResult(null);
    setImportData([]);
    setImportHeaders([]);
    setColumnMap({ name: '', id: '', section: '' });
    setImportFileName(file.name);
    setIsAiParsedFile(false);
    setIsAiParsingFile(false);

    const fileExt = file.name.split('.').pop()?.toLowerCase();

    if (fileExt === 'csv' || fileExt === 'xlsx' || fileExt === 'xls') {
      try {
        const bytes = await file.arrayBuffer();
        let rows: Record<string, string>[] = [];
        let headers: string[] = [];

        // Parse CSV/Excel using xlsx library for consistency
        const workbook = XLSX.read(bytes, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
        if (jsonData.length > 0) {
          headers = Object.keys(jsonData[0]);
          rows = jsonData;
        }

        if (rows.length === 0 || headers.length === 0) {
          addToast('error', 'The file is empty or has no recognizable data.');
          return;
        }

        setImportHeaders(headers);
        setImportData(rows);

        // Auto-detect column mapping based on header names
        const lowerHeaders = headers.map(h => h.toLowerCase().trim());
        const nameCol = headers.find((_, i) => 
          ['name', 'full name', 'fullname', 'student name', 'student_name', 'pangalan', 'learner'].some(k => lowerHeaders[i].includes(k))
        ) || '';
        const idCol = headers.find((_, i) => 
          ['id', 'student id', 'student_id', 'id number', 'id_number', 'lrn', 'student no', 'number'].some(k => lowerHeaders[i].includes(k))
        ) || '';
        const sectionCol = headers.find((_, i) => 
          ['section', 'class', 'grade', 'class_section', 'class/section', 'level', 'strand'].some(k => lowerHeaders[i].includes(k))
        ) || '';

        setColumnMap({ name: nameCol, id: idCol, section: sectionCol });
        setIsImportModalOpen(true);
        
        // Trigger AI column detection
        detectColumnsWithAI(headers, rows);
      } catch (err: any) {
        addToast('error', `Failed to read file: ${err.message}`);
      }
    } else if (fileExt === 'docx' || fileExt === 'doc' || fileExt === 'pdf' || fileExt === 'txt') {
      parseStudentsFileWithAI(file);
    } else {
      addToast('error', 'Unsupported file format. Please upload a CSV, Excel, Word (.docx/.doc), PDF, or TXT file.');
    }

    // Clear input so same file can be selected again
    e.target.value = '';
  };

  const parseStudentsFileWithAI = async (file: File) => {
    setIsAiParsingFile(true);
    setIsImportModalOpen(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/parse-students', {
        method: 'POST',
        body: formData
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (!data.students || data.students.length === 0) {
          addToast('error', 'No students could be extracted from the document.');
          closeImportModal();
          return;
        }
        
        // Transform the structured student list into spreadsheet rows format
        const rows = data.students.map((s: any) => ({
          'Name': s.name,
          'Student ID': s.student_id_number,
          'Section': s.class_section
        }));
        
        setImportHeaders(['Name', 'Student ID', 'Section']);
        setImportData(rows);
        setColumnMap({ name: 'Name', id: 'Student ID', section: 'Section' });
        setIsAiParsedFile(true);
        addToast('success', `Successfully extracted ${data.students.length} students using AI!`);
      } else {
        const errData = await response.json().catch(() => ({}));
        addToast('error', errData.error || 'Failed to extract students using AI.');
        closeImportModal();
      }
    } catch (err: any) {
      addToast('error', `Error during AI student parsing: ${err.message}`);
      closeImportModal();
    } finally {
      setIsAiParsingFile(false);
    }
  };

  const detectColumnsWithAI = async (headers: string[], rows: Record<string, string>[]) => {
    setAiDetectionStatus('detecting');
    try {
      const response = await fetch('/api/detect-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headers,
          sampleRows: rows.slice(0, 5)
        })
      });

      if (response.ok) {
        const data = await response.json();
        setColumnMap(prev => ({
          name: data.name && headers.includes(data.name) ? data.name : prev.name,
          id: data.id && headers.includes(data.id) ? data.id : prev.id,
          section: data.section && headers.includes(data.section) ? data.section : prev.section
        }));
        setAiDetectionStatus('success');
        addToast('success', 'AI auto-detected column mappings!');
      } else {
        const errData = await response.json().catch(() => ({}));
        if (errData.error?.includes('API key is not configured') || errData.error?.includes('not configured')) {
          setAiDetectionStatus('unavailable');
        } else {
          setAiDetectionStatus('idle');
        }
      }
    } catch (err) {
      console.warn('AI column detection error:', err);
      setAiDetectionStatus('idle');
    }
  };

  const handleImportConfirm = async () => {
    if (!user) return;
    if (!columnMap.name) {
      addToast('error', 'Please select which column contains the student name.');
      return;
    }

    setIsImporting(true);
    const result = { added: 0, skipped: 0, errors: [] as string[] };

    if (replaceExisting) {
      const { error: deleteError } = await supabase
        .from('students')
        .delete()
        .eq('teacher_id', user.id);
      
      if (deleteError) {
        result.errors.push(`Failed to clear existing roster: ${deleteError.message}`);
        setImportResult(result);
        setIsImporting(false);
        return;
      }
    }

    // Get existing student IDs to avoid duplicates
    const existingIds = new Set(replaceExisting ? [] : students.map(s => s.student_id_number));

    // Build rows to insert
    const rowsToInsert: { teacher_id: string; name: string; student_id_number: string; class_section: string }[] = [];

    for (let i = 0; i < importData.length; i++) {
      const row = importData[i];
      const name = String(row[columnMap.name] || '').trim();
      const rawIdVal = columnMap.id ? String(row[columnMap.id] || '').trim() : '';
      const isMissingId = rawIdVal === '' || rawIdVal.toLowerCase() === 'n/a' || rawIdVal.toLowerCase() === 'none' || rawIdVal.toLowerCase() === 'null' || rawIdVal === '-';
      const idNum = !isMissingId ? rawIdVal : `AUTO-${Date.now()}-${i}`;
      const section = columnMap.section ? String(row[columnMap.section] || '').trim() : '';

      if (!name) {
        result.skipped++;
        continue;
      }

      if (existingIds.has(idNum)) {
        result.skipped++;
        continue;
      }

      existingIds.add(idNum);
      rowsToInsert.push({
        teacher_id: user.id,
        name,
        student_id_number: idNum,
        class_section: section
      });
    }

    // Batch insert (Supabase supports up to ~1000 rows at a time)
    if (rowsToInsert.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < rowsToInsert.length; i += batchSize) {
        const batch = rowsToInsert.slice(i, i + batchSize);
        const { error } = await supabase.from('students').insert(batch);
        if (error) {
          result.errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
        } else {
          result.added += batch.length;
        }
      }
    }

    setImportResult(result);
    setIsImporting(false);
    loadStudents();
  };

  const closeImportModal = () => {
    setIsImportModalOpen(false);
    setImportData([]);
    setImportHeaders([]);
    setImportResult(null);
    setReplaceExisting(false);
    setAiDetectionStatus('idle');
    setIsAiParsingFile(false);
    setIsAiParsedFile(false);
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSubmitting(true);

    if (isEditModalOpen && currentStudent.id) {
      const { error } = await supabase
        .from('students')
        .update({
          name: currentStudent.name,
          student_id_number: currentStudent.student_id_number,
          class_section: currentStudent.class_section
        })
        .eq('id', currentStudent.id);

      if (error) {
        addToast('error', error.message);
      } else {
        addToast('success', 'Student updated successfully');
        setIsEditModalOpen(false);
        loadStudents();
      }
    } else {
      const { error } = await supabase
        .from('students')
        .insert({
          teacher_id: user.id,
          name: currentStudent.name,
          student_id_number: currentStudent.student_id_number,
          class_section: currentStudent.class_section
        });

      if (error) {
        addToast('error', error.message);
      } else {
        addToast('success', 'Student added successfully');
        setIsAddModalOpen(false);
        loadStudents();
      }
    }
    setIsSubmitting(false);
  };

  const handleDelete = async () => {
    if (!currentStudent.id) return;
    setIsSubmitting(true);
    
    const { error } = await supabase
      .from('students')
      .delete()
      .eq('id', currentStudent.id);
      
    if (error) {
      addToast('error', error.message);
    } else {
      addToast('success', 'Student deleted');
      setIsDeleteModalOpen(false);
      loadStudents();
    }
    setIsSubmitting(false);
  };

  const handleDeleteAll = async () => {
    if (!user || students.length === 0) return;
    setIsSubmitting(true);
    
    const { error } = await supabase
      .from('students')
      .delete()
      .eq('teacher_id', user.id);
      
    if (error) {
      addToast('error', 'Failed to delete all students: ' + error.message);
    } else {
      addToast('success', `Successfully deleted all ${students.length} students`);
      setIsDeleteAllModalOpen(false);
      loadStudents();
    }
    setIsSubmitting(false);
  };

  const openEditModal = (student: Student) => {
    setCurrentStudent(student);
    setIsEditModalOpen(true);
  };

  const openDeleteModal = (student: Student) => {
    setCurrentStudent(student);
    setIsDeleteModalOpen(true);
  };

  const openAddModal = () => {
    setCurrentStudent({ name: '', student_id_number: '', class_section: '' });
    setIsAddModalOpen(true);
  };

  const filteredStudents = students.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    s.student_id_number.includes(searchQuery) ||
    s.class_section.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Students</h1>
          <p className="text-gray-400 text-sm">Manage your class roster</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          {/* Hidden file input for import */}
          <input 
            ref={fileInputRef} 
            type="file" 
            accept=".csv,.xlsx,.xls,.docx,.doc,.pdf,.txt"
            className="hidden" 
            onChange={handleFileSelected} 
          />
          <Button variant="secondary" onClick={handleImportClick} className="flex-1 sm:flex-none gap-2">
            <Upload size={16} /> Import
          </Button>
          <Button onClick={openAddModal} className="flex-1 sm:flex-none gap-2">
            <Plus size={16} /> Add Student
          </Button>
          {students.length > 0 && (
            <Button variant="danger" onClick={() => setIsDeleteAllModalOpen(true)} className="flex-1 sm:flex-none gap-2">
              <Trash2 size={16} /> Delete All
            </Button>
          )}
        </div>
      </header>

      <Card padding="none">
        <div className="p-4 border-b border-white/10 bg-white/5 flex gap-4">
          <div className="w-full sm:w-72 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="text" 
              placeholder="Search students..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-navy-900 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:border-transparent focus:ring-blue-500/50"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-300">
            <thead className="bg-white/5 border-b border-white/10 text-xs uppercase font-semibold text-gray-400">
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Student ID</th>
                <th className="px-6 py-4">Class/Section</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                    <div className="animate-pulse flex flex-col items-center gap-2">
                      <div className="h-4 w-48 bg-white/10 rounded"></div>
                      <div className="h-4 w-32 bg-white/10 rounded"></div>
                    </div>
                  </td>
                </tr>
              ) : filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                    <Users size={48} className="mx-auto mb-3 opacity-20" />
                    <p>No students found</p>
                    <p className="text-xs mt-2">Add students manually or import from a CSV/Excel file.</p>
                  </td>
                </tr>
              ) : (
                filteredStudents.map((student) => (
                  <tr key={student.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 font-medium text-white">{student.name}</td>
                    <td className="px-6 py-4 font-mono text-xs">{student.student_id_number}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2 py-1 rounded bg-white/5 border border-white/10 text-xs">
                        {student.class_section}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEditModal(student)} className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-blue-400/10 rounded transition-colors">
                          <Edit2 size={16} />
                        </button>
                        <button onClick={() => openDeleteModal(student)} className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add/Edit Modal */}
      <Modal 
        isOpen={isAddModalOpen || isEditModalOpen} 
        onClose={() => { setIsAddModalOpen(false); setIsEditModalOpen(false); }}
        title={isEditModalOpen ? "Edit Student" : "Add Student"}
      >
        <form onSubmit={handleSaveStudent} className="space-y-4">
          <Input 
            label="Full Name" 
            placeholder="Juan Dela Cruz" 
            required 
            value={currentStudent.name || ''}
            onChange={e => setCurrentStudent({...currentStudent, name: e.target.value})}
          />
          <Input 
            label="Student ID Number" 
            placeholder="2024-00123" 
            required 
            value={currentStudent.student_id_number || ''}
            onChange={e => setCurrentStudent({...currentStudent, student_id_number: e.target.value})}
          />
          <Input 
            label="Class / Section" 
            placeholder="Grade 10 - Einstein" 
            required 
            value={currentStudent.class_section || ''}
            onChange={e => setCurrentStudent({...currentStudent, class_section: e.target.value})}
          />
          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => { setIsAddModalOpen(false); setIsEditModalOpen(false); }}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {isEditModalOpen ? "Save Changes" : "Add Student"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal 
        isOpen={isDeleteModalOpen} 
        onClose={() => setIsDeleteModalOpen(false)}
        title="Delete Student"
      >
        <div className="space-y-4">
          <p className="text-gray-300">
            Are you sure you want to delete <strong>{currentStudent.name}</strong>? This will also delete all of their exam submissions and cannot be undone.
          </p>
          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsDeleteModalOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={handleDelete} loading={isSubmitting}>
              Delete Student
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete All Students Modal */}
      <Modal 
        isOpen={isDeleteAllModalOpen} 
        onClose={() => setIsDeleteAllModalOpen(false)}
        title="Delete All Students"
      >
        <div className="space-y-4">
          <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4 flex gap-3">
            <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={20} />
            <div>
              <p className="text-red-300 font-semibold mb-1">Warning: This action is irreversible</p>
              <p className="text-sm text-red-200">You are about to permanently delete all {students.length} student{students.length !== 1 ? 's' : ''} from your roster. All exam submissions will also be deleted.</p>
            </div>
          </div>
          <p className="text-gray-300">Type <strong className="text-white\">DELETE ALL</strong> to confirm:</p>
          <input 
            type="text" 
            placeholder="Type DELETE ALL to confirm"
            id="deleteAllConfirm"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50"
          />
          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsDeleteAllModalOpen(false)}>
              Cancel
            </Button>
            <Button 
              type="button"
              variant="danger" 
              loading={isSubmitting}
              onClick={async () => {
                const confirmInput = (document.getElementById('deleteAllConfirm') as HTMLInputElement)?.value;
                if (confirmInput !== 'DELETE ALL') {
                  addToast('error', 'Please type "DELETE ALL" to confirm');
                  return;
                }
                await handleDeleteAll();
              }}
            >
              Delete All {students.length} Students
            </Button>
          </div>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal 
        isOpen={isImportModalOpen} 
        onClose={closeImportModal}
        title="Import Students"
      >
        <div className="space-y-5">
          {/* File info */}
          <div className="flex items-center gap-3 p-3 bg-blue-900/20 rounded-xl border border-blue-500/20">
            <FileSpreadsheet size={20} className="text-blue-400 shrink-0" />
            <div className="text-sm w-full font-medium">
              <p className="text-white truncate">{importFileName}</p>
              <p className="text-gray-400">
                {isAiParsingFile ? 'Analyzing file structure...' : `${importData.length} rows detected`}
              </p>
            </div>
          </div>

          {isAiParsingFile ? (
            /* AI Extraction Loading View */
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
              <span className="animate-spin inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
              <p className="text-sm font-medium text-white">Extracting student roster using AI...</p>
              <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
                Reading your Word/PDF document, identifying student names, ID numbers, and sections. This may take 15-30 seconds.
              </p>
            </div>
          ) : importResult ? (
            /* Results View */
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-900/20 border border-emerald-500/20">
                <CheckCircle2 size={24} className="text-emerald-400 shrink-0" />
                <div>
                  <p className="text-white font-semibold">Import Complete</p>
                  <p className="text-sm text-gray-300">
                    <span className="text-emerald-400 font-bold">{importResult.added}</span> students added
                    {importResult.skipped > 0 && (
                      <>, <span className="text-yellow-400 font-bold">{importResult.skipped}</span> skipped (empty name or duplicate ID)</>
                    )}
                  </p>
                </div>
              </div>
              {importResult.errors.length > 0 && (
                <div className="p-3 rounded-xl bg-red-900/20 border border-red-500/20 text-sm text-red-300">
                  <p className="font-semibold flex items-center gap-2 mb-1"><AlertTriangle size={16} /> Errors:</p>
                  {importResult.errors.map((err, i) => <p key={i} className="ml-6">• {err}</p>)}
                </div>
              )}
              <div className="flex justify-end">
                <Button onClick={closeImportModal}>Done</Button>
              </div>
            </div>
          ) : (
            /* Column Mapping or AI Extracted View */
            <>
              {isAiParsedFile ? (
                /* AI Document Parsed Message */
                <div className="p-3.5 bg-emerald-950/25 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 flex items-start gap-2.5 leading-relaxed">
                  <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-white block mb-0.5">AI Document Extraction Roster</span>
                    Successfully read and extracted the student list directly from your document. Review the preview below to confirm before importing.
                  </div>
                </div>
              ) : (
                /* Column Mapping Controls */
                <>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm text-gray-400">
                      Map the columns from your file to the student fields.
                    </p>
                    {aiDetectionStatus === 'detecting' && (
                      <div className="flex items-center gap-2 text-xs text-blue-400 font-medium py-1 animate-pulse">
                        <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full" />
                        <span>AI is auto-detecting column mappings...</span>
                      </div>
                    )}
                    {aiDetectionStatus === 'success' && (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium py-1">
                        <CheckCircle2 size={14} className="shrink-0" />
                        <span>AI auto-detection complete!</span>
                      </div>
                    )}
                    {aiDetectionStatus === 'unavailable' && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-500 font-medium py-1">
                        <AlertTriangle size={14} className="shrink-0" />
                        <span>Configure your AI API key in Settings to unlock smart column detection.</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 mt-3">
                    <Select
                      label="Name Column *"
                      value={columnMap.name}
                      onChange={e => setColumnMap({...columnMap, name: e.target.value})}
                      options={[
                        { value: '', label: '-- Select a column --' },
                        ...importHeaders.map(h => ({ value: h, label: h }))
                      ]}
                    />
                    <Select
                      label="Student ID Column"
                      value={columnMap.id}
                      onChange={e => setColumnMap({...columnMap, id: e.target.value})}
                      options={[
                        { value: '', label: '-- None (auto-generate) --' },
                        ...importHeaders.map(h => ({ value: h, label: h }))
                      ]}
                      helperText="If not selected, IDs will be auto-generated."
                    />
                    <Select
                      label="Class / Section Column"
                      value={columnMap.section}
                      onChange={e => setColumnMap({...columnMap, section: e.target.value})}
                      options={[
                        { value: '', label: '-- None --' },
                        ...importHeaders.map(h => ({ value: h, label: h }))
                      ]}
                    />
                  </div>
                </>
              )}

              {/* Replace existing students option */}
              <div className="flex items-start gap-3 p-3 bg-red-950/20 border border-red-500/20 rounded-xl mt-4">
                <input 
                  type="checkbox" 
                  id="replaceExisting"
                  checked={replaceExisting}
                  onChange={e => setReplaceExisting(e.target.checked)}
                  className="w-4 h-4 rounded border-white/10 bg-white/5 text-red-500 focus:ring-red-500 focus:ring-offset-0 cursor-pointer mt-0.5"
                />
                <label htmlFor="replaceExisting" className="text-xs text-gray-300 cursor-pointer select-none">
                  <span className="font-semibold text-white block">Replace all existing students</span>
                  Delete all current student records in your roster and replace them with this list. <span className="text-red-400 font-medium">Warning: This deletes all existing submissions and grades!</span>
                </label>
              </div>

              {/* Data Preview */}
              {columnMap.name && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Preview (first 5 rows)</p>
                  <div className="overflow-x-auto rounded-lg border border-white/10">
                    <table className="w-full text-xs text-gray-300">
                      <thead className="bg-white/5 text-gray-400">
                        <tr>
                          <th className="px-3 py-2 text-left">Name</th>
                          <th className="px-3 py-2 text-left">Student ID</th>
                          <th className="px-3 py-2 text-left">Section</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {importData.slice(0, 5).map((row, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 text-white font-medium">{String(row[columnMap.name] || '')}</td>
                            <td className="px-3 py-2 font-mono">{columnMap.id ? String(row[columnMap.id] || '') : <span className="text-gray-500 italic">auto</span>}</td>
                            <td className="px-3 py-2">{columnMap.section ? String(row[columnMap.section] || '') : <span className="text-gray-500">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="pt-4 flex justify-end gap-3">
                <Button type="button" variant="ghost" onClick={closeImportModal}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleImportConfirm} 
                  loading={isImporting} 
                  disabled={!columnMap.name}
                  variant={replaceExisting ? "danger" : "primary"}
                >
                  {replaceExisting ? "Replace & Import Students" : `Import ${importData.length} Students`}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
