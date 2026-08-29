import { SocialPlatform } from '../generated/prisma/enums';

export const PUBLISHABLE_SOCIAL_PLATFORMS = [
  SocialPlatform.FACEBOOK,
  SocialPlatform.TELEGRAM,
  SocialPlatform.INSTAGRAM,
] as const;

export function socialPlatformLabel(platform: SocialPlatform): string {
  switch (platform) {
    case SocialPlatform.FACEBOOK:
      return 'Facebook';
    case SocialPlatform.TELEGRAM:
      return 'Telegram';
    case SocialPlatform.INSTAGRAM:
      return 'Instagram';
  }
}
