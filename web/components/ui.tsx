import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Inbox, AlertTriangle, X } from "lucide-react";

export function Button({ children, variant = "primary", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <button className={`button button--${variant} ${className}`} {...props}>{children}</button>;
}

export function Field({label,error,hint,children}:{label:string;error?:string;hint?:string;children:ReactNode}){return <label className="field"><span>{label}</span>{children}{error&&<small className="field-error">{error}</small>}{hint&&!error&&<small>{hint}</small>}</label>}
export function Notice({tone="info",children}:{tone?:"info"|"success"|"danger"|"warning";children:ReactNode}){return <div className={`notice notice--${tone}`}>{tone!=="success"&&<AlertTriangle size={16}/>}<span>{children}</span></div>}
export function Modal({title,children,onClose,locked=false}:{title:string;children:ReactNode;onClose:()=>void;locked?:boolean}){return <div className="modal-backdrop" onMouseDown={e=>{if(!locked&&e.target===e.currentTarget)onClose()}}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2>{!locked&&<button aria-label="Close" onClick={onClose}><X size={18}/></button>}</header>{children}</section></div>}
export function Spinner({label="Loading"}:{label?:string}){return <div className="loading"><span className="spinner"/>{label}…</div>}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "success" | "warning" | "danger" | "neutral" }) {
  return <span className={`badge badge--${tone}`}><span className="badge__dot" />{children}</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Skeleton({ className = "" }: { className?: string }) { return <span className={`skeleton ${className}`} />; }

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty"><span className="empty__icon"><Inbox size={22} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  const visible = Array.from({ length: Math.min(pages, 3) }, (_, i) => Math.max(1, Math.min(page - 1, pages - 2)) + i);
  return <nav className="pagination" aria-label="Pagination"><button aria-label="Previous page" disabled={page === 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16} /></button>{visible.map(n => <button className={n === page ? "active" : ""} aria-current={n === page ? "page" : undefined} key={n} onClick={() => onChange(n)}>{n}</button>)}<button aria-label="Next page" disabled={page === pages} onClick={() => onChange(page + 1)}><ChevronRight size={16} /></button></nav>;
}
