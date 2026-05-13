import fs from 'fs';
import path from 'path';
import config from '../config.js';

function getPath() {
  return config.SETTINGS_PATH || path.join(path.dirname(config.DATABASE_PATH || ''), 'settings.json');
}

export function getSettings() {
  try {
    const p = getPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('getSettings:', e);
  }
  return { schedule_time_utc: config.SCHEDULE_TIME_UTC || '02:00' };
}

export function setSettings(updates) {
  const p = getPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const current = getSettings();
  const next = { ...current, ...updates };
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
