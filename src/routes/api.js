import { Router } from 'express';
import { readDb, writeDb, makeId } from '../services/store.js';
import { generateContent } from '../services/ai.js';
import { pushContentToNotion } from '../services/notion.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ ok: true, service: 'MGMBETMYR Marketing OS V4 Pro' }));

router.get('/dashboard', async (_req, res) => {
  const db = await readDb();
  const published = db.contents.filter(x => x.status === 'Published');
  const totals = published.reduce((a, x) => ({
    reach: a.reach + Number(x.reach || 0),
    comments: a.comments + Number(x.comments || 0),
    shares: a.shares + Number(x.shares || 0),
    saves: a.saves + Number(x.saves || 0),
    telegram: a.telegram + Number(x.telegram || 0)
  }), { reach: 0, comments: 0, shares: 0, saves: 0, telegram: 0 });
  const engagement = totals.reach ? ((totals.comments + totals.shares + totals.saves) / totals.reach) * 100 : 0;
  res.json({ counts: {
    total: db.contents.length,
    draft: db.contents.filter(x => x.status === 'Draft').length,
    review: db.contents.filter(x => x.status === 'Review').length,
    scheduled: db.contents.filter(x => x.status === 'Scheduled').length,
    published: published.length
  }, totals, engagement: Number(engagement.toFixed(2)), recent: db.contents.slice(-8).reverse() });
});

router.get('/contents', async (_req, res) => res.json((await readDb()).contents));

router.post('/contents', async (req, res) => {
  const db = await readDb();
  const item = { id: makeId(), createdAt: new Date().toISOString(), status: 'Draft', ...req.body };
  db.contents.push(item); await writeDb(db); res.status(201).json(item);
});

router.patch('/contents/:id', async (req, res) => {
  const db = await readDb();
  const i = db.contents.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Content not found' });
  db.contents[i] = { ...db.contents[i], ...req.body, updatedAt: new Date().toISOString() };
  await writeDb(db); res.json(db.contents[i]);
});

router.post('/generate', async (req, res) => {
  const { topic, platform, audience, save = true } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic is required' });
  const generated = await generateContent({ topic, platform, audience });
  const item = { id: makeId(), topic, platform: platform || 'Facebook', audience, status: 'Draft', createdAt: new Date().toISOString(), ...generated };
  if (save) { const db = await readDb(); db.contents.push(item); await writeDb(db); }
  res.json(item);
});

router.post('/contents/:id/notion', async (req, res) => {
  const db = await readDb();
  const item = db.contents.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Content not found' });
  try { res.json(await pushContentToNotion(item)); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

export default router;
