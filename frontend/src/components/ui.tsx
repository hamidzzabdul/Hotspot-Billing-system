'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, Wifi, X } from 'lucide-react';
import Link from 'next/link';

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className={`brand ${light ? 'brand-light' : ''}`} aria-label="Wifex home">
      <span className="brand-icon">
        <Wifi size={21} strokeWidth={2.4} />
      </span>
      <span className="brand-word">
        WiFe<span className="brand-x">X</span>
      </span>
    </Link>
  );
}
export function Badge({ status, children }: { status?: string; children?: ReactNode }) {
  return (
    <span className={`badge badge-${status || 'neutral'}`}>
      <span />
      {children || status?.replaceAll('_', ' ')}
    </span>
  );
}
export function Spinner() {
  return <Loader2 size={17} className="spin" aria-label="Loading" />;
}
export function Loading() {
  return (
    <div className="loading-state">
      <Spinner />
      <span>Loading your workspace…</span>
    </div>
  );
}
export function Empty({
  title = 'Nothing here yet',
  description = 'No records to display.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Wifi size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-notice" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
      {retry && <button onClick={retry}>Try again</button>}
    </div>
  );
}
export function Notice({ message, close }: { message: string; close: () => void }) {
  useEffect(() => {
    const timeout = setTimeout(close, 6000);
    return () => clearTimeout(timeout);
  }, [close]);
  return (
    <div className="toast" role="status">
      <Check size={18} />
      <span>{message}</span>
      <button onClick={close} aria-label="Dismiss notification">
        <X size={15} />
      </button>
    </div>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="modal-content">
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function Pagination({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total} record{total !== 1 ? 's' : ''} · Page {page} of {pages}
      </span>
      <div>
        <button
          className="button secondary small"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ArrowLeft size={15} />
        </button>
        <button
          className="button secondary small"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
