import React, { ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  className?: string;
  header?: ReactNode;
  footer?: ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({ children, className = '', header, footer, padding = 'md' }: CardProps) {
  const paddings = {
    none: '',
    sm: 'p-3 text-sm',
    md: 'p-5',
    lg: 'p-8',
  };

  return (
    <div className={`bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden ${className}`}>
      {header && (
        <div className={`border-b border-white/10 ${paddings[padding]} bg-white/5`}>
          {header}
        </div>
      )}
      <div className={`${paddings[padding]}`}>
        {children}
      </div>
      {footer && (
        <div className={`border-t border-white/10 ${paddings[padding]} bg-white/5`}>
          {footer}
        </div>
      )}
    </div>
  );
}
