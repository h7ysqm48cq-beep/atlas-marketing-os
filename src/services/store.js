import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../../data/content.json');

async function ensureDb() {
  try { await fs.access(dbPath); }
  catch {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(dbPath, JSON.stringify({ contents: [], metrics: [] }, null, 2));
  }
}

export async function readDb() {
  await ensureDb();
  return JSON.parse(await fs.readFile(dbPath, 'utf8'));
}

export async function writeDb(db) {
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
}

export function makeId(prefix = 'CNT') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}
