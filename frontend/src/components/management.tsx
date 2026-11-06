'use client';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CreditCard,
  Eye,
  LifeBuoy,
  Plus,
  Radio,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Ticket as TicketIcon,
  Wifi,
} from 'lucide-react';
import Link from 'next/link';
import { api, post, patch, money, date, duration, downloadCsv } from '@/lib/api';
import type {
  Access,
  Audit,
  Loan,
  PageData,
  Payment,
  Plan,
  Router,
  Settings,
  Ticket,
  User,
  Voucher,
} from '@/lib/types';
import { Badge, Empty, ErrorNotice, Loading, Modal, Notice, Pagination, Spinner } from './ui';

const sections: Record<
  string,
  { title: string; eyebrow: string; description: string; add?: string }
> = {
  customers: {
    title: 'Customers',
    eyebrow: 'THE PEOPLE ON YOUR NETWORK',
    description: 'Look after your customers, from their first connection onward.',
    add: 'Add customer',
  },
  sessions: {
    title: 'Sessions',
    eyebrow: 'CONNECTED, IN REAL TIME',
    description: 'Monitor access passes and the devices using your network.',
  },
  payments: {
    title: 'Payments',
    eyebrow: 'EVERY PAYMENT, ACCOUNTED FOR',
    description: 'Track M-Pesa collections and resolve payments that need attention.',
  },
  plans: {
    title: 'Internet plans',
    eyebrow: 'GREAT CONNECTIONS START HERE',
    description: 'Simple options for the way your customers get online.',
    add: 'Create a plan',
  },
  vouchers: {
    title: 'Vouchers',
    eyebrow: 'ACCESS MADE SIMPLE',
    description: 'Prepaid access codes for your walk-in customers.',
    add: 'Generate vouchers',
  },
  routers: {
    title: 'Routers',
    eyebrow: 'THE HEART OF YOUR NETWORK',
    description: 'Connect, monitor, and manage your hotspot infrastructure.',
    add: 'Add router',
  },
  loans: {
    title: 'Internet credit',
    eyebrow: 'A LITTLE EXTRA CONNECTION',
    description: 'Keep track of borrowed access and M-Pesa repayments.',
  },
  support: {
    title: 'Support inbox',
    eyebrow: 'A HELPING HAND',
    description: 'Keep conversations clear and get customers back online.',
  },
  audit: {
    title: 'Activity log',
    eyebrow: 'A CLEAR RECORD',
    description: 'A timeline of important actions across your workspace.',
  },
};
type Row = User | Access | Payment | Plan | Router | Voucher | Loan | Ticket | Audit;
const paths: Record<string, string> = { support: 'tickets' };
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
export function ManagementPage({ section }: { section: string }) {
  const meta = sections[section];
  const [rows, setRows] = useState<Row[]>([]),
    [plans, setPlans] = useState<Plan[]>([]),
    [pageInfo, setPageInfo] = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1),
    [version, setVersion] = useState(0);
  const [modal, setModal] = useState<'create' | 'edit' | 'detail' | 'confirm' | null>(null),
    [selected, setSelected] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(''),
    [message, setMessage] = useState(''),
    [codes, setCodes] = useState<string[]>([]);
  const clearMessage = useCallback(() => setMessage(''), []);
  const reload = () => setVersion((value) => value + 1);
  useEffect(() => {
    if (!['sessions', 'payments', 'routers', 'support', 'loans'].includes(section)) return;
    const timer = setInterval(() => setVersion((value) => value + 1), 15000);
    return () => clearInterval(timer);
  }, [section]);
  useEffect(() => {
    if (!meta) return;
    let alive = true;
    const timer = setTimeout(
      () => {
        const endpoint = `/admin/${paths[section] || section}?page=${page}&search=${encodeURIComponent(search)}&status=${status}`;
        api<PageData<Row> | Row[]>(endpoint)
          .then((data) => {
            if (!alive) return;
            if (Array.isArray(data)) {
              setRows(data);
              setPageInfo({ total: data.length, page: 1, pages: 1 });
            } else {
              setRows(data.items);
              setPageInfo(data);
            }
            setError('');
          })
          .catch((err) => {
            if (alive) setError(err.message);
          })
          .finally(() => {
            if (alive) setLoading(false);
          });
      },
      search ? 250 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [section, page, search, status, version, meta]);
  useEffect(() => {
    if (section === 'vouchers')
      api<Plan[]>('/admin/plans')
        .then(setPlans)
        .catch(() => {});
  }, [section]);
  if (!meta) return <Empty title="Page not found" />;
  const open = (type: typeof modal, row?: Row) => {
    setSelected(row || null);
    setModal(type);
    setFormError('');
  };
  const close = () => {
    if (!busy) {
      setModal(null);
      setFormError('');
    }
  };
  async function action(
    path: string,
    body: unknown = {},
    method = 'post',
    success = 'Changes saved',
  ) {
    setBusy(true);
    setFormError('');
    try {
      const result = method === 'patch' ? await patch(path, body) : await post(path, body);
      setModal(null);
      setMessage(success);
      reload();
      return result;
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      data = Object.fromEntries(form);
    if (section === 'plans')
      await action(
        selected ? `/admin/plans/${selected._id}` : '/admin/plans',
        {
          name: data.name,
          description: data.description,
          price: Number(data.price),
          durationMinutes: Number(data.durationMinutes),
          speedMbps: Number(data.speedMbps),
          active: form.has('active'),
          popular: form.has('popular'),
        },
        selected ? 'patch' : 'post',
        selected ? 'Plan updated' : 'Your new plan is ready',
      );
    if (section === 'customers')
      await action('/admin/customers', data, 'post', 'Customer account created');
    if (section === 'routers') {
      if (!data.password) delete data.password;
      await action(
        selected ? '/admin/routers/' + selected._id : '/admin/routers',
        data,
        selected ? 'patch' : 'post',
        selected
          ? 'Router updated'
          : 'Router added. Test the connection to check your configuration.',
      );
    }
    if (section === 'vouchers') {
      setBusy(true);
      setFormError('');
      try {
        const result = await post<{ codes: string[] }>('/admin/vouchers', {
          planId: data.planId,
          count: Number(data.count),
          validityDays: Number(data.validityDays),
        });
        setCodes(result.codes);
        setModal(null);
        reload();
      } catch (err) {
        setFormError((err as Error).message);
      } finally {
        setBusy(false);
      }
    }
    if (section === 'support')
      await action(
        `/admin/tickets/${selected?._id}`,
        { status: data.status, reply: data.reply },
        'patch',
        'Support conversation updated',
      );
  }
  async function confirm() {
    if (!selected) return;
    if (section === 'customers')
      await action(
        `/admin/customers/${selected._id}`,
        { blocked: !(selected as User).blocked },
        'patch',
        (selected as User).blocked
          ? 'Customer account restored'
          : 'Customer blocked. Access revocation is queued.',
      );
    if (section === 'sessions')
      await action(
        `/admin/sessions/${selected._id}/disconnect`,
        {},
        'post',
        'Disconnection queued. The worker will revoke router access.',
      );
    if (section === 'vouchers')
      await action(`/admin/vouchers/${selected._id}/revoke`, {}, 'post', 'Voucher revoked');
  }
  const selectedPlan = selected as Plan | null;
  const selectedTicket = selected as Ticket | null;
  const statuses: Record<string, string[]> = {
    customers: ['all', 'active', 'blocked'],
    payments: ['all', 'completed', 'pending', 'review', 'failed'],
    sessions: ['all', 'active', 'queued', 'revoking', 'expired', 'disconnected'],
    support: ['all', 'open', 'in_progress', 'resolved'],
  };
  function exportRows() {
    if (section === 'payments')
      downloadCsv('wifex-payments.csv', [
        ['Reference', 'Phone', 'Plan', 'Amount (KES)', 'Status', 'Receipt', 'Date'],
        ...(rows as Payment[]).map((row) => [
          row.reference,
          row.phone,
          row.planName || 'Credit repayment',
          row.amount,
          row.status,
          row.receipt || '',
          row.createdAt,
        ]),
      ]);
    if (section === 'customers')
      downloadCsv('wifex-customers.csv', [
        ['Name', 'Phone', 'Status'],
        ...(rows as User[]).map((row) => [
          row.name,
          row.phone || '',
          row.blocked ? 'Blocked' : 'Active',
        ]),
      ]);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{meta.eyebrow}</p>
          <h1>{meta.title}</h1>
          <p>{meta.description}</p>
        </div>
        <div className="heading-actions">
          {['payments', 'customers'].includes(section) && (
            <button className="button secondary" onClick={exportRows}>
              <ArrowDownToLine size={16} />
              Export this page
            </button>
          )}
          {meta.add && (
            <button className="button primary" onClick={() => open('create')}>
              <Plus size={17} />
              {meta.add}
            </button>
          )}
        </div>
      </div>
      {message && <Notice message={message} close={clearMessage} />}
      {error && <ErrorNotice message={error} retry={reload} />}
      {formError && !modal && <ErrorNotice message={formError} />}
      {section === 'loans' && (
        <div className="info-banner">
          <ShieldCheck size={18} />
          <span>
            Credit is opt-in and backed by recent paid purchases. Configure eligibility terms in{' '}
            <Link href="/admin/settings">Settings</Link>.
          </span>
        </div>
      )}
      {section === 'routers' && (
        <div className="info-banner">
          <Radio size={18} />
          <span>
            RouterOS 7 REST API over HTTPS. Use a trusted certificate and a private VPN connection
            from your VPS.
          </span>
        </div>
      )}
      {section === 'vouchers' && (
        <div className="info-banner">
          <TicketIcon size={18} />
          <span>
            Voucher codes are shown only once when generated. Download them before closing the
            dialog.
          </span>
        </div>
      )}
      {loading ? (
        <Loading />
      ) : section === 'plans' ? (
        <div className="plan-management-grid">
          {(rows as Plan[]).map((plan) => (
            <article
              className={`plan-management-card ${!plan.active ? 'inactive-plan' : ''}`}
              key={plan._id}
            >
              <div className="plan-card-top">
                <span className="plan-symbol">
                  <Wifi size={23} />
                </span>
                <Badge status={plan.active ? 'active' : 'neutral'}>
                  {plan.active ? 'Available' : 'Paused'}
                </Badge>
              </div>
              <h2>{plan.name}</h2>
              <p>{plan.description}</p>
              <div className="plan-price">
                {money(plan.price)}
                <span>/ {duration(plan.durationMinutes)}</span>
              </div>
              <div className="plan-features">
                <span>
                  <Check size={15} />
                  {plan.speedMbps} Mbps connection
                </span>
                <span>
                  <Check size={15} />
                  {duration(plan.durationMinutes)} of access
                </span>
                <span>
                  <Check size={15} />
                  One device at a time
                </span>
              </div>
              {plan.popular && <p className="popular-note">Featured in the customer portal</p>}
              <button className="button secondary full" onClick={() => open('edit', plan)}>
                Edit plan
                <ArrowUpRight size={15} />
              </button>
            </article>
          ))}
          <button className="add-plan-card" onClick={() => open('create')}>
            <span>
              <Plus size={25} />
            </span>
            <strong>Make room for a new plan</strong>
            <p>Set the price, speed, and connection time.</p>
          </button>
        </div>
      ) : section === 'routers' ? (
        <div className="router-grid">
          {(rows as Router[]).map((router) => (
            <article className="panel router-card" key={router._id}>
              <div className="router-card-top">
                <span className="router-symbol">
                  <Radio size={26} />
                </span>
                <Badge status={router.enabled ? router.status : 'neutral'}>
                  {router.enabled ? router.status : 'Disabled'}
                </Badge>
              </div>
              <h2>{router.name}</h2>
              <p className="muted">{router.location || 'No location set'}</p>
              <dl>
                <div>
                  <dt>REST endpoint</dt>
                  <dd>{router.baseUrl}</dd>
                </div>
                <div>
                  <dt>Connected devices</dt>
                  <dd>{router.connected}</dd>
                </div>
                <div>
                  <dt>Uptime</dt>
                  <dd>{router.uptime || '—'}</dd>
                </div>
                <div>
                  <dt>Last checked</dt>
                  <dd>{date(router.lastChecked, true)}</dd>
                </div>
              </dl>
              {router.error && <p className="inline-error">{router.error}</p>}
              <div className="router-actions">
                <button className="button secondary" onClick={() => open('edit', router)}>
                  Edit
                </button>
                <button
                  disabled={busy || !router.enabled}
                  className="button secondary"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await post<{ message: string }>(
                        `/admin/routers/${router._id}/test`,
                      );
                      setMessage(result.message);
                      reload();
                    } catch (err) {
                      setFormError((err as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Test connection
                </button>
                <button
                  disabled={busy}
                  className="subtle-link"
                  onClick={() =>
                    action(
                      `/admin/routers/${router._id}`,
                      { enabled: !router.enabled },
                      'patch',
                      router.enabled ? 'Router disabled' : 'Router enabled',
                    )
                  }
                >
                  {router.enabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            </article>
          ))}
          {!rows.length && (
            <div className="panel">
              <Empty
                title="Your network starts here"
                description="Add a MikroTik router to begin provisioning hotspot access."
                action={
                  <button className="button primary" onClick={() => open('create')}>
                    <Plus size={16} />
                    Add your first router
                  </button>
                }
              />
            </div>
          )}
        </div>
      ) : (
        <section className="panel management-table">
          <div className="table-toolbar">
            <div className="search-field">
              <Search size={17} />
              <input
                aria-label={`Search ${meta.title.toLowerCase()}`}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder={
                  section === 'customers'
                    ? 'Search by name or phone…'
                    : section === 'payments'
                      ? 'Search phone, receipt, or reference…'
                      : 'Search records…'
                }
                disabled={!['customers', 'payments', 'sessions'].includes(section)}
              />
            </div>
            {statuses[section] && (
              <select
                className="filter-select"
                value={status}
                aria-label="Filter by status"
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                {statuses[section].map((value) => (
                  <option key={value} value={value}>
                    {value === 'all' ? 'All statuses' : value.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            )}
            <span className="record-count">
              {pageInfo.total} {section === 'support' ? 'conversations' : 'records'}
            </span>
          </div>
          {rows.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {(section === 'customers'
                      ? ['Customer', 'Phone number', 'Joined', 'Status', '']
                      : section === 'payments'
                        ? [
                            'Reference',
                            'Customer',
                            'Plan / purpose',
                            'Amount',
                            'Status',
                            'Date',
                            '',
                          ]
                        : section === 'sessions'
                          ? ['Customer', 'Device', 'Plan', 'Hotspot', 'Expires', 'Status', '']
                          : section === 'vouchers'
                            ? ['Code', 'Plan', 'Valid until', 'Redeemed by', 'Status', '']
                            : section === 'loans'
                              ? ['Customer', 'Plan', 'Principal', 'Total due', 'Due date', 'Status']
                              : section === 'support'
                                ? ['Conversation', 'Customer', 'Opened', 'Status', '']
                                : ['Action', 'Details', 'By', 'Time']
                    ).map((heading, index) => (
                      <th key={index}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    if (section === 'customers') {
                      const item = row as User;
                      return (
                        <tr key={item._id}>
                          <td>
                            <div className="person-cell">
                              <span className="avatar table-avatar">
                                {item.name.slice(0, 2).toUpperCase()}
                              </span>
                              <strong>{item.name}</strong>
                            </div>
                          </td>
                          <td>{item.phone || item.contactPhone || '—'}</td>
                          <td>{date(item.createdAt)}</td>
                          <td>
                            <Badge status={item.blocked ? 'blocked' : 'active'} />
                          </td>
                          <td>
                            <button
                              className={`button small ${item.blocked ? 'secondary' : 'danger-ghost'}`}
                              onClick={() => open('confirm', item)}
                            >
                              {item.blocked ? 'Restore' : 'Block'}
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    if (section === 'payments') {
                      const item = row as Payment;
                      return (
                        <tr key={item._id}>
                          <td>
                            <strong className="mono">{item.reference}</strong>
                            <small className="cell-subtext">
                              {item.receipt || 'Awaiting receipt'}
                            </small>
                          </td>
                          <td>
                            {item.user?.name}
                            <small className="cell-subtext">{item.phone}</small>
                          </td>
                          <td>{item.planName || 'Credit repayment'}</td>
                          <td className="amount">{money(item.amount)}</td>
                          <td>
                            <Badge status={item.status} />
                          </td>
                          <td className="nowrap">{date(item.createdAt, true)}</td>
                          <td>
                            <button
                              className="icon-button"
                              onClick={() => open('detail', item)}
                              aria-label={`View payment ${item.reference}`}
                            >
                              <Eye size={17} />
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    if (section === 'sessions') {
                      const item = row as Access;
                      return (
                        <tr key={item._id}>
                          <td>
                            <strong>{item.user?.name}</strong>
                            <small className="cell-subtext">{item.user?.phone}</small>
                          </td>
                          <td className="mono">
                            {item.macAddress}
                            <small className="cell-subtext">
                              {item.connected ? 'Device online' : 'Device offline'}
                            </small>
                          </td>
                          <td>
                            {item.planName}
                            <small className="cell-subtext">{item.speedMbps} Mbps</small>
                          </td>
                          <td>{item.router?.name || 'Unavailable'}</td>
                          <td className="nowrap">{date(item.expiresAt, true)}</td>
                          <td>
                            <Badge status={item.status} />
                            {item.lastError && (
                              <small className="cell-subtext inline-error">{item.lastError}</small>
                            )}
                          </td>
                          <td>
                            {['active', 'queued', 'provisioning'].includes(item.status) && (
                              <button
                                className="button danger-ghost small"
                                onClick={() => open('confirm', item)}
                              >
                                Disconnect
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    }
                    if (section === 'vouchers') {
                      const item = row as Voucher;
                      return (
                        <tr key={item._id}>
                          <td className="mono">
                            {item.prefix} <span className="muted">(secured)</span>
                          </td>
                          <td>{item.plan?.name}</td>
                          <td>{date(item.expiresAt)}</td>
                          <td>{item.redeemedBy?.name || '—'}</td>
                          <td>
                            <Badge
                              status={
                                new Date(item.expiresAt) < new Date() && item.status === 'available'
                                  ? 'expired'
                                  : item.status
                              }
                            />
                          </td>
                          <td>
                            {item.status === 'available' && (
                              <button
                                className="button danger-ghost small"
                                onClick={() => open('confirm', item)}
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    }
                    if (section === 'loans') {
                      const item = row as Loan;
                      return (
                        <tr key={item._id}>
                          <td>
                            <strong>{item.user?.name}</strong>
                            <small className="cell-subtext">{item.user?.phone}</small>
                          </td>
                          <td>{item.planName}</td>
                          <td>{money(item.amount)}</td>
                          <td className="amount">{money(item.totalDue)}</td>
                          <td>{date(item.dueAt)}</td>
                          <td>
                            <Badge status={item.status} />
                          </td>
                        </tr>
                      );
                    }
                    if (section === 'support') {
                      const item = row as Ticket;
                      return (
                        <tr key={item._id}>
                          <td>
                            <strong>{item.subject}</strong>
                            <small className="cell-subtext truncate">{item.message}</small>
                          </td>
                          <td>
                            {item.user?.name}
                            <small className="cell-subtext">{item.user?.phone}</small>
                          </td>
                          <td>{date(item.createdAt)}</td>
                          <td>
                            <Badge status={item.status} />
                          </td>
                          <td>
                            <button
                              className="button secondary small"
                              onClick={() => open('detail', item)}
                            >
                              Open conversation
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    const item = row as Audit;
                    return (
                      <tr key={item._id}>
                        <td>
                          <Badge status="neutral">{item.action.replaceAll('.', ' · ')}</Badge>
                        </td>
                        <td>{item.detail}</td>
                        <td>{item.actor?.name || 'System'}</td>
                        <td>{date(item.createdAt, true)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={
                search || status !== 'all'
                  ? 'No matching records'
                  : `No ${section === 'support' ? 'support conversations' : meta.title.toLowerCase()} yet`
              }
              description={
                search || status !== 'all'
                  ? 'Try a different search or status filter.'
                  : 'Everything is ready. New activity will appear here.'
              }
            />
          )}
          <Pagination {...pageInfo} onPage={setPage} />
        </section>
      )}
      {(modal === 'create' || modal === 'edit') && (
        <Modal
          title={
            modal === 'edit'
              ? section === 'routers'
                ? 'Edit router'
                : 'Edit internet plan'
              : meta.add || 'Create'
          }
          description={
            section === 'plans'
              ? 'Changes apply to new purchases. Existing passes keep their purchased terms.'
              : section === 'routers'
                ? 'Credentials are encrypted at rest and never returned to the browser.'
                : undefined
          }
          onClose={close}
        >
          <form onSubmit={submit} className="form-stack">
            {formError && <ErrorNotice message={formError} />}
            {section === 'plans' && (
              <>
                <Field label="Plan name">
                  <input
                    name="name"
                    required
                    defaultValue={selectedPlan?.name}
                    placeholder="e.g. All day"
                    maxLength={60}
                  />
                </Field>
                <Field label="Short description">
                  <input
                    name="description"
                    defaultValue={selectedPlan?.description}
                    maxLength={200}
                    placeholder="A whole day of reliable Wi-Fi"
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Price (KES)">
                    <input
                      name="price"
                      type="number"
                      min={1}
                      max={150000}
                      required
                      defaultValue={selectedPlan?.price || 30}
                    />
                  </Field>
                  <Field label="Duration (minutes)">
                    <input
                      name="durationMinutes"
                      type="number"
                      min={1}
                      max={525600}
                      required
                      defaultValue={selectedPlan?.durationMinutes || 1440}
                    />
                  </Field>
                </div>
                <Field label="Connection speed (Mbps)">
                  <input
                    name="speedMbps"
                    type="number"
                    min={0.5}
                    step={0.5}
                    max={1000}
                    required
                    defaultValue={selectedPlan?.speedMbps || 5}
                  />
                </Field>
                <label className="checkbox-label">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={selectedPlan?.active ?? true}
                  />
                  Available for purchase
                </label>
                <label className="checkbox-label">
                  <input name="popular" type="checkbox" defaultChecked={selectedPlan?.popular} />
                  Feature as a popular plan
                </label>
              </>
            )}
            {section === 'customers' && (
              <>
                <Field label="Full name">
                  <input name="name" required placeholder="Customer’s full name" />
                </Field>
                <Field label="Phone number">
                  <input name="phone" type="tel" required placeholder="0712 345 678" />
                </Field>
                <Field label="Initial password">
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={10}
                    maxLength={128}
                    autoComplete="new-password"
                    placeholder="10+ characters, a letter and a number"
                  />
                </Field>
                <p className="form-help">
                  Share the initial password privately. The customer can change it from their
                  account.
                </p>
              </>
            )}
            {section === 'routers' && (
              <>
                <Field label="Router name">
                  <input
                    name="name"
                    required
                    defaultValue={(selected as Router)?.name}
                    placeholder="e.g. Main building"
                    maxLength={70}
                  />
                </Field>
                <Field label="Location">
                  <input
                    name="location"
                    defaultValue={(selected as Router)?.location}
                    placeholder="e.g. Westlands · Ground floor"
                    maxLength={120}
                  />
                </Field>
                <Field label="REST base URL">
                  <input
                    name="baseUrl"
                    type="url"
                    defaultValue={(selected as Router)?.baseUrl}
                    required
                    placeholder="https://router.yournetwork.com"
                  />
                </Field>
                <Field label="Hotspot login URL">
                  <input
                    name="loginUrl"
                    type="url"
                    defaultValue={(selected as Router)?.loginUrl}
                    required
                    placeholder="https://wifi.yournetwork.com/login"
                  />
                </Field>
                <div className="form-grid">
                  <Field label="API username">
                    <input
                      name="username"
                      required
                      defaultValue={(selected as Router)?.username}
                      autoComplete="off"
                      placeholder="wifex-api"
                    />
                  </Field>
                  <Field label="API password">
                    <input
                      name="password"
                      type="password"
                      required={!selected}
                      placeholder={
                        selected ? 'Leave blank to keep current password' : 'Router API password'
                      }
                      autoComplete="new-password"
                    />
                  </Field>
                </div>
              </>
            )}
            {section === 'vouchers' && (
              <>
                <Field label="Internet plan">
                  <select name="planId" required>
                    <option value="">Choose a plan</option>
                    {plans
                      .filter((plan) => plan.active)
                      .map((plan) => (
                        <option key={plan._id} value={plan._id}>
                          {plan.name} · {money(plan.price)}
                        </option>
                      ))}
                  </select>
                </Field>
                <div className="form-grid">
                  <Field label="Number of vouchers">
                    <input
                      type="number"
                      name="count"
                      min={1}
                      max={100}
                      defaultValue={10}
                      required
                    />
                  </Field>
                  <Field label="Valid for (days)">
                    <input
                      type="number"
                      name="validityDays"
                      min={1}
                      max={365}
                      defaultValue={30}
                      required
                    />
                  </Field>
                </div>
                <p className="form-help">
                  Connection time starts when access is provisioned after redemption. Each voucher
                  can be used once.
                </p>
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="button secondary" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? (
                  <Spinner />
                ) : modal === 'edit' ? (
                  'Save changes'
                ) : section === 'vouchers' ? (
                  'Generate codes'
                ) : (
                  'Create'
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'confirm' && (
        <Modal
          title={
            section === 'customers'
              ? (selected as User)?.blocked
                ? 'Restore this customer?'
                : 'Block this customer?'
              : section === 'sessions'
                ? 'Disconnect this access pass?'
                : 'Revoke this voucher?'
          }
          description={
            section === 'customers'
              ? 'Blocking prevents sign-in and new purchases, and queues existing access for revocation.'
              : section === 'sessions'
                ? 'Router credentials will be disabled and the device disconnected. The payment record is preserved.'
                : 'This access code will no longer be redeemable.'
          }
          onClose={close}
        >
          {formError && <ErrorNotice message={formError} />}
          <div className="modal-actions">
            <button className="button secondary" disabled={busy} onClick={close}>
              Cancel
            </button>
            <button className="button danger" disabled={busy} onClick={confirm}>
              {busy ? <Spinner /> : 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
      {modal === 'detail' && section === 'payments' && (
        <Modal title="Payment details" onClose={close}>
          {formError && <ErrorNotice message={formError} />}
          <dl className="detail-list">
            {Object.entries({
              Reference: (selected as Payment).reference,
              Customer: (selected as Payment).user?.name || '',
              Phone: (selected as Payment).phone,
              Amount: money((selected as Payment).amount),
              Plan: (selected as Payment).planName || 'Internet credit repayment',
              Receipt: (selected as Payment).receipt || 'Not received',
              Status: (selected as Payment).status,
              Date: date((selected as Payment).createdAt, true),
              Note:
                (selected as Payment).failureReason ||
                ((selected as Payment).simulated ? 'Simulated payment. No money was charged.' : ''),
            })
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          <div className="modal-actions">
            {(selected as Payment).status === 'completed' && (
              <a
                className="button primary"
                href={`/api/payments/${selected?._id}/receipt`}
                download
              >
                <ArrowDownToLine size={16} />
                Download receipt
              </a>
            )}
            {['pending', 'review'].includes((selected as Payment).status) &&
              !(selected as Payment).simulated && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await post<{ message: string }>(
                        `/admin/payments/${selected?._id}/reconcile`,
                      );
                      setMessage(result.message);
                      setModal(null);
                      reload();
                    } catch (err) {
                      setFormError((err as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Check with M-Pesa
                </button>
              )}
          </div>
        </Modal>
      )}
      {modal === 'detail' && section === 'support' && (
        <Modal
          title={selectedTicket?.subject || 'Conversation'}
          description={`${selectedTicket?.user?.name} · ${selectedTicket?.user?.phone}`}
          onClose={close}
        >
          <div className="conversation">
            <p>{selectedTicket?.message}</p>
            {selectedTicket?.reference && (
              <small>Payment reference: {selectedTicket.reference}</small>
            )}
            {selectedTicket?.replies.map((reply, i) => (
              <div className="reply" key={i}>
                <strong>{reply.author}</strong>
                <p>{reply.message}</p>
                <small>{date(reply.createdAt, true)}</small>
              </div>
            ))}
          </div>
          <form className="form-stack" onSubmit={submit}>
            {formError && <ErrorNotice message={formError} />}
            <Field label="Reply to customer">
              <textarea
                name="reply"
                placeholder="Write a helpful reply…"
                maxLength={2000}
                rows={4}
              />
            </Field>
            <Field label="Conversation status">
              <select name="status" defaultValue={selectedTicket?.status}>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
              </select>
            </Field>
            <button disabled={busy} className="button primary">
              {busy ? <Spinner /> : 'Save conversation'}
            </button>
          </form>
        </Modal>
      )}
      {!!codes.length && (
        <Modal
          title="Your vouchers are ready"
          description="Save these codes now. For security, they cannot be retrieved later."
          onClose={() => setCodes([])}
        >
          <div className="voucher-codes">
            {codes.map((code) => (
              <code key={code}>{code}</code>
            ))}
          </div>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setCodes([])}>
              Done
            </button>
            <button
              className="button primary"
              onClick={() =>
                downloadCsv('wifex-vouchers.csv', [
                  ['Voucher code'],
                  ...codes.map((code) => [code]),
                ])
              }
            >
              <ArrowDownToLine size={16} />
              Download codes
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const clear = useCallback(() => setMessage(''), []);
  useEffect(() => {
    api<Settings>('/admin/settings')
      .then(setSettings)
      .catch((err) => setError(err.message));
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const result = await patch<Settings>('/admin/settings', {
        businessName: form.get('businessName'),
        supportPhone: form.get('supportPhone'),
        supportEmail: form.get('supportEmail'),
        loansEnabled: form.has('loansEnabled'),
        loanInterestPercent: Number(form.get('loanInterestPercent')),
        loanDueDays: Number(form.get('loanDueDays')),
      });
      setSettings(result);
      setMessage('Workspace settings saved');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      await post('/auth/password', Object.fromEntries(new FormData(form)));
      form.reset();
      setMessage('Password updated. Other sessions have been signed out.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE IT YOURS</p>
          <h1>Settings</h1>
          <p>The details that make your network feel like your business.</p>
        </div>
      </div>
      {error && <ErrorNotice message={error} />}
      {message && <Notice message={message} close={clear} />}
      {!settings ? (
        <Loading />
      ) : (
        <div className="settings-layout">
          <aside className="settings-nav">
            <span>
              <SettingsIcon size={17} />
              Business details
            </span>
            <a href="#credit">
              <CreditCard size={17} />
              Internet credit
            </a>
            <a href="#security">
              <ShieldCheck size={17} />
              Security
            </a>
            <Link href="/admin/routers">
              <Radio size={17} />
              Router connections
            </Link>
          </aside>
          <div>
            <form onSubmit={save} className="form-stack">
              <section className="panel settings-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Business details</h2>
                    <p>Shown in your customer portal and payment receipts.</p>
                  </div>
                </div>
                <div className="form-stack">
                  <Field label="Business name">
                    <input
                      name="businessName"
                      defaultValue={settings.businessName}
                      required
                      maxLength={60}
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label="Support phone">
                      <input
                        name="supportPhone"
                        defaultValue={settings.supportPhone}
                        maxLength={30}
                      />
                    </Field>
                    <Field label="Support email">
                      <input
                        name="supportEmail"
                        type="email"
                        defaultValue={settings.supportEmail}
                      />
                    </Field>
                  </div>
                </div>
              </section>
              <section id="credit" className="panel settings-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Internet credit</h2>
                    <p>
                      Optional borrowed access for customers with a paid purchase in the last 7
                      days.
                    </p>
                  </div>
                </div>
                <label className="checkbox-label">
                  <input
                    name="loansEnabled"
                    type="checkbox"
                    defaultChecked={settings.loansEnabled}
                  />
                  Enable internet credit
                </label>
                <div className="form-grid">
                  <Field label="Service charge (%)">
                    <input
                      name="loanInterestPercent"
                      type="number"
                      min={0}
                      max={30}
                      defaultValue={settings.loanInterestPercent}
                      required
                    />
                  </Field>
                  <Field label="Repayment period (days)">
                    <input
                      name="loanDueDays"
                      type="number"
                      min={1}
                      max={30}
                      defaultValue={settings.loanDueDays}
                      required
                    />
                  </Field>
                </div>
                <p className="form-help">
                  One open credit per customer. The lowest-price available plan is granted
                  immediately. Repayment includes the displayed service charge.
                </p>
              </section>
              <button className="button primary fit" disabled={busy}>
                {busy ? <Spinner /> : 'Save settings'}
              </button>
            </form>
            <section id="security" className="panel settings-panel security-panel">
              <div className="panel-heading">
                <div>
                  <h2>Account security</h2>
                  <p>Change your password and sign out other devices.</p>
                </div>
                <ShieldCheck size={20} />
              </div>
              <form className="form-stack" onSubmit={changePassword}>
                <Field label="Current password">
                  <input
                    name="currentPassword"
                    type="password"
                    required
                    autoComplete="current-password"
                  />
                </Field>
                <Field label="New password">
                  <input
                    name="newPassword"
                    type="password"
                    minLength={10}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </Field>
                <button className="button secondary fit" disabled={busy}>
                  Update password
                </button>
              </form>
            </section>
            <div className="info-banner">
              <LifeBuoy size={18} />
              <span>
                M-Pesa credentials and encryption keys are configured through environment variables
                on your server.
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
