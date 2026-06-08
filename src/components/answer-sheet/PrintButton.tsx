'use client';

import React, { useRef, useState, useEffect } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Printer, Upload, Image, Loader2, Check, Layout, AlertTriangle } from 'lucide-react';
import { Button, Modal, useToast } from '@/components/ui';
import { Exam, Student } from '@/lib/types';
import { AnswerSheetTemplate } from './AnswerSheetTemplate';
import { createClient } from '@/lib/supabase/client';

export interface PrintButtonProps {
  students: Student[];
  exam: Exam;
  schoolName: string;
  onUpdateExam?: (exam: Exam) => void;
}

export default function PrintButton({ students, exam, schoolName, onUpdateExam }: PrintButtonProps) {
  const supabase = createClient();
  const { addToast } = useToast();
  const contentRef = useRef<HTMLDivElement>(null);
  
  const [currentExam, setCurrentExam] = useState<Exam>(exam);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Only update from props if the incoming answer key or title actually changed,
    // avoiding overwriting local metadata state if the parent just re-rendered due to toast.
    setCurrentExam(prev => {
       if (prev.id === exam.id && JSON.stringify(prev.answer_key) === JSON.stringify(exam.answer_key) && prev.title === exam.title) {
          return prev;
       }
       return { ...exam, exam_type_metadata: prev.exam_type_metadata };
    });
  }, [exam]);

  const handlePrint = useReactToPrint({
    contentRef: contentRef,
    documentTitle: `${currentExam.title} - Answer Sheets`,
    pageStyle: `
      @page {
        size: 8.5in 13in;
        margin: 0;
        padding: 0;
      }
      @media print {
        body {
          margin: 0;
          padding: 0;
        }
        .break-page {
          page-break-after: always;
        }
      }
    `,
  });

  const metadata = currentExam.exam_type_metadata as Record<string, any> || {};
  const useCustomHeader = metadata.use_custom_header === true;
  const customHeaderHtml = metadata.custom_header_html as string || '';

  const handleToggleHeader = async (useCustom: boolean) => {
    const updatedMetadata = {
      ...(currentExam.exam_type_metadata as Record<string, any> || {}),
      use_custom_header: useCustom
    };

    const newExam = {
      ...currentExam,
      exam_type_metadata: updatedMetadata
    };
    
    setCurrentExam(newExam);
    onUpdateExam?.(newExam);

    const { error } = await supabase
      .from('exams')
      .update({ exam_type_metadata: updatedMetadata })
      .eq('id', exam.id);

    if (error) {
      addToast('error', 'Failed to save print settings: ' + error.message);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleUploadHeaderImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsGenerating(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/generate-header', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        
        const updatedMetadata = {
          ...(currentExam.exam_type_metadata as Record<string, any> || {}),
          custom_header_html: data.html,
          use_custom_header: true
        };

        const newExam = {
          ...currentExam,
          exam_type_metadata: updatedMetadata
        };

        setCurrentExam(newExam);
        onUpdateExam?.(newExam);

        const { error } = await supabase
          .from('exams')
          .update({ exam_type_metadata: updatedMetadata })
          .eq('id', exam.id);

        if (error) {
          addToast('error', 'Failed to save generated header: ' + error.message);
        } else {
          addToast('success', 'Custom header successfully generated and saved!');
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        addToast('error', errData.error || 'Failed to generate header. Ensure your API keys are configured in Settings.');
      }
    } catch (err: any) {
      addToast('error', 'Error generating header: ' + err.message);
    } finally {
      setIsGenerating(false);
      e.target.value = '';
    }
  };

  // Generate a preview with mock student data
  const getPreviewHtml = () => {
    if (!customHeaderHtml) return '';
    const mockStudent = { name: 'Juan Dela Cruz', student_id_number: '2024-00123', class_section: 'Grade 10 - Einstein' };
    return customHeaderHtml
      .replace(/\{\{SCHOOL_NAME\}\}/g, schoolName)
      .replace(/\{\{EXAM_TITLE\}\}/g, currentExam.title)
      .replace(/\{\{STUDENT_NAME\}\}/g, mockStudent.name)
      .replace(/\{\{STUDENT_SECTION\}\}/g, mockStudent.class_section)
      .replace(/\{\{STUDENT_ID\}\}/g, mockStudent.student_id_number)
      .replace(/\{\{DATE\}\}/g, '_______________________');
  };

  return (
    <>
      <Button onClick={() => setIsModalOpen(true)} className="gap-2" variant="secondary">
        <Printer size={16} /> Print Answer Sheets
      </Button>

      {/* Hidden container for printing */}
      <div className="hidden">
        <div ref={contentRef} className="print-container">
          {students.map((student) => (
            <div key={student.id} className="answer-sheet page-break">
              <AnswerSheetTemplate 
                student={student} 
                exam={currentExam} 
                schoolName={schoolName} 
              />
            </div>
          ))}
        </div>
      </div>

      {/* Print Settings Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Print Setup & Header Customization"
        size="lg"
      >
        <div className="space-y-6">
          {/* Roster Summary */}
          <div className="p-3 bg-white/5 border border-white/10 rounded-xl text-sm flex justify-between items-center text-gray-300">
            <span>Roster: <strong>{students.length} students</strong></span>
            <span>Answer Key: <strong>{currentExam.total_items} items</strong></span>
          </div>

          {/* Header style selection */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-white block">Header Layout Style</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleToggleHeader(false)}
                className={`p-4 rounded-xl border text-left transition-all ${
                  !useCustomHeader 
                    ? 'bg-blue-600/10 border-blue-500 text-white ring-1 ring-blue-500' 
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2 font-medium mb-1">
                  <Layout size={18} />
                  <span>Default Header</span>
                  {!useCustomHeader && <Check size={14} className="ml-auto text-blue-400" />}
                </div>
                <p className="text-xs text-gray-400">Standard layout showing school name, exam title, and pre-printed student details.</p>
              </button>

              <button
                type="button"
                onClick={() => handleToggleHeader(true)}
                className={`p-4 rounded-xl border text-left transition-all ${
                  useCustomHeader 
                    ? 'bg-blue-600/10 border-blue-500 text-white ring-1 ring-blue-500' 
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2 font-medium mb-1">
                  <Image size={18} />
                  <span>AI Custom Header</span>
                  {useCustomHeader && <Check size={14} className="ml-auto text-blue-400" />}
                </div>
                <p className="text-xs text-gray-400">Customized layout cloned from an uploaded photo or screenshot of your school header.</p>
              </button>
            </div>
          </div>

          {/* Custom Header Upload Area */}
          {useCustomHeader && (
            <div className="space-y-4 animate-fade-in">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleUploadHeaderImage}
              />

              {isGenerating ? (
                <div className="border border-dashed border-white/15 rounded-2xl p-8 bg-white/5 flex flex-col items-center justify-center text-center gap-3">
                  <Loader2 size={36} className="text-blue-500 animate-spin" />
                  <p className="text-sm font-semibold text-white">AI is Analyzing and Formatting Roster Header...</p>
                  <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
                    Analyzing visual layout, borders, font weights, and generating matching printable HTML structure. This can take 15-30 seconds.
                  </p>
                </div>
              ) : customHeaderHtml ? (
                /* Header preview */
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Preview (Juan Dela Cruz)</span>
                    <Button variant="ghost" size="sm" onClick={handleUploadClick} className="text-blue-400 h-8 text-xs gap-1.5">
                      <Upload size={14} /> Re-generate Header
                    </Button>
                  </div>
                  <div className="border border-white/10 rounded-xl bg-white/5 p-4 max-h-[220px] overflow-auto">
                    <div 
                      dangerouslySetInnerHTML={{ __html: getPreviewHtml() }} 
                      className="bg-white border border-gray-300 rounded-lg p-6 text-black text-[11px] leading-normal font-sans shadow-sm"
                    />
                  </div>
                </div>
              ) : (
                /* Empty Upload Zone */
                <div 
                  onClick={handleUploadClick}
                  className="border border-dashed border-white/10 hover:border-blue-500 hover:bg-white/5 rounded-2xl p-8 flex flex-col items-center justify-center text-center gap-3 cursor-pointer transition-all"
                >
                  <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
                    <Upload size={24} />
                  </div>
                  <div className="text-sm">
                    <p className="text-white font-semibold mb-1">Upload school header image</p>
                    <p className="text-gray-400 text-xs max-w-xs leading-relaxed">
                      Take a screenshot or photo of your school's exam header/letterhead and upload it here.
                    </p>
                  </div>
                </div>
              )}

              {/* API warning if not configured */}
              {!customHeaderHtml && !isGenerating && (
                <div className="flex gap-2 p-3 bg-amber-950/20 border border-amber-500/20 rounded-xl text-xs text-amber-400 items-start">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>
                    Ensure you have configured your AI API keys on the <strong>Settings</strong> page before uploading, as this utilizes vision models.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Print button footer */}
          <div className="pt-4 border-t border-white/10 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => { setIsModalOpen(false); handlePrint(); }} className="gap-2">
              <Printer size={16} /> Print {students.length} Sheets
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
