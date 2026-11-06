'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Radio,
  Ticket,
  Package,
  Settings,
  LifeBuoy,
  ArrowUpRight,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Activity,
  HandCoins,
  ScrollText,
} from 'lucide-react';
import { api, post, ApiError } from '@/lib/api';
import type { User } from '@/lib/types';
import { Brand, ErrorNotice, Loading } from './ui';
const navigation = [
  { href: '/admin', title: 'Overview', icon: LayoutDashboard },
  { href: '/admin/customers', title: 'Customers', icon: Users },
  { href: '/admin/sessions', title: 'Sessions', icon: Activity },
  { href: '/admin/payments', title: 'Payments', icon: CreditCard },
  { href: '/admin/plans', title: 'Internet plans', icon: Package },
  { href: '/admin/vouchers', title: 'Vouchers', icon: Ticket },
  { href: '/admin/routers', title: 'Routers', icon: Radio },
  { href: '/admin/loans', title: 'Internet credit', icon: HandCoins },
];
export function AdminShell({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false);
  const path = usePathname(),
    router = useRouter();
  useEffect(() => {
    let alive = true;
    if (path === '/admin/login') return;
    api<User>('/auth/me')
      .then((value) => {
        if (!alive) return;
        if (value.role !== 'admin') router.replace('/account');
        else setUser(value);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/admin/login');
        else if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [path, router]);
  if (path === '/admin/login') return children;
  if (!user)
    return error ? (
      <main className="standalone">
        <ErrorNotice message={error} retry={() => window.location.reload()} />
        <Link href="/admin/login">Return to sign in</Link>
      </main>
    ) : (
      <Loading />
    );
  const title =
    [
      ...navigation,
      { href: '/admin/support', title: 'Support inbox' },
      { href: '/admin/settings', title: 'Settings' },
      { href: '/admin/audit', title: 'Activity log' },
    ].find((item) => item.href === path)?.title || 'Workspace';
  async function logout() {
    try {
      await post('/auth/logout');
      router.push('/admin/login');
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <div className="workspace">
      {open && <div className="sidebar-scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X size={19} />
          </button>
        </div>
        <div className="workspace-selector">
          <span className="workspace-avatar">W</span>
          <div>
            <strong>Wifex network</strong>
            <small>Operator workspace</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`nav-item ${path === item.href ? 'selected' : ''}`}
            >
              <item.icon size={18} />
              {item.title}
              {path === item.href && <span className="nav-active-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <nav aria-label="Workspace tools">
            <Link
              className={`nav-item ${path === '/admin/support' ? 'selected' : ''}`}
              href="/admin/support"
              onClick={() => setOpen(false)}
            >
              <LifeBuoy size={18} />
              Support inbox
            </Link>
            <Link
              className={`nav-item ${path === '/admin/audit' ? 'selected' : ''}`}
              href="/admin/audit"
              onClick={() => setOpen(false)}
            >
              <ScrollText size={18} />
              Activity log
            </Link>
            <Link
              className={`nav-item ${path === '/admin/settings' ? 'selected' : ''}`}
              href="/admin/settings"
              onClick={() => setOpen(false)}
            >
              <Settings size={18} />
              Settings
            </Link>
          </nav>
          <Link href="/connect" className="portal-link" target="_blank">
            Open customer portal
            <ArrowUpRight size={16} />
          </Link>
          <div className="sidebar-user">
            <span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{user.name}</strong>
              <small>Administrator</small>
            </div>
            <button className="icon-button" onClick={logout} aria-label="Sign out">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-only"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">
              Workspace <span>/</span> <strong>{title}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="timezone">Africa / Nairobi</span>
            <Link href="/admin/support" className="icon-button" aria-label="Support inbox">
              <LifeBuoy size={19} />
            </Link>
            <span className="avatar small-avatar">{user.name.slice(0, 2).toUpperCase()}</span>
          </div>
        </header>
        <main className="page-content">
          {error && <ErrorNotice message={error} />}
          {children}
        </main>
        <footer className="workspace-footer">
          <span>Wifex · Made for your everyday operations</span>
          <span>All amounts in KES</span>
        </footer>
      </div>
    </div>
  );
}
