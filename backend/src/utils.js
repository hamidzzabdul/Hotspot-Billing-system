import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { z } from 'zod';
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s+()-]/g, '').replace(/^0/, '254'))
  .pipe(z.string().regex(/^254[17]\d{8}$/, 'Enter a valid Kenyan mobile number'));
export const macSchema = z
  .string()
  .transform((s) => s.replaceAll('-', ':').toUpperCase())
  .pipe(
    z
      .string()
      .regex(
        /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/,
        'Connect through the hotspot to identify this device',
      ),
  );
export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid record ID');
export const parse = (s, data) => s.parse(data);
export function encrypt(value, config) {
  if (!/^[a-f0-9]{64}$/i.test(config.encryptionKey))
    throw new HttpError(503, 'Configure ENCRYPTION_KEY before storing router credentials');
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'hex'), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), data.toString('hex')].join(':');
}
export function decrypt(value, config) {
  const [iv, tag, data] = value.split(':');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(config.encryptionKey, 'hex'),
    Buffer.from(iv, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString(
    'utf8',
  );
}
export function pagination(query) {
  const page = Math.max(1, Math.min(10000, Number(query.page) || 1));
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 15));
  return { page: Math.floor(page), limit: Math.floor(limit) };
}
export function searchFilter(search, fields) {
  const value = String(search || '')
    .slice(0, 100)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value
    ? { $or: fields.map((field) => ({ [field]: { $regex: value, $options: 'i' } })) }
    : {};
}
export async function listing(model, filter, query, populate = '') {
  const { page, limit } = pagination(query);
  const [items, total] = await Promise.all([
    model
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate(populate)
      .lean(),
    model.countDocuments(filter),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}
