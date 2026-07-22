import { Client } from '@notionhq/client';

export async function pushContentToNotion(content) {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_CONTENT_DATABASE_ID;
  if (!token || !databaseId) return { skipped: true, reason: 'Notion credentials not configured' };

  const notion = new Client({ auth: token });
  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: {
      Name: { title: [{ text: { content: content.title || content.topic } }] },
      Status: { select: { name: content.status || 'Draft' } },
      Platform: { select: { name: content.platform || 'Facebook' } },
      'Publish Date': content.publishDate ? { date: { start: content.publishDate } } : { date: null }
    },
    children: [
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Hook' } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: content.hook || '' } }] } },
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '正文' } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: content.body || '' } }] } },
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'CTA' } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: content.cta || '' } }] } }
    ]
  });
  return { skipped: false, pageId: page.id, url: page.url };
}
