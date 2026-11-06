'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, LockKeyhole, Radio, ShieldCheck, Wifi } from 'lucide-react';
import { post } from '@/lib/api';
import type { User } from '@/lib/types';
import { Brand, ErrorNotice, Spinner } from './ui';

export function AuthForm({ admin = false }: { admin?: boolean }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const user = await post<User>(register ? '/auth/register' : '/auth/login', data);
      if (admin && user.role !== 'admin')
        throw new Error(
          'This account does not have administrator access. Open the customer portal.',
        );
      router.push(user.role === 'admin' ? '/admin' : '/account');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <aside className="auth-story">
        <Brand light />
        <div>
          <span className="eyebrow">CONNECT � SURF � STAY AHEAD</span>
          <h1>
            {admin ? (
              <>
                Your network.
                <br />
                One workspace.
              </>
            ) : (
              <>
                Connect.
                <br />
                Surf.
                <br />
                Stay ahead.
              </>
            )}
          </h1>
          <p>{admin ? 'Manage your network and billing.' : 'Your Wi-Fi access, in one place.'}</p>
          <div className="auth-illustration">
            <div className="signal-ring ring-one" />
            <div className="signal-ring ring-two" />
            <div className="signal-ring ring-three" />
            <span>
              <Wifi size={46} />
            </span>
            <i className="signal-dot dot-one" />
            <i className="signal-dot dot-two" />
          </div>
        </div>
        <small>
          <Radio size={15} /> WiFex
        </small>
      </aside>
      <main className="auth-main">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <Link className="subtle-link auth-back" href={admin ? '/' : '/admin/login'}>
          {admin ? 'Customer portal' : 'Operator sign in'} <ArrowRight size={15} />
        </Link>
        <div className="auth-form-wrap">
          <span className="auth-lock">
            <LockKeyhole size={22} />
          </span>
          <p className="eyebrow">{admin ? 'OPERATOR WORKSPACE' : 'YOUR WIFEX ACCOUNT'}</p>
          <h2>{register ? 'Create account' : 'Sign in'}</h2>
          <p className="muted">
            {register
              ? 'Create an account to connect, pay, and manage your access.'
              : 'Access your account.'}
          </p>
          {error && <ErrorNotice message={error} />}
          <form className="form-stack" onSubmit={submit}>
            {register && (
              <label>
                Full name
                <input
                  name="name"
                  autoComplete="name"
                  placeholder="Your full name"
                  required
                  minLength={2}
                  maxLength={80}
                />
              </label>
            )}
            <label>
              {admin ? 'Email address' : 'Phone number'}
              <input
                name={register ? 'phone' : 'identity'}
                type={admin ? 'email' : 'tel'}
                autoComplete={admin ? 'username' : 'tel'}
                placeholder={admin ? 'you@yournetwork.com' : '0712 345 678'}
                required
                maxLength={150}
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                placeholder={
                  register ? 'At least 10 characters, a letter and a number' : 'Enter your password'
                }
                required
                minLength={register ? 10 : 1}
                maxLength={128}
              />
            </label>
            <button disabled={busy} className="button primary full">
              {busy ? (
                <Spinner />
              ) : (
                <>
                  {register ? 'Create account' : 'Sign in'}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          {!admin && (
            <p className="auth-switch">
              {register ? 'Already have an account?' : 'New to Wifex?'}{' '}
              <button
                onClick={() => {
                  setRegister(!register);
                  setError('');
                }}
              >
                {register ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          )}
          <p className="secure-note">
            <ShieldCheck size={15} /> Secure sign in
          </p>
        </div>
        <footer>© {new Date().getFullYear()} WiFex.</footer>
      </main>
    </div>
  );
}
