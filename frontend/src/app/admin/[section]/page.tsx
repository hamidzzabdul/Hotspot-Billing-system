import { notFound } from 'next/navigation';
import { ManagementPage, SettingsPage } from '@/components/management';
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section === 'settings') return <SettingsPage />;
  if (
    ![
      'customers',
      'sessions',
      'payments',
      'plans',
      'vouchers',
      'routers',
      'loans',
      'support',
      'audit',
    ].includes(section)
  )
    notFound();
  return <ManagementPage key={section} section={section} />;
}
