'use client';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, WifiOff } from 'lucide-react';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone error-page">
      <span className="empty-icon">
        <WifiOff size={25} />
      </span>
      <h1>Let’s try that connection again.</h1>
      <p>Something interrupted this page. Your saved records are still in your account.</p>
      <div>
        <button onClick={reset} className="button primary">
          <RefreshCw size={16} />
          Try again
        </button>
        <Link className="button secondary" href="/">
          <ArrowLeft size={16} />
          Back to Wifex
        </Link>
      </div>
    </main>
  );
}
