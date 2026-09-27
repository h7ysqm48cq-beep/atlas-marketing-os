import { CopilotAttachmentService } from './copilot-attachment.service';

describe('CopilotAttachmentService', () => {
  const imageFile = (
    mimetype = 'image/jpeg',
    originalname = 'photo.jpg',
  ) =>
    ({
      buffer: Buffer.from('image'),
      mimetype,
      originalname,
      size: 5,
    }) as Express.Multer.File;

  it('backs editor-compatible image attachments with an Asset record', async () => {
    const assetsService = {
      upload: jest.fn().mockResolvedValue({
        id: 'asset-1',
        name: 'photo.jpg',
        url: 'https://example.com/photo.jpg',
        thumbnailUrl: 'https://example.com/photo-thumb.webp',
        storageProvider: 'supabase',
        storagePath: 'brands/brand-1/uploads/photo.jpg',
        fileSize: 5,
        mimeType: 'image/jpeg',
      }),
    };
    const brandsService = {
      getActiveBrand: jest.fn(),
    };
    const storageService = {
      uploadFile: jest.fn(),
    };

    const service = new CopilotAttachmentService(
      brandsService as never,
      storageService as never,
      assetsService as never,
    );

    await expect(service.uploadImage(imageFile())).resolves.toEqual({
      id: 'asset-1',
      assetId: 'asset-1',
      kind: 'image',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 5,
      url: 'https://example.com/photo.jpg',
      storageProvider: 'supabase',
      storagePath: 'brands/brand-1/uploads/photo.jpg',
    });

    expect(assetsService.upload).toHaveBeenCalledWith({
      file: expect.objectContaining({
        originalname: 'photo.jpg',
        mimetype: 'image/jpeg',
      }),
      collection: 'Copilot Uploads',
      aiEnabled: false,
    });
    expect(brandsService.getActiveBrand).not.toHaveBeenCalled();
    expect(storageService.uploadFile).not.toHaveBeenCalled();
  });

  it('keeps GIF attachments on the existing storage-only fallback', async () => {
    const assetsService = {
      upload: jest.fn(),
    };
    const brandsService = {
      getActiveBrand: jest.fn().mockResolvedValue({ id: 'brand-1' }),
    };
    const storageService = {
      uploadFile: jest.fn().mockResolvedValue({
        publicUrl: 'https://example.com/animation.gif',
        provider: 'supabase',
        path: 'brands/brand-1/copilot/2026/09/animation.gif',
      }),
    };

    const service = new CopilotAttachmentService(
      brandsService as never,
      storageService as never,
      assetsService as never,
    );

    const result = await service.uploadImage(
      imageFile('image/gif', 'animation.gif'),
    );

    expect(result).toMatchObject({
      kind: 'image',
      name: 'animation.gif',
      mimeType: 'image/gif',
      url: 'https://example.com/animation.gif',
    });
    expect(result).not.toHaveProperty('assetId');
    expect(assetsService.upload).not.toHaveBeenCalled();
    expect(storageService.uploadFile).toHaveBeenCalledTimes(1);
  });
});
