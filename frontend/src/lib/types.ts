export type User = {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  role: 'admin' | 'customer';
  blocked: boolean;
  guest?: boolean;
  contactPhone?: string;
  createdAt?: string;
};
export type Plan = {
  _id: string;
  name: string;
  description: string;
  price: number;
  durationMinutes: number;
  speedMbps: number;
  active: boolean;
  popular: boolean;
};
export type Router = {
  _id: string;
  name: string;
  location: string;
  baseUrl?: string;
  loginUrl?: string;
  username?: string;
  enabled: boolean;
  status: string;
  connected: number;
  uptime?: string;
  error?: string;
  lastChecked?: string;
};
export type Payment = {
  _id: string;
  user?: User;
  phone: string;
  reference: string;
  planName?: string;
  amount: number;
  kind: string;
  status: string;
  receipt?: string;
  createdAt: string;
  paidAt?: string;
  simulated?: boolean;
  failureReason?: string;
  access?: { status: string; expiresAt?: string; lastError?: string };
};
export type Access = {
  _id: string;
  user: User;
  router: Router;
  planName: string;
  macAddress: string;
  speedMbps: number;
  status: string;
  connected: boolean;
  expiresAt?: string;
  createdAt: string;
  lastError?: string;
};
export type Ticket = {
  _id: string;
  user?: User;
  subject: string;
  message: string;
  reference: string;
  status: string;
  createdAt: string;
  replies: { message: string; author: string; createdAt: string }[];
};
export type Loan = {
  _id: string;
  user?: User;
  planName: string;
  amount: number;
  totalDue: number;
  status: string;
  dueAt: string;
  open: boolean;
};
export type Voucher = {
  _id: string;
  prefix: string;
  plan?: Plan;
  status: string;
  expiresAt: string;
  redeemedBy?: User;
};
export type Audit = {
  _id: string;
  actor?: User;
  action: string;
  detail: string;
  createdAt: string;
};
export type Settings = {
  businessName: string;
  supportPhone: string;
  supportEmail: string;
  loansEnabled: boolean;
  loanInterestPercent: number;
  loanDueDays: number;
};
export type PublicConfig = Pick<
  Settings,
  'businessName' | 'supportPhone' | 'supportEmail' | 'loansEnabled'
> & { paymentMode: string; routerMode: string };
export type PageData<T> = { items: T[]; total: number; page: number; pages: number };
export type Overview = {
  revenue: number;
  completedPayments: number;
  customers: number;
  active: number;
  connected: number;
  pending: number;
  openTickets: number;
  payments: Payment[];
  routers: Router[];
  popular: { _id: string; sales: number; revenue: number }[];
  activity: Audit[];
  trend: { _id: string; revenue: number }[];
  days: number;
  asOf: string;
  paymentMode: string;
  routerMode: string;
};
