export type KnowledgeDocument = {
  id: string;
  brandId: string;
  title: string;
  category: string;
  content: string;
  tags: string[];
  usageCount: number;
  lastUsedAt: string | null;
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
