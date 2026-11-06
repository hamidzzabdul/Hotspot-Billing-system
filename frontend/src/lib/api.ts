export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    cache: 'no-store',
    signal: options.signal || AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'application/json', ...options.headers },
  }).catch((error: Error) => {
    throw new ApiError(
      0,
      error.name === 'TimeoutError'
        ? 'This is taking longer than expected. Check the payment status before trying again.'
        : 'We couldn’t reach the service. Check your connection and try again.',
    );
  });
  const body = await response
    .json()
    .catch(() => ({ error: 'The service is unavailable. Please try again.' }));
  if (!response.ok)
    throw new ApiError(response.status, body.error || 'The request could not be completed');
  return body;
}
export const post = <T>(path: string, data: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export const patch = <T>(path: string, data: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });
export function money(value: number) {
  return `KES ${new Intl.NumberFormat('en-KE').format(value)}`;
}
export function date(value?: string, withTime = false) {
  return value
    ? new Intl.DateTimeFormat('en-KE', {
        day: 'numeric',
        month: 'short',
        ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
        timeZone: 'Africa/Nairobi',
      }).format(new Date(value))
    : '—';
}
export function duration(minutes: number) {
  return minutes >= 1440
    ? `${minutes / 1440} day${minutes > 1440 ? 's' : ''}`
    : minutes >= 60
      ? `${minutes / 60} hour${minutes > 60 ? 's' : ''}`
      : `${minutes} min`;
}
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) =>
      row
        .map(
          (cell) =>
            `"${String(cell)
              .replace(/^[=+@-]/, "'$&")
              .replaceAll('"', '""')}"`,
        )
        .join(','),
    )
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
