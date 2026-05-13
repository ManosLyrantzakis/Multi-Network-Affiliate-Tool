import crypto from 'crypto';
import config from '../config.js';

const SALT = Buffer.from('affiliate-tool', 'utf8');
const ITERATIONS = 100000;
const KEY_LENGTH = 32;

function _getKey() {
  const key = crypto.pbkdf2Sync(config.SECRET_KEY, SALT, ITERATIONS, KEY_LENGTH, 'sha256');
  return key.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function _base64UrlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4;
  const padded = base64 + '='.repeat(padding ? 4 - padding : 0);
  return Buffer.from(padded, 'base64');
}

export function encrypt(plain) {
  if (!plain) return null;
  if (config.DEV_STORE_REAL_KEYS) return plain;
  try {
    const key = Buffer.from(_getKey(), 'base64');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-128-cbc', key.slice(0, 16), iv);
    let encrypted = cipher.update(plain, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const version = Buffer.from([0x80]);
    const timestamp = Buffer.allocUnsafe(8);
    timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)), 0);
    const payload = Buffer.concat([timestamp, iv, encrypted]);
    const hmac = crypto.createHmac('sha256', key.slice(16));
    hmac.update(Buffer.concat([version, payload]));
    const signature = hmac.digest();
    const token = Buffer.concat([version, payload, signature]);
    return token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  } catch (e) {
    console.error('Encrypt error:', e);
    return null;
  }
}

export function decrypt(encrypted) {
  if (!encrypted) return null;
  if (config.DEV_STORE_REAL_KEYS) return encrypted;
  try {
    const token = _base64UrlDecode(encrypted);
    if (token.length < 57) return null;
    if (token[0] !== 0x80) return null;
    const payload = token.slice(1, -32);
    const signature = token.slice(-32);
    const key = Buffer.from(_getKey(), 'base64');
    const hmac = crypto.createHmac('sha256', key.slice(16));
    hmac.update(Buffer.concat([Buffer.from([0x80]), payload]));
    if (!crypto.timingSafeEqual(signature, hmac.digest())) return null;
    const iv = payload.slice(8, 24);
    const encryptedData = payload.slice(24);
    const decipher = crypto.createDecipheriv('aes-128-cbc', key.slice(0, 16), iv);
    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    console.error('Decrypt error:', e);
    return null;
  }
}
