export type KnowledgeDocument = {
  id: string;
  brandId: string;
  title: string;
  category: string;
  content: string;
  tags: string[];
  usageCount: number;
  lastUsedAt: string | null;
  sourceFileName?: string | null;
  sourceMimeType?: string | null;
  sourceFileSize?: number | null;
  sourceUrl?: string | null;
  storageProvider?: string | null;
  storagePath?: string | null;
  createdAt: string;
  updatedAt: string;
  brand: {
    id: string;
    name: string;
  };
};

export type KnowledgeForm = {
  title: string;
  category: string;
  content: string;
  tags: string;
};
