import { Injectable } from '@nestjs/common';
import { ImageService } from '../image/image.service';

export type SportsNewsImageSettings = { imageEnabled:boolean; imagePrompt?:string|null; morningImagePrompt?:string|null; eveningImagePrompt?:string|null; imageAspectRatio:string; imageTextMode:string; imageVisualStyle?:string|null; logoEnabled:boolean; logoPosition:string; brandFooterEnabled:boolean; brandFooterText:string };

@Injectable()
export class SportsNewsImageService {
  constructor(private readonly images: ImageService) {}

  async generate(kind:'morning'|'evening', content:string, settings:SportsNewsImageSettings) {
    if (!settings.imageEnabled) return null;
    const editionPrompt = kind === 'morning' ? settings.morningImagePrompt : settings.eveningImagePrompt;
    const size = this.size(settings.imageAspectRatio);
    const prompt = [
      `Create a premium editorial sports-news poster for the ${kind} edition.`,
      `Use the report below only as factual context. Do not invent scores, names, teams, logos, trophies or events not present in the report.`,
      `Visual style: ${settings.imageVisualStyle?.trim() || 'modern cinematic sports editorial, energetic but clean, Malaysia social-media friendly'}.`,
      `Text density: ${settings.imageTextMode}. Keep text concise; prioritize a strong title and only a few verified key points.`,
      settings.logoEnabled ? `Reserve a subtle ${settings.logoPosition} area for the MGM brand mark; do not fabricate or redesign a logo.` : 'Do not include a logo.',
      settings.brandFooterEnabled ? `Footer text exactly: ${settings.brandFooterText}` : 'No brand footer text.',
      settings.imagePrompt?.trim() || '', editionPrompt?.trim() || '',
      `REPORT:\n${content.slice(0, 6000)}`,
    ].filter(Boolean).join('\n\n');
    const result = await this.images.generate({ prompt, size, quality: 'medium' });
    return { ...result, prompt };
  }

  private size(ratio:string): '1024x1024'|'1024x1536'|'1536x1024' {
    if (ratio === '16:9') return '1536x1024';
    if (ratio === '9:16' || ratio === '4:5') return '1024x1536';
    return '1024x1024';
  }
}
