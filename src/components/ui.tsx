import { useEffect, useRef } from 'react';
import { Activity, ArrowUpRight, Check, FileText, FlaskConical, HeartPulse, Pill, X } from 'lucide-react';
import type { HealthRecord, Language, Localized, RecordType } from '../../shared/types';
import type { ReactNode } from 'react';

export const local = (value: Localized, language: Language) => value[language] || value.en;
export const dateLabel = (value: string | null, short = false, language: Language = 'en') => value ? new Date(`${value.slice(0,10)}T12:00:00`).toLocaleDateString(language === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: short ? 'short' : 'long', ...(short ? {} : { year: 'numeric' }) }) : (language === 'hi' ? 'तारीख उपलब्ध नहीं' : 'Date not recorded');
export const typeLabels: Record<RecordType, [string, string]> = { lab: ['Lab report', 'लैब रिपोर्ट'], prescription: ['Prescription', 'पर्चा'], discharge: ['Discharge summary', 'डिस्चार्ज सारांश'], diagnostic: ['Diagnostic record', 'जाँच रिकॉर्ड'] };
export const RecordIcon = ({ type, size = 21 }: { type: RecordType; size?: number }) => type === 'lab' ? <FlaskConical size={size} /> : type === 'prescription' ? <Pill size={size} /> : type === 'diagnostic' ? <HeartPulse size={size} /> : <FileText size={size} />;
export function Brand({ compact = false }: { compact?: boolean }) { return <div className="brand"><span className="brand-mark"><span /><i /></span>{!compact && <span>sehat<span className="brand-dot">.</span></span>}</div>; }
export function Badge({ children, tone = 'green' }: { children: ReactNode; tone?: string }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><span className="empty-icon"><FileText size={28} /></span><h3>{title}</h3><p>{text}</p>{action}</div>; }
export function Modal({ children, title, onClose, wide = false }: { children: ReactNode; title: string; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const focusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, select, a[href], [tabindex="0"]') || []);
    focusable()[0]?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') { const els = focusable(); if (!els.length) return; if (e.shiftKey && document.activeElement === els[0]) { e.preventDefault(); els.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === els.at(-1)) { e.preventDefault(); els[0]?.focus(); } }
    };
    document.addEventListener('keydown', listener); const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', listener); document.body.style.overflow = old; previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={21} /></button></header>{children}</div></div>;
}
export function RecordRow({ record, language, onClick }: { record: HealthRecord; language: Language; onClick: () => void }) {
  return <button className="record-row" onClick={onClick}><span className={`record-icon type-${record.type}`}><RecordIcon type={record.type} /></span><span className="record-row-main"><strong>{record.title}</strong><span>{record.provider || 'Provider not recorded'} <i>·</i> {dateLabel(record.date, true, language)}</span></span><span className="record-row-status">{record.reviewStatus === 'reviewed' ? <Badge><Check size={11} />{language === 'hi' ? 'जाँचा गया' : 'Reviewed'}</Badge> : <Badge tone="amber">{language === 'hi' ? 'समीक्षा करें' : 'To review'}</Badge>}</span><ArrowUpRight size={17} className="muted" /></button>;
}
export function SafetyNote({ language }: { language: Language }) { return <div className="safety-note"><Activity size={15} /><span>{language === 'hi' ? 'जानकारी समझने के लिए, निदान के लिए नहीं। इलाज में बदलाव से पहले अपने डॉक्टर से बात करें।' : 'Here to help you understand, not diagnose. Discuss treatment decisions with your doctor.'}</span></div>; }
