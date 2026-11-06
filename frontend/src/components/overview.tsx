'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CreditCard,
  Radio,
  Users,
  Wifi,
  RefreshCw,
  Plus,
  Ticket,
  CheckCircle2,
  CircleAlert,
} from 'lucide-react';
import { api, money, date, downloadCsv } from '@/lib/api';
import type { Overview } from '@/lib/types';
import { Badge, Empty, ErrorNotice, Loading } from './ui';

export function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(''),
    [days, setDays] = useState(7),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Overview>(`/admin/overview?days=${days}`)
        .then((result) => {
          if (alive) {
            setData(result);
            setError('');
          }
        })
        .catch((err) => {
          if (alive) setError(err.message);
        });
    load();
    const timer = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [days, refresh]);
  if (!data)
    return error ? (
      <ErrorNotice message={error} retry={() => setRefresh((value) => value + 1)} />
    ) : (
      <Loading />
    );
  const online = data.routers.filter((router) => router.status === 'online').length;
  const bars = Array.from({ length: data.days }, (_, i) => {
    const day = new Date(new Date(data.asOf).getTime() - (data.days - i - 1) * 86400000);
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(day);
    return {
      key,
      label: new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        timeZone: 'Africa/Nairobi',
      }).format(day),
      revenue: data.trend.find((row) => row._id === key)?.revenue || 0,
    };
  });
  const max = Math.max(10, ...bars.map((bar) => bar.revenue));
  const totalSales = data.popular.reduce((sum, plan) => sum + plan.sales, 0);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR NETWORK AT A GLANCE</p>
          <h1>Overview</h1>
          <p>A clear view of your business. All in one place.</p>
        </div>
        <div className="heading-actions">
          <button
            className="button secondary"
            onClick={() =>
              downloadCsv('wifex-revenue.csv', [
                ['Date', 'Revenue (KES)'],
                ...bars.map((bar) => [bar.key, bar.revenue]),
              ])
            }
          >
            <ArrowDownToLine size={16} />
            Export report
          </button>
          <Link href="/admin/plans" className="button primary">
            <Plus size={17} />
            Create a plan
          </Link>
        </div>
      </div>
      {error && <ErrorNotice message={error} />}
      {data.paymentMode === 'disabled' && (
        <div className="info-banner">
          <CircleAlert size={16} />
          <span>
            M-Pesa payments are disabled. Enable them after completing the backend payment and
            public callback settings.
          </span>
        </div>
      )}
      <div className="overview-toolbar">
        <div className="section-tabs">
          <span className="active">Business overview</span>
          <Link href="/admin/sessions">Network activity</Link>
        </div>
        <div className="toolbar-right">
          <button
            className="icon-button"
            onClick={() => setRefresh((value) => value + 1)}
            aria-label="Refresh overview"
          >
            <RefreshCw size={15} />
          </button>
          <label className="date-select">
            <CalendarDays size={15} />
            <select
              aria-label="Reporting period"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
        </div>
      </div>
      <section className="stats-grid" aria-label="Network statistics">
        {[
          {
            label: 'Total revenue',
            value: money(data.revenue),
            note: `${data.completedPayments} successful payments`,
            icon: CreditCard,
            color: 'green',
          },
          {
            label: 'Active access passes',
            value: data.active.toLocaleString(),
            note: `${data.connected} devices currently connected`,
            icon: Wifi,
            color: 'blue',
          },
          {
            label: 'Total customers',
            value: data.customers.toLocaleString(),
            note: 'Registered on your network',
            icon: Users,
            color: 'purple',
          },
          {
            label: 'Pending payments',
            value: data.pending.toLocaleString(),
            note: 'Awaiting payment confirmation',
            icon: Radio,
            color: 'amber',
          },
        ].map((stat) => (
          <article className="stat-card" key={stat.label}>
            <div>
              <span>{stat.label}</span>
              <span className={`stat-icon ${stat.color}`}>
                <stat.icon size={18} />
              </span>
            </div>
            <strong>{stat.value}</strong>
            <p>{stat.note}</p>
          </article>
        ))}
      </section>
      <div className="analytics-grid">
        <section className="panel revenue-panel">
          <div className="panel-heading">
            <div>
              <h2>Revenue overview</h2>
              <p>Your successful payments over time</p>
            </div>
            <span className="legend">
              <i />
              Revenue
            </span>
          </div>
          <div className="chart-summary">
            <strong>{money(data.revenue)}</strong>
            <span>in the last {days} days</span>
          </div>
          <div
            className="bar-chart"
            role="img"
            aria-label={`Daily revenue over the last ${days} days. Total ${money(data.revenue)}.`}
          >
            <div className="chart-labels">
              {[max, max * 0.75, max * 0.5, max * 0.25, 0].map((value, index) => (
                <span key={index}>{Math.round(value).toLocaleString()}</span>
              ))}
            </div>
            <div className="chart-plot">
              <div className="chart-grid">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} />
                ))}
              </div>
              <div className="chart-bars">
                {bars.map((bar, i) => (
                  <div key={bar.key} className="chart-column">
                    <div className="bar-space">
                      <div
                        className={`chart-bar ${i === bars.length - 1 ? 'current' : ''}`}
                        style={{
                          height: `${Math.max(bar.revenue ? 2 : 0, (bar.revenue / max) * 100)}%`,
                        }}
                        title={`${bar.key}: ${money(bar.revenue)}`}
                      />
                    </div>
                    <span>
                      {days <= 7 ? bar.label : i % Math.ceil(days / 7) === 0 ? date(bar.key) : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {!data.revenue && (
            <p className="chart-empty-note">
              Revenue will appear when customers complete their first payments.
            </p>
          )}
        </section>
        <section className="panel plans-breakdown">
          <div className="panel-heading">
            <div>
              <h2>Popular plans</h2>
              <p>What your customers are choosing</p>
            </div>
            <Link className="icon-button" href="/admin/plans" aria-label="View all plans">
              <ArrowUpRight size={18} />
            </Link>
          </div>
          {data.popular.length ? (
            <>
              <div className="plan-total">
                <strong>{totalSales}</strong>
                <span>plans purchased</span>
              </div>
              <div className="stacked-bar">
                {data.popular.map((plan, i) => (
                  <span
                    key={plan._id}
                    style={{
                      width: `${(plan.sales / totalSales) * 100}%`,
                      background: ['#17785a', '#69a88e', '#a6c6b4', '#d8e6dc'][i % 4],
                    }}
                  />
                ))}
              </div>
              <div className="plan-legend">
                {data.popular.map((plan, i) => (
                  <div key={plan._id}>
                    <span>
                      <i
                        style={{ background: ['#17785a', '#69a88e', '#a6c6b4', '#d8e6dc'][i % 4] }}
                      />
                      {plan._id}
                    </span>
                    <strong>
                      {Math.round((plan.sales / totalSales) * 100)}%{' '}
                      <small>{plan.sales} sales</small>
                    </strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Empty
              title="Your first bestseller awaits"
              description="Plan sales will be shown here after a successful purchase."
            />
          )}
        </section>
      </div>
      <div className="operations-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Recent transactions</h2>
              <p>The latest payments on your network</p>
            </div>
            <Link className="text-link" href="/admin/payments">
              View all
              <ArrowRight size={15} />
            </Link>
          </div>
          {data.payments.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Plan</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((payment) => (
                    <tr key={payment._id}>
                      <td>
                        <div className="person-cell">
                          <span className="avatar table-avatar">
                            {payment.user?.name?.slice(0, 2).toUpperCase() || 'WF'}
                          </span>
                          <div>
                            <strong>{payment.user?.name || payment.phone}</strong>
                            <small>{payment.phone}</small>
                          </div>
                        </div>
                      </td>
                      <td>{payment.planName || 'Credit repayment'}</td>
                      <td className="amount">{money(payment.amount)}</td>
                      <td>
                        <Badge status={payment.status} />
                      </td>
                      <td className="muted nowrap">{date(payment.createdAt, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Ready for your first payment"
              description="Customer purchases will appear here automatically."
            />
          )}
        </section>
        <section className="panel network-panel">
          <div className="panel-heading">
            <div>
              <h2>Network health</h2>
              <p>Your infrastructure, at a glance</p>
            </div>
            <Radio size={18} className="muted" />
          </div>
          <div className="network-health">
            <span className={`health-symbol ${online ? 'healthy' : ''}`}>
              {online ? <CheckCircle2 size={25} /> : <Radio size={25} />}
            </span>
            <div>
              <strong>
                {online
                  ? 'Your network is online'
                  : data.routers.length
                    ? 'Router setup needs attention'
                    : 'Let’s connect your network'}
              </strong>
              <p>
                {online} of {data.routers.length} routers online
              </p>
            </div>
          </div>
          <div className="health-list">
            <div>
              <span>M-Pesa payments</span>
              <Badge status={data.paymentMode === 'live' ? 'online' : 'neutral'}>
                {data.paymentMode === 'disabled' ? 'Not configured' : data.paymentMode}
              </Badge>
            </div>
            <div>
              <span>Router integration</span>
              <Badge status={online ? 'online' : 'neutral'}>
                {online ? 'Connected' : 'Not connected'}
              </Badge>
            </div>
            <div>
              <span>Open support tickets</span>
              <Link href="/admin/support">
                {data.openTickets}
                <ArrowUpRight size={13} />
              </Link>
            </div>
          </div>
          <Link href="/admin/routers" className="button secondary full">
            Manage routers
            <ArrowRight size={15} />
          </Link>
        </section>
      </div>
      <section className="quick-actions">
        <div>
          <span className="quick-icon">
            <Ticket size={20} />
          </span>
          <div>
            <strong>A simpler way to share access</strong>
            <p>Create vouchers for walk-in customers and offline sales.</p>
          </div>
        </div>
        <Link href="/admin/vouchers" className="text-link">
          Manage vouchers
          <ArrowRight size={16} />
        </Link>
      </section>
    </>
  );
}
