import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NamingStyle } from '../types';
import {
  formatFilenamePreview,
  getPreservedExtension,
  namingStyleLabel,
} from '../lib/naming';

interface ProposedFilenameInputProps {
  id?: string;
  ariaLabel: string;
  value: string;
  originalName: string;
  mimeType: string;
  namingStyle: NamingStyle;
  onChange: (nextValue: string) => void;
  className?: string;
}

export const ProposedFilenameInput: React.FC<ProposedFilenameInputProps> = ({
  id,
  ariaLabel,
  value,
  originalName,
  mimeType,
  namingStyle,
  onChange,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(
    null
  );

  const previewFilename = formatFilenamePreview(value, originalName, mimeType, namingStyle);
  const extension = getPreservedExtension(originalName, mimeType);
  const styleLabel = namingStyleLabel(namingStyle);

  const updateCoords = () => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxWidth = Math.min(360, window.innerWidth - 24);
    const desiredWidth = Math.max(rect.width, Math.min(320, maxWidth));
    const clampedLeft = Math.max(
      12,
      Math.min(rect.left, window.innerWidth - desiredWidth - 12)
    );
    const showBelow = rect.top < 86;
    setCoords({
      top: showBelow ? rect.bottom + 6 : rect.top - 6,
      left: clampedLeft,
      width: desiredWidth,
    });
  };

  useLayoutEffect(() => {
    if (!showPreview) return;
    updateCoords();
    const handleScrollOrResize = () => updateCoords();
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [showPreview, value, namingStyle]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  const triggerTemporaryPreview = () => {
    setShowPreview(true);
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      setShowPreview(false);
    }, 2600);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    triggerTemporaryPreview();
  };

  const handleBlur = () => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }
    setShowPreview(false);
  };

  const showBelow = inputRef.current ? inputRef.current.getBoundingClientRect().top < 86 : false;

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="text"
        aria-label={ariaLabel}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        className={className}
      />

      {showPreview &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              width: coords.width,
              transform: showBelow ? 'translateY(0)' : 'translateY(-100%)',
              zIndex: 60,
            }}
            className="pointer-events-none rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
          >
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
              <span className="font-medium text-blue-300">Live Preview</span>
              <span className="font-mono">
                {styleLabel}
                {extension ? ` · ${extension}` : ' · Google Doc'}
              </span>
            </div>
            <div className="mt-1 break-all font-mono text-xs font-medium text-white">
              {previewFilename}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
