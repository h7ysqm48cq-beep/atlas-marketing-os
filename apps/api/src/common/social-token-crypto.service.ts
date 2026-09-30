import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

@Injectable()
export class SocialTokenCryptoService {
  private readonly algorithm = 'aes-256-gcm';

  constructor(
    private readonly configService: ConfigService,
  ) {}

  encrypt(value: string): string {
    const cleanValue = value?.trim();

    if (!cleanValue) {
      throw new BadRequestException(
        'Social access token cannot be empty.',
      );
    }

    const key = this.getEncryptionKey();
    const iv = randomBytes(12);

    const cipher = createCipheriv(
      this.algorithm,
      key,
      iv,
    );

    const encrypted = Buffer.concat([
      cipher.update(
        cleanValue,
        'utf8',
      ),
      cipher.final(),
    ]);

    const authTag =
      cipher.getAuthTag();

    return [
      'v1',
      iv.toString('base64url'),
      authTag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  decrypt(value: string): string {
    const cleanValue = value?.trim();

    if (!cleanValue) {
      throw new BadRequestException(
        'Encrypted social access token is missing.',
      );
    }

    const [
      version,
      encodedIv,
      encodedAuthTag,
      encodedCiphertext,
    ] = cleanValue.split(':');

    if (
      version !== 'v1' ||
      !encodedIv ||
      !encodedAuthTag ||
      !encodedCiphertext
    ) {
      throw new BadRequestException(
        'Encrypted social access token has an invalid format.',
      );
    }

    try {
      const key =
        this.getEncryptionKey();

      const decipher =
        createDecipheriv(
          this.algorithm,
          key,
          Buffer.from(
            encodedIv,
            'base64url',
          ),
        );

      decipher.setAuthTag(
        Buffer.from(
          encodedAuthTag,
          'base64url',
        ),
      );

      const decrypted =
        Buffer.concat([
          decipher.update(
            Buffer.from(
              encodedCiphertext,
              'base64url',
            ),
          ),
          decipher.final(),
        ]);

      return decrypted.toString('utf8');
    } catch {
      throw new BadRequestException(
        'Unable to decrypt the social access token.',
      );
    }
  }

  private getEncryptionKey(): Buffer {
    const configuredKey =
      this.configService.get<string>(
        'SOCIAL_TOKEN_ENCRYPTION_KEY',
      );

    if (!configuredKey?.trim()) {
      throw new ServiceUnavailableException(
        'SOCIAL_TOKEN_ENCRYPTION_KEY is not configured.',
      );
    }

    /*
     * Hash the configured secret into an exact 32-byte key.
     * This allows a strong random string of any practical length
     * while AES-256-GCM always receives a valid key size.
     */
    return createHash('sha256')
      .update(
        configuredKey.trim(),
        'utf8',
      )
      .digest();
  }
}
