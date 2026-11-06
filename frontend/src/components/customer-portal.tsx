'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  HandCoins,
  LockKeyhole,
  LogOut,
  Plus,
  ShieldCheck,
  Smartphone,
  Ticket as TicketIcon,
  Wifi,
  X,
} from 'lucide-react';
import { api, post, money, date, duration, ApiError } from '@/lib/api';
import type {
  Access,
  Loan,
  PageData,
  Payment,
  Plan,
  PublicConfig,
  Ticket,
  User,
} from '@/lib/types';
import { Badge, Brand, Empty, ErrorNotice, Loading, Modal, Notice, Spinner } from './ui';
type CreditInfo = {
  loans: Loan[];
  eligible: boolean;
  reason: string;
  plan?: Plan;
  totalDue: number;
  dueDays: number;
};

export function CustomerPortal({ account = false }: { account?: boolean }) {
  const [plans, setPlans] = useState<Plan[]>([]),
    [config, setConfig] = useState<PublicConfig | null>(null),
    [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [modal, setModal] = useState<
      'purchase' | 'voucher' | 'support' | 'credit' | 'password' | null
    >(null),
    [selected, setSelected] = useState<Plan | null>(null);
  const [routerId, setRouterId] = useState(''),
    [mac, setMac] = useState(''),
    [phone, setPhone] = useState(''),
    [tab, setTab] = useState('passes');
  const [access, setAccess] = useState<Access[]>([]),
    [payments, setPayments] = useState<Payment[]>([]),
    [tickets, setTickets] = useState<Ticket[]>([]),
    [credit, setCredit] = useState<CreditInfo | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null),
    [version, setVersion] = useState(0),
    [confirmedCredit, setConfirmedCredit] = useState(false);
  const [voucherAccess, setVoucherAccess] = useState<Access | null>(null);
  const [voucherId, setVoucherId] = useState('');
  const requestKey = useRef<{ payload: string; key: string } | null>(null);
  const clear = useCallback(() => setMessage(''), []);
  useEffect(() => {
    const savedVoucherId = localStorage.getItem('wifex_voucher_access') || '';
    const query = new URLSearchParams(window.location.search);
    const hasContext = query.has('mac') || query.has('router');
    const device =
      query.get('mac') || (!hasContext ? sessionStorage.getItem('wifex_device') : '') || '';
    const router =
      query.get('router') || (!hasContext ? sessionStorage.getItem('wifex_router') : '') || '';
    localStorage.removeItem('wifex_device');
    localStorage.removeItem('wifex_router');
    if (hasContext) {
      sessionStorage.removeItem('wifex_device');
      sessionStorage.removeItem('wifex_router');
    }
    let alive = true;
    Promise.all([api<Plan[]>('/public/plans'), api<PublicConfig>('/public/config')])
      .then(([p, c]) => {
        if (alive) {
          setVoucherId(savedVoucherId);
          setPlans(p);
          setConfig(c);
          if (/^([\da-f]{2}[:-]){5}[\da-f]{2}$/i.test(device) && /^[\da-f]{24}$/i.test(router)) {
            const normalizedMac = device.replaceAll('-', ':').toUpperCase();
            setMac(normalizedMac);
            setRouterId(router);
            sessionStorage.setItem('wifex_device', normalizedMac);
            sessionStorage.setItem('wifex_router', router);
          }
        }
      })
      .catch((err) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    api<User>('/auth/me')
      .then((value) => {
        if (alive) {
          setUser(value);
          setPhone(value.phone || '');
          const pending =
            localStorage.getItem(`wifex_pending_${value._id}`) ||
            localStorage.getItem('wifex_pending_guest');
          if (pending)
            api<Payment>(`/payments/${pending}`)
              .then(setPayment)
              .catch(() => localStorage.removeItem(`wifex_pending_${value._id}`));
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401 && alive) {
          const pending = localStorage.getItem('wifex_pending_guest');
          if (pending)
            api<Payment>('/payments/' + pending)
              .then((value) => {
                if (alive) setPayment(value);
              })
              .catch(() => localStorage.removeItem('wifex_pending_guest'));
        } else if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = () =>
      Promise.all([
        api<PageData<Access>>('/me/sessions?limit=100'),
        api<PageData<Payment>>('/me/payments?limit=100'),
        api<PageData<Ticket>>('/me/tickets?limit=100'),
        api<CreditInfo>('/me/loans'),
      ])
        .then(([a, p, t, c]) => {
          if (alive) {
            setAccess(a.items);
            setPayments(p.items);
            setTickets(t.items);
            setCredit(c);
          }
        })
        .catch((err) => {
          if (alive) setError(err.message);
        });
    load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [user, version]);
  useEffect(() => {
    if (!payment) return;
    const trackAccess =
      payment.status === 'completed' &&
      payment.kind === 'purchase' &&
      !['expired', 'disconnected'].includes(payment.access?.status || '');
    if (!['initiating', 'pending', 'review'].includes(payment.status) && !trackAccess) return;
    let alive = true;
    const timer = setInterval(
      () => {
        api<Payment>(`/payments/${payment._id}`)
          .then((value) => {
            if (!alive) return;
            setPayment(value);
            if (['completed', 'failed'].includes(value.status)) {
              sessionStorage.removeItem(`wifex_request_${user?._id || 'guest'}`);
              requestKey.current = null;
            }
            if (value.status === 'completed' && payment.status !== 'completed') {
              setVersion((v) => v + 1);
              setMessage('Payment received. Your access is being prepared.');
            }
          })
          .catch((err) => {
            if (alive) setError(err.message);
          });
      },
      ['review', 'completed'].includes(payment.status) ? 15000 : 3000,
    );
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [payment, user]);
  useEffect(() => {
    if (!voucherId) return;
    let alive = true;
    const load = () =>
      api<Access>(`/access/${voucherId}`)
        .then((value) => {
          if (alive) setVoucherAccess(value);
        })
        .catch((err) => {
          if (!alive) return;
          if (err instanceof ApiError && [401, 404].includes(err.status)) {
            localStorage.removeItem('wifex_voucher_access');
            setVoucherId('');
            setVoucherAccess(null);
          } else setError(err.message);
        });
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [voucherId]);
  const show = (next: typeof modal, plan?: Plan) => {
    setModal(next);
    setSelected(plan || null);
    setError('');
    setConfirmedCredit(false);
  };
  const reload = () => setVersion((value) => value + 1);
  function keyFor(payload: string) {
    if (requestKey.current?.payload !== payload) {
      const stored = sessionStorage.getItem(`wifex_request_${user?._id || 'guest'}`);
      let previous: { payload: string; key: string } | null = null;
      try {
        previous = stored ? JSON.parse(stored) : null;
      } catch {
        /* Ignore malformed local state. */
      }
      requestKey.current =
        previous?.payload === payload ? previous : { payload, key: crypto.randomUUID() };
      sessionStorage.setItem(
        `wifex_request_${user?._id || 'guest'}`,
        JSON.stringify(requestKey.current),
      );
    }
    return requestKey.current!.key;
  }
  function rememberPayment(result: Payment) {
    setPayment(result);
    localStorage.setItem(`wifex_pending_${user?._id || 'guest'}`, result._id);
    if (['completed', 'failed'].includes(result.status)) {
      sessionStorage.removeItem(`wifex_request_${user?._id || 'guest'}`);
      requestKey.current = null;
    }
    setModal(null);
  }
  async function perform(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function purchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const payload = {
      planId: selected._id,
      expectedPrice: selected.price,
      routerId,
      macAddress: mac,
      phone,
    };
    await perform(async () => {
      if (!user) await post('/checkout/session');
      rememberPayment(
        await post<Payment>('/payments', {
          ...payload,
          idempotencyKey: keyFor(JSON.stringify(payload)),
        }),
      );
    });
  }
  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get('code');
    await perform(async () => {
      const result = await post<{ accessId: string }>('/vouchers/redeem', {
        code,
        routerId,
        macAddress: mac,
      });
      localStorage.setItem('wifex_voucher_access', result.accessId);
      setVoucherId(result.accessId);
      setModal(null);
      setMessage('Voucher redeemed. We’re preparing your connection.');
      reload();
    });
  }
  async function support(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await perform(async () => {
      await post('/me/tickets', data);
      setModal(null);
      setMessage('Message sent. Follow the conversation in your account.');
      reload();
    });
  }
  async function logout() {
    await perform(async () => {
      await post('/auth/logout');
      setUser(null);
      setAccess([]);
      setPayments([]);
      setTickets([]);
      setPayment(null);
    });
  }
  async function connect(accessId: string, fromPayment = false, fromVoucher = false) {
    await perform(async () => {
      const credentials = await api<{ username: string; password: string; loginUrl: string }>(
        fromVoucher
          ? `/access/${accessId}/credentials`
          : fromPayment
            ? `/payments/${accessId}/credentials`
            : `/me/sessions/${accessId}/credentials`,
      );
      const form = document.createElement('form');
      form.action = credentials.loginUrl;
      form.method = 'POST';
      for (const [key, value] of Object.entries({
        username: credentials.username,
        password: credentials.password,
      })) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    });
  }
  async function borrow() {
    await perform(async () => {
      await post('/me/loans', { routerId, macAddress: mac, acceptTerms: confirmedCredit });
      setModal(null);
      setMessage('Internet credit approved. Your access is being prepared.');
      reload();
    });
  }
  async function repay(loan: Loan) {
    await perform(async () =>
      rememberPayment(
        await post<Payment>(`/me/loans/${loan._id}/repay`, {
          idempotencyKey: keyFor(`loan:${loan._id}`),
        }),
      ),
    );
  }
  async function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = Object.fromEntries(new FormData(form));
    await perform(async () => {
      await post('/auth/password', data);
      form.reset();
      setModal(null);
      setMessage('Password updated.');
    });
  }
  const deviceFields = (
    <>
      {(!mac || !routerId) && (
        <div className="info-banner" role="status">
          <Smartphone size={17} />
          <span>Connect to WiFex Wi-Fi and open its sign-in page to continue.</span>
        </div>
      )}
      {mac && (
        <p className="device-note">
          <Smartphone size={14} />
          This device <code>{mac}</code>
        </p>
      )}
    </>
  );
  const loginPrompt = (
    <div className="signin-prompt">
      <LockKeyhole size={28} />
      <h3>Sign in to your account</h3>
      <p>Manage your access, payments, and support.</p>
      <Link href="/login" className="button primary full">
        Sign in
        <ArrowRight size={17} />
      </Link>
    </div>
  );
  return (
    <div className="customer-site">
      <header className="customer-header">
        <Brand />
        {account && (
          <>
            <nav aria-label="Customer navigation">
              <Link href="/connect">Plans</Link>
              <Link href="/account" className="active">
                Account
              </Link>
            </nav>
            {user && (
              <button className="icon-button" onClick={logout} aria-label="Sign out">
                <LogOut size={18} />
              </button>
            )}
          </>
        )}
      </header>
      {message && <Notice message={message} close={clear} />}
      <main className="customer-main">
        {error && !modal && <ErrorNotice message={error} />}
        {voucherAccess && (
          <section className="payment-progress" aria-live="polite">
            <TicketIcon size={23} />
            <div>
              <strong>
                {voucherAccess.status === 'active'
                  ? 'Voucher ready'
                  : ['expired', 'disconnected'].includes(voucherAccess.status)
                    ? 'Voucher access ended'
                    : 'Preparing your connection'}
              </strong>
              <p>
                {voucherAccess.planName}
                {voucherAccess.lastError ? ' � Connection delayed. We�re retrying.' : ''}
              </p>
            </div>
            {voucherAccess.status === 'active' && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => connect(voucherAccess._id, false, true)}
              >
                Connect device
                <ArrowUpRight size={16} />
              </button>
            )}
          </section>
        )}
        {payment && (
          <section className={`payment-progress payment-${payment.status}`} aria-live="polite">
            <span className="payment-progress-icon">
              {payment.status === 'completed' ? <Check size={23} /> : <Spinner />}
            </span>
            <div>
              <strong>
                {payment.status === 'completed'
                  ? 'Payment received. You’re almost online.'
                  : payment.status === 'failed'
                    ? 'This payment didn’t go through.'
                    : payment.status === 'review'
                      ? 'We’re checking your payment.'
                      : 'Check your phone to complete payment.'}
              </strong>
              <p>
                {payment.status === 'completed'
                  ? `Receipt ${payment.receipt}. ${payment.access?.status === 'active' ? 'Your device is ready to connect.' : ['expired', 'disconnected'].includes(payment.access?.status || '') ? 'This access pass has ended.' : 'We’re preparing your connection. Keep this page open.'}`
                  : payment.status === 'failed'
                    ? payment.failureReason
                    : payment.status === 'review'
                      ? 'Confirmation is taking longer than expected. Contact support before paying again.'
                      : `${money(payment.amount)} · Approve the payment prompt on your phone. Keep this page open.`}
              </p>
            </div>
            {payment.status === 'completed' && (
              <>
                {payment.access?.status === 'active' && (
                  <button
                    className="button primary small"
                    disabled={busy}
                    onClick={() => connect(payment._id, true)}
                  >
                    Connect device
                    <ArrowUpRight size={15} />
                  </button>
                )}
                <a
                  href={`/api/payments/${payment._id}/receipt`}
                  className="button secondary small"
                  download
                >
                  Receipt
                  <ArrowDownToLine size={15} />
                </a>
              </>
            )}
            {(payment.status === 'failed' ||
              (payment.status === 'completed' &&
                (user || ['expired', 'disconnected'].includes(payment.access?.status || '')))) && (
              <button
                className="icon-button"
                aria-label="Dismiss payment status"
                onClick={() => {
                  localStorage.removeItem(`wifex_pending_${user?._id || 'guest'}`);
                  sessionStorage.removeItem(`wifex_request_${user?._id || 'guest'}`);
                  setPayment(null);
                  requestKey.current = null;
                }}
              >
                <X size={16} />
              </button>
            )}
          </section>
        )}
        {loading ? (
          <Loading />
        ) : account ? (
          <>
            <div className="customer-account-heading">
              <p className="eyebrow">ACCOUNT</p>
              <h1>{user ? `${user.name.split(' ')[0]}�s account` : 'Your account'}</h1>
              <p>Manage your access, payments, and support.</p>
            </div>
            {!user ? (
              loginPrompt
            ) : (
              <>
                <div className="account-summary">
                  <div>
                    <span className="summary-symbol">
                      <Wifi size={23} />
                    </span>
                    <div>
                      <small>Ready to connect</small>
                      <strong>
                        {access.filter((item) => item.status === 'active').length} active passes
                      </strong>
                    </div>
                  </div>
                  <Link href="/connect" className="button primary">
                    Buy a plan
                    <Plus size={16} />
                  </Link>
                </div>
                <div className="account-tabs" role="tablist">
                  {[
                    ['passes', 'My access'],
                    ['payments', 'Payments'],
                    ['support', 'Support'],
                    ['credit', 'Internet credit'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      role="tab"
                      aria-selected={tab === value}
                      className={tab === value ? 'active' : ''}
                      onClick={() => setTab(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {tab === 'passes' && (
                  <div className="account-pass-list">
                    {access.length ? (
                      access.map((item) => (
                        <article className="panel access-card" key={item._id}>
                          <div className="access-icon">
                            <Wifi size={25} />
                          </div>
                          <div className="access-details">
                            <h3>{item.planName}</h3>
                            <p>
                              {item.router?.name} · {item.speedMbps} Mbps · {item.macAddress}
                            </p>
                            <small>
                              {item.expiresAt
                                ? `Expires ${date(item.expiresAt, true)}`
                                : 'Connection time starts during provisioning'}
                            </small>
                            {item.lastError && (
                              <p className="inline-error">
                                We couldn’t prepare your connection yet. Support can help.
                              </p>
                            )}
                          </div>
                          <Badge status={item.status} />
                          {item.status === 'active' && (
                            <button
                              disabled={busy}
                              className="button primary"
                              onClick={() => connect(item._id)}
                            >
                              Connect device
                              <ArrowUpRight size={16} />
                            </button>
                          )}
                        </article>
                      ))
                    ) : (
                      <div className="panel">
                        <Empty
                          title="No active passes"
                          description="Choose a plan or redeem a voucher to get online."
                          action={
                            <Link href="/connect" className="button primary">
                              View plans
                              <ArrowRight size={16} />
                            </Link>
                          }
                        />
                      </div>
                    )}
                  </div>
                )}
                {tab === 'payments' && (
                  <section className="panel">
                    {payments.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Payment</th>
                              <th>Amount</th>
                              <th>Date</th>
                              <th>Status</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {payments.map((item) => (
                              <tr key={item._id}>
                                <td>
                                  <strong>{item.planName || 'Credit repayment'}</strong>
                                  <small className="cell-subtext mono">
                                    {item.receipt || item.reference}
                                  </small>
                                </td>
                                <td className="amount">{money(item.amount)}</td>
                                <td>{date(item.createdAt, true)}</td>
                                <td>
                                  <Badge status={item.status} />
                                </td>
                                <td>
                                  {item.status === 'completed' && (
                                    <a
                                      href={`/api/payments/${item._id}/receipt`}
                                      className="icon-button"
                                      download
                                      aria-label="Download receipt"
                                    >
                                      <ArrowDownToLine size={17} />
                                    </a>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="No payments yet"
                        description="Receipts appear here after payment."
                      />
                    )}
                  </section>
                )}
                {tab === 'support' && (
                  <>
                    <div className="account-section-heading">
                      <h2>Your conversations</h2>
                      <button className="button secondary" onClick={() => show('support')}>
                        <Plus size={16} />
                        New message
                      </button>
                    </div>
                    {tickets.length ? (
                      tickets.map((item) => (
                        <article className="panel customer-ticket" key={item._id}>
                          <div>
                            <h3>{item.subject}</h3>
                            <Badge status={item.status} />
                          </div>
                          <p>{item.message}</p>
                          <small className="muted">{date(item.createdAt, true)}</small>
                          {item.replies.map((reply, i) => (
                            <div className="reply" key={i}>
                              <strong>{reply.author}</strong>
                              <p>{reply.message}</p>
                              <small>{date(reply.createdAt, true)}</small>
                            </div>
                          ))}
                          <form
                            className="form-stack ticket-reply-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const form = event.currentTarget;
                              const message = new FormData(form).get('message');
                              void perform(async () => {
                                await post(`/me/tickets/${item._id}/replies`, { message });
                                form.reset();
                                reload();
                                setMessage('Reply sent to your network operator.');
                              });
                            }}
                          >
                            <label>
                              Reply
                              <textarea
                                name="message"
                                required
                                minLength={2}
                                maxLength={2000}
                                rows={2}
                                placeholder="Add a reply…"
                              />
                            </label>
                            <button disabled={busy} className="button secondary fit">
                              Send reply
                              <ArrowRight size={15} />
                            </button>
                          </form>
                        </article>
                      ))
                    ) : (
                      <div className="panel">
                        <Empty
                          title="No support messages"
                          description="If something comes up, send us a message. We’re here to help."
                        />
                      </div>
                    )}
                  </>
                )}
                {tab === 'credit' && (
                  <>
                    <div className="credit-intro panel">
                      <HandCoins size={30} />
                      <div>
                        <h2>Internet credit</h2>
                        <p>{credit?.reason}</p>
                      </div>
                      <button
                        className="button primary"
                        disabled={!credit?.eligible}
                        onClick={() => show('credit')}
                      >
                        Borrow access
                        <ArrowRight size={16} />
                      </button>
                    </div>
                    {credit?.loans.map((loan) => (
                      <article className="panel loan-card" key={loan._id}>
                        <div>
                          <h3>{loan.planName}</h3>
                          <p>
                            {money(loan.amount)} borrowed · {money(loan.totalDue)} total due · Due{' '}
                            {date(loan.dueAt)}
                          </p>
                        </div>
                        <Badge status={loan.status} />
                        {loan.open && (
                          <button
                            disabled={busy || config?.paymentMode === 'disabled'}
                            className="button secondary"
                            onClick={() => repay(loan)}
                          >
                            Repay with M-Pesa
                          </button>
                        )}
                      </article>
                    ))}
                  </>
                )}
                <div className="account-footer">
                  <span>
                    <ShieldCheck size={15} />
                    Signed in as {user.phone || user.email}
                  </span>
                  <button className="subtle-link" onClick={() => show('password')}>
                    Change password
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <section className="customer-plans" id="plans">
              <div className="plans-section-heading">
                <div>
                  <h1>Choose your plan</h1>
                </div>
                <button className="button secondary" onClick={() => show('voucher')}>
                  <TicketIcon size={17} />
                  Redeem voucher
                </button>
              </div>
              <div className="customer-plan-grid">
                {plans.map((plan) => (
                  <article
                    className={`customer-plan ${plan.popular ? 'featured-plan' : ''}`}
                    key={plan._id}
                  >
                    {plan.popular && <span className="popular-ribbon">POPULAR</span>}
                    <span className="plan-duration">
                      <Clock3 size={16} />
                      {duration(plan.durationMinutes)}
                    </span>
                    <h3>{plan.name}</h3>

                    <div className="customer-plan-price">
                      <small>KES</small>
                      {plan.price}
                      <span>/ {duration(plan.durationMinutes)}</span>
                    </div>
                    <div className="plan-features">
                      <span>
                        <Check size={15} />
                        Up to {plan.speedMbps} Mbps
                      </span>
                      <span>
                        <Check size={15} />1 device
                      </span>
                    </div>
                    <button
                      className={`button full ${plan.popular ? 'primary' : 'secondary'}`}
                      onClick={() => show('purchase', plan)}
                    >
                      Choose plan
                      <ArrowRight size={17} />
                    </button>
                  </article>
                ))}
              </div>
              {!plans.length && (
                <Empty title="No plans available" description="Please check back later." />
              )}
            </section>
          </>
        )}
      </main>
      {modal && (
        <Modal
          title={
            modal === 'purchase'
              ? selected?.name || 'Get connected'
              : modal === 'voucher'
                ? 'Redeem voucher'
                : modal === 'support'
                  ? 'Let’s get you sorted.'
                  : modal === 'password'
                    ? 'Change password'
                    : 'Internet credit'
          }
          description={
            modal === 'purchase'
              ? `${money(selected?.price || 0)} · ${duration(selected?.durationMinutes || 0)} · ${selected?.speedMbps} Mbps`
              : modal === 'voucher'
                ? 'Enter your prepaid voucher code below.'
                : undefined
          }
          onClose={() => {
            if (!busy) {
              setModal(null);
              setError('');
            }
          }}
        >
          {!user && modal !== 'purchase' && modal !== 'voucher' ? (
            loginPrompt
          ) : (
            <>
              {error && <ErrorNotice message={error} />}
              {modal === 'purchase' && (
                <form className="form-stack" onSubmit={purchase}>
                  {!user && (
                    <p className="form-help">No account needed. Enter your M-Pesa number.</p>
                  )}
                  {deviceFields}
                  <label>
                    M-Pesa phone number
                    <input
                      type="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      required
                      placeholder="0712 345 678"
                    />
                  </label>
                  <p className="secure-note">
                    <LockKeyhole size={14} />
                    Enter your PIN only on your phone. We’ll never ask for it here.
                  </p>
                  <button
                    disabled={busy || !mac || !routerId || config?.paymentMode === 'disabled'}
                    className="button primary full"
                  >
                    {busy ? (
                      <Spinner />
                    ) : (
                      <>
                        Pay {money(selected?.price || 0)} with M-Pesa
                        <ArrowRight size={17} />
                      </>
                    )}
                  </button>
                  {config?.paymentMode === 'disabled' && (
                    <p className="inline-error">
                      M-Pesa payments are not available yet. Try a voucher or contact support.
                    </p>
                  )}
                </form>
              )}
              {modal === 'voucher' && (
                <form className="form-stack" onSubmit={redeem}>
                  {deviceFields}
                  <label>
                    Voucher code
                    <input
                      name="code"
                      required
                      placeholder="WF-XXXXXXXXXXXX"
                      autoComplete="off"
                      minLength={6}
                      maxLength={50}
                      className="mono"
                    />
                  </label>
                  <button disabled={busy || !mac || !routerId} className="button primary full">
                    {busy ? (
                      <Spinner />
                    ) : (
                      <>
                        Redeem voucher
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </form>
              )}
              {modal === 'support' && (
                <form className="form-stack" onSubmit={support}>
                  <label>
                    What do you need help with?
                    <input
                      name="subject"
                      required
                      minLength={4}
                      maxLength={120}
                      placeholder="e.g. Paid, but not connected"
                    />
                  </label>
                  <label>
                    Payment reference (optional)
                    <input
                      name="reference"
                      maxLength={80}
                      placeholder="M-Pesa receipt or Wifex reference"
                    />
                  </label>
                  <label>
                    Tell us a little more
                    <textarea
                      name="message"
                      rows={4}
                      minLength={10}
                      maxLength={2000}
                      required
                      placeholder="What happened? We’ll help you work it out."
                    />
                  </label>
                  <button disabled={busy} className="button primary full">
                    {busy ? <Spinner /> : 'Send message'}
                  </button>
                </form>
              )}
              {modal === 'credit' && (
                <div className="form-stack">
                  {deviceFields}
                  <div className="credit-terms">
                    <div>
                      <span>Access plan</span>
                      <strong>{credit?.plan?.name}</strong>
                    </div>
                    <div>
                      <span>Principal</span>
                      <strong>{money(credit?.plan?.price || 0)}</strong>
                    </div>
                    <div>
                      <span>Total to repay</span>
                      <strong>{money(credit?.totalDue || 0)}</strong>
                    </div>
                    <div>
                      <span>Repayment period</span>
                      <strong>{credit?.dueDays} days</strong>
                    </div>
                  </div>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={confirmedCredit}
                      onChange={(event) => setConfirmedCredit(event.target.checked)}
                    />
                    I agree to repay {money(credit?.totalDue || 0)} within {credit?.dueDays} days,
                    including the service charge.
                  </label>
                  <button
                    className="button primary"
                    disabled={busy || !confirmedCredit || !mac || !routerId}
                    onClick={borrow}
                  >
                    {busy ? <Spinner /> : 'Confirm borrowed access'}
                  </button>
                </div>
              )}
              {modal === 'password' && (
                <form className="form-stack" onSubmit={password}>
                  <label>
                    Current password
                    <input
                      name="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </label>
                  <label>
                    New password
                    <input
                      name="newPassword"
                      type="password"
                      minLength={10}
                      maxLength={128}
                      required
                      autoComplete="new-password"
                      placeholder="10+ characters, a letter and a number"
                    />
                  </label>
                  <button disabled={busy} className="button primary">
                    {busy ? <Spinner /> : 'Update password'}
                  </button>
                </form>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
