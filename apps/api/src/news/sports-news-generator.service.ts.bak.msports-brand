import { Injectable } from '@nestjs/common';
import { AiProviderService } from '../ai-provider/ai-provider.service';
import type { SportsNewsSource } from '../automation/sports-news-source-validator.service';

export type SportsNewsGenerationSettings = {
  language: string;
  sportsKnowledgeEnabled: boolean;
  discussionQuestionEnabled: boolean;
  referenceLinksEnabled: boolean;
  customPromptEnabled: boolean;
  systemPrompt?: string | null;
  morningPrompt?: string | null;
  eveningPrompt?: string | null;
  knowledgePrompt?: string | null;
  customInstructions?: string | null;
};

@Injectable()
export class SportsNewsGeneratorService {
  constructor(private readonly ai: AiProviderService) {}

  async generate(kind: 'morning' | 'evening', sources: SportsNewsSource[], settings: SportsNewsGenerationSettings) {
    if (!sources.length) throw new Error('Cannot generate sports news without verified sources.');
    const sourceBlock = sources.map((s, i) => `[${i + 1}] ${s.title}\nPublished: ${s.publishedAt ?? 'unknown'}\nSource: ${s.sourceName ?? 'unknown'}\nURL: ${s.url ?? 'unknown'}`).join('\n\n');
    const defaultSystem = `You are the MGM Sports newsroom editor for a Malaysia audience. Use ONLY the verified source list supplied by the user. Never invent scores, fixtures, quotes, injuries, transfers, dates, rankings, source URLs or events. If a fact is not supported by the supplied sources, omit it. Keep news and sports knowledge clearly separated. Output polished publish-ready copy.`;
    const editionPrompt = kind === 'morning' ? settings.morningPrompt : settings.eveningPrompt;
    const language = settings.language === 'zh-en' ? 'Simplified Chinese and English bilingual' : settings.language === 'zh' ? 'Simplified Chinese' : 'English';
    const sections = ['今日焦点 / Top Stories', '重要赛果 / Key Results', '值得关注赛程 / Fixtures to Watch', '球员／球队／车手动态 / Athlete & Team Updates'];
    if (settings.sportsKnowledgeEnabled) sections.push('体育知识 / Sports Knowledge');
    if (settings.discussionQuestionEnabled) sections.push('今日讨论题 / Discussion Question');
    if (settings.referenceLinksEnabled) sections.push('参考来源 / Sources');
    const user = `Create the ${kind} MGM Sports report.\nLanguage: ${language}.\nRequired sections when supported: ${sections.join('; ')}.\nDo not force a section when verified sources do not support it.\n${settings.customPromptEnabled && editionPrompt ? `Edition instructions: ${editionPrompt}\n` : ''}${settings.customPromptEnabled && settings.knowledgePrompt && settings.sportsKnowledgeEnabled ? `Sports knowledge instructions: ${settings.knowledgePrompt}\n` : ''}${settings.customPromptEnabled && settings.customInstructions ? `Additional instructions: ${settings.customInstructions}\n` : ''}\nVERIFIED SOURCES:\n${sourceBlock}`;
    const result = await this.ai.generate({ system: settings.customPromptEnabled && settings.systemPrompt?.trim() ? `${defaultSystem}\n\nAdditional system instructions:\n${settings.systemPrompt.trim()}` : defaultSystem, user }, { responseFormat: 'text', temperature: 0.2, maxOutputTokens: 2600 });
    if (!result.text.trim()) throw new Error('Sports news generator returned empty content.');
    return { content: result.text.trim(), model: result.model, provider: result.provider, usage: result.usage, sourceCount: sources.length };
  }
}
