import type { Metadata } from 'next';
import './globals.css';
import './design.css';
import './forms.css';
import './customer.css';
import './responsive.css';
import './brand.css';

export const metadata: Metadata = {
  title: 'Wifex | Hotspot Billing',
  description: 'Wi-Fi hotspot access, customer management, and billing.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
