import React from 'react';

export function OMRBubbles({ type, count = 4 }: { type: 'letters' | 'tf' | 'numbers', count?: number }) {
  const getLabels = () => {
    if (type === 'tf') return ['T', 'F'];
    if (type === 'numbers') return Array.from({length: count}, (_, i) => (i + 1).toString());
    // letters (A, B, C, D...)
    return Array.from({length: count}, (_, i) => String.fromCharCode(65 + i));
  };

  const labels = getLabels();

  return (
    <div className="flex gap-2 omr-bubbles-group">
      {labels.map((label, i) => (
        <div 
          key={i} 
          className="w-5 h-5 rounded-full border-[1.5px] border-black flex items-center justify-center relative omr-bubble"
          data-value={label}
        >
          <span className="text-[10px] font-medium text-black/50">{label}</span>
        </div>
      ))}
    </div>
  );
}
