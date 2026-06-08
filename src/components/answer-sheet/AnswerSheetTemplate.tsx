import React from 'react';
import { Exam, Student } from '@/lib/types';
import { QRGenerator } from './QRGenerator';
import { OMRBubbles } from './OMRBubbles';

export interface AnswerSheetTemplateProps {
  student: Student;
  exam: Exam;
  schoolName: string;
}

export function AnswerSheetTemplate({ student, exam, schoolName }: AnswerSheetTemplateProps) {
  // We embed essential routing data into the QR payload
  const qrPayload = JSON.stringify({
    e: exam.id,
    s: student.id,
  });

  const metadata = exam.exam_type_metadata as Record<string, any> || {};
  const useCustomHeader = metadata.use_custom_header === true;
  const customHeaderHtml = metadata.custom_header_html as string || '';

  const renderCustomHeader = () => {
    let html = customHeaderHtml;
    html = html.replace(/\{\{SCHOOL_NAME\}\}/g, schoolName);
    html = html.replace(/\{\{EXAM_TITLE\}\}/g, exam.title);
    html = html.replace(/\{\{STUDENT_NAME\}\}/g, student.name);
    html = html.replace(/\{\{STUDENT_SECTION\}\}/g, student.class_section || '_______________________');
    html = html.replace(/\{\{STUDENT_ID\}\}/g, student.student_id_number || '_______________________');
    html = html.replace(/\{\{DATE\}\}/g, '_______________________');
    return <div dangerouslySetInnerHTML={{ __html: html }} className="flex-1 mr-4 overflow-hidden" />;
  };

  // Determine the maximum number of options across all sections to prevent overlap
  let maxChoices = 4;
  exam.answer_key.sections.forEach(s => {
    if ((s.type === 'matching' || s.type === 'word_bank') && s.choices) {
      maxChoices = Math.max(maxChoices, s.choices.length);
    }
  });

  // Calculate dynamic layout - constrained for 8.5x13 paper
  const isWide = maxChoices > 5;
  
  let columnsClass = 'columns-2';
  let bubbleScale = 'scale-[0.9]';
  let spaceClass = 'space-y-2';
  let textClass = 'text-sm';
  let optionsGridCols = 'grid-cols-3';
  let optionsFontSize = 'text-[11px]';

  if (exam.total_items > 60) {
    columnsClass = isWide ? 'columns-2' : 'columns-3';
    bubbleScale = isWide ? 'scale-[0.6]' : 'scale-[0.75]';
    spaceClass = 'space-y-0.5';
    textClass = 'text-[10px]';
    optionsGridCols = isWide ? 'grid-cols-2' : 'grid-cols-4';
    optionsFontSize = 'text-[9px]';
  } else if (exam.total_items > 30) {
    columnsClass = 'columns-2';
    bubbleScale = isWide ? 'scale-[0.7]' : 'scale-[0.85]';
    spaceClass = 'space-y-1';
    textClass = 'text-xs';
    optionsGridCols = isWide ? 'grid-cols-2' : 'grid-cols-3';
    optionsFontSize = 'text-[10px]';
  } else if (exam.total_items > 15) {
    columnsClass = 'columns-1';
    bubbleScale = 'scale-[0.95]';
    spaceClass = 'space-y-2';
    textClass = 'text-sm';
    optionsGridCols = 'grid-cols-4';
    optionsFontSize = 'text-xs';
  }

  return (
    <div className="w-[215.9mm] h-[330.2mm] bg-white p-12 relative font-sans text-black box-border mx-auto" style={{
      width: '8.5in',
      height: '13in',
      backgroundColor: '#ffffff',
      position: 'relative',
      fontFamily: 'Arial, sans-serif',
      lineHeight: '1.2'
    }}>
      {/* HIGH-CONTRAST CORNER MARKERS for instant OpenCV detection */}
      {/* Top Left - Thick black corner */}
      <div className="absolute top-3 left-3 w-10 h-10 border-6 border-black border-r-0 border-b-0 marker-tl" style={{
        boxShadow: 'inset 0 0 2px #000, 0 0 2px #000'
      }} />
      {/* Top Right - Thick black corner */}
      <div className="absolute top-3 right-3 w-10 h-10 border-6 border-black border-l-0 border-b-0 marker-tr" style={{
        boxShadow: 'inset 0 0 2px #000, 0 0 2px #000'
      }} />
      {/* Bottom Left - Thick black corner */}
      <div className="absolute bottom-3 left-3 w-10 h-10 border-6 border-black border-r-0 border-t-0 marker-bl" style={{
        boxShadow: 'inset 0 0 2px #000, 0 0 2px #000'
      }} />
      {/* Bottom Right - Thick black corner */}
      <div className="absolute bottom-3 right-3 w-10 h-10 border-6 border-black border-l-0 border-t-0 marker-br" style={{
        boxShadow: 'inset 0 0 2px #000, 0 0 2px #000'
      }} />

      {/* Header Section */}
      <div className="flex justify-between items-start mb-6 border-b-2 border-black pb-4">
        {useCustomHeader && customHeaderHtml ? (
          renderCustomHeader()
        ) : (
          <div className="flex-1">
            <h1 className="text-2xl font-extrabold uppercase tracking-wider mb-1 text-indigo-700">{schoolName}</h1>
            <h2 className="text-lg font-bold text-gray-800">{exam.title}</h2>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm font-medium">
              <div>
                <span className="font-bold text-indigo-600">Name:</span> <span className="underline decoration-dotted underline-offset-4 decoration-indigo-300">{student.name}</span>
              </div>
              <div>
                <span className="font-bold text-indigo-600">Section:</span> <span className="underline decoration-dotted underline-offset-4 decoration-indigo-300">{student.class_section}</span>
              </div>
              <div>
                <span className="font-bold text-indigo-600">ID Number:</span> <span className="underline decoration-dotted underline-offset-4 decoration-indigo-300">{student.student_id_number}</span>
              </div>
              <div>
                <span className="font-bold">Date:</span> <span className="underline decoration-dotted underline-offset-4">_______________________</span>
              </div>
            </div>
          </div>
        )}
        
        {/* QR Code - HIGH VISIBILITY */}
        <div className="ml-4 border-4 border-black p-0 shrink-0 bg-white shadow-lg" style={{
          minWidth: '140px',
          width: '140px',
          height: '140px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div className="text-xs font-bold text-center mb-0.5 text-black w-full">QR</div>
          <div style={{ width: '100%', height: '110px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <QRGenerator payload={qrPayload} size={110} />
          </div>
          <div className="text-[7px] text-center mt-0.5 font-mono font-bold text-black w-full break-all px-1">{student.student_id_number}</div>
        </div>
      </div>

      {/* Instructions */}
      <div className="mb-6 bg-blue-50/80 p-4 text-sm border-2 border-blue-200 rounded-2xl text-blue-900 shadow-sm">
        <span className="font-bold text-blue-700">💡 INSTRUCTIONS:</span> Use a black or blue pen to completely shade the bubble corresponding to your answer. Do not use check marks or X marks. Erase cleanly if you want to change your answer.
        <div className="flex gap-4 mt-3 font-medium">
          <span className="flex items-center gap-1.5"><span className="text-green-600">Correct:</span> <span className="inline-block w-4 h-4 bg-black rounded-full"></span></span>
          <span className="flex items-center gap-1.5"><span className="text-red-500">Incorrect:</span> <span className="inline-flex w-4 h-4 border-2 border-red-400 rounded-full items-center justify-center text-[10px] text-red-500 font-bold leading-none">x</span></span>
        </div>
      </div>

      {/* Body: Questions Layout */}
      <div className={`gap-8 ${columnsClass}`}>
        {exam.answer_key.sections.map((section, sIdx) => (
          <div key={sIdx} className="mb-6">
            <div className="break-inside-avoid mb-4">
              <h3 className="font-extrabold text-sm uppercase tracking-wider bg-purple-100 text-purple-800 rounded-full px-4 py-1.5 inline-block border border-purple-200 shadow-sm">{section.name}</h3>
              
              {(section.type === 'matching' || section.type === 'word_bank') && section.choices && (
                <div className={`text-xs mt-2.5 p-2.5 bg-yellow-50 border-2 border-yellow-400 rounded-lg text-yellow-900`}>
                  <span className="font-bold block mb-2 text-yellow-800 text-[11px]">Answer Options:</span>
                  <div className={`grid ${optionsGridCols} gap-1.5`}>
                    {section.choices.map((choice, cIdx) => {
                      const letter = String.fromCharCode(65 + cIdx);
                      const isLetter = cIdx < 14; // A-N
                      return (
                        <span key={cIdx} className={`bg-white px-1 py-0.5 rounded border border-yellow-300 shadow-sm ${optionsFontSize} leading-tight`}>
                          <b>{isLetter ? letter : String.fromCharCode(65 + (cIdx % 26))}.</b> {choice.substring(0, 25)}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            
            <div className={spaceClass}>
              {section.items.map((item, iIdx) => (
                <div key={iIdx} className={`flex items-center gap-2 break-inside-avoid ${textClass}`}>
                  <span className="w-5 font-bold text-right shrink-0 text-gray-700">{item.num}.</span>
                  
                  <div className={`${bubbleScale} origin-left transition-transform`}>
                    {section.type === 'mc' && <OMRBubbles type="letters" count={4} />}
                    {section.type === 'tf' && <OMRBubbles type="tf" />}
                    
                    {(section.type === 'matching' || section.type === 'word_bank') && (
                       <OMRBubbles type="letters" count={Math.min(section.choices?.length || 10, 10)} />
                    )}
                  </div>

                  {section.type === 'fill_blank' && (
                    <div className="flex-1 border-b border-black pt-4"></div>
                  )}
                  {section.type === 'short_answer' && (
                    <div className="flex-1 border-b border-black border-dotted pt-6"></div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      
      {/* Footer */}
      <div className="absolute bottom-3 left-8 right-8 text-center text-[9px] text-gray-600 border-t border-gray-400 pt-1.5">
        <strong>ExamFlow™</strong> | Keep QR code and corner markers visible | Print at 100% scale
      </div>
    </div>
  );
}
