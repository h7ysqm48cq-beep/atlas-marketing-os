import { Injectable } from '@nestjs/common';
import { CampaignGoal } from '../types/goal';
import { IntentType } from '../types/intent';

@Injectable()
export class PillarEngine {
  generate(
    prompt: string,
    intent: IntentType,
    goal: CampaignGoal,
  ): string[] {
    const text = prompt.toLowerCase();
    const pillars = new Set<string>();

    if (
      text.includes('世界杯') ||
      text.includes('world cup') ||
      text.includes('football')
    ) {
      pillars.add('Football Spirit');
      pillars.add('Match Memories');
      pillars.add('Community Discussion');
    }

    if (
      text.includes('港剧') ||
      text.includes('香港电影') ||
      text.includes('怀旧') ||
      text.includes('nostalgia')
    ) {
      pillars.add('Nostalgia');
      pillars.add('Classic Moments');
      pillars.add('Audience Memories');
    }

    if (intent === IntentType.SEO) {
      pillars.add('Search Intent');
      pillars.add('Keyword Relevance');
      pillars.add('Content Depth');
    }

    if (intent === IntentType.ANALYTICS) {
      pillars.add('Performance Insights');
      pillars.add('Audience Behaviour');
      pillars.add('Optimization Opportunities');
    }

    if (intent === IntentType.IMAGE) {
      pillars.add('Visual Storytelling');
      pillars.add('Brand Consistency');
      pillars.add('Platform-native Creative');
    }

    if (goal === CampaignGoal.CONVERSION) {
      pillars.add('Clear Value Proposition');
      pillars.add('Trust and Credibility');
      pillars.add('Action-oriented CTA');
    }

    if (goal === CampaignGoal.COMMUNITY) {
      pillars.add('Conversation');
      pillars.add('User Participation');
      pillars.add('Shared Identity');
    }

    if (goal === CampaignGoal.AWARENESS) {
      pillars.add('Brand Relevance');
      pillars.add('Reach');
      pillars.add('Memorable Storytelling');
    }

    if (pillars.size === 0) {
      pillars.add('Engagement');
      pillars.add('Brand Relevance');
      pillars.add('Platform-native Storytelling');
    }

    return [...pillars].slice(0, 6);
  }
}
