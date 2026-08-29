import { SocialPlatform } from '../generated/prisma/enums';
import {
  PUBLISHABLE_SOCIAL_PLATFORMS,
  socialPlatformLabel,
} from './social-platform';

describe('social platform support', () => {
  it('treats Instagram as a first class publishable platform', () => {
    expect(PUBLISHABLE_SOCIAL_PLATFORMS).toContain(SocialPlatform.INSTAGRAM);
    expect(socialPlatformLabel(SocialPlatform.INSTAGRAM)).toBe('Instagram');
  });
});
