export type KnowledgeDocument = {
  id: string;
  brandId: string;
  title: string;
  category: string;
  content: string;
  tags: string[];
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
