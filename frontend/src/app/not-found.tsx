import Link from 'next/link';
import { ArrowLeft, MapPin } from 'lucide-react';
export default function NotFound() {
  return (
    <main className="standalone error-page">
      <span className="empty-icon">
        <MapPin size={25} />
      </span>
      <p className="eyebrow">404 · A LITTLE OFF THE MAP</p>
      <h1>This page isn’t on our network.</h1>
      <p>Let’s get you back to a familiar place.</p>
      <Link href="/" className="button primary">
        <ArrowLeft size={16} />
        Back to Wifex
      </Link>
    </main>
  );
}
