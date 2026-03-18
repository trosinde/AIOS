// ─── Embedding Provider ─────────────────────────────────

export interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[], batchSize?: number): Promise<Float32Array[]>;
  readonly dimensions: number;
  readonly modelId: string;
}

export interface EmbeddingProviderConfig {
  type: "local" | "ollama";
  model: string;
  endpoint?: string;
  apiKey?: string;
}

// ─── Collection ─────────────────────────────────────────

export interface PreprocessingConfig {
  maxChunkLength: number;
  chunkStrategy: "truncate" | "sliding_window" | "sentence";
  chunkOverlap?: number;
  cleaners: string[];
  fields?: string[];
  fieldSeparator?: string;
}

export interface SearchConfig {
  minRelevance: number;
  topK: number;
  queryExpansion?: Record<string, string[]>;
}

export interface CollectionConfig {
  name: string;
  preprocessing: PreprocessingConfig;
  search: SearchConfig;
}

// ─── Stored Documents & Results ─────────────────────────

export interface VectorDocument {
  id: string;
  collection: string;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  embedding: Float32Array;
  modelId: string;
  createdAt: string;
}

export interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
  chunkIndex: number;
}

export interface CompareResult {
  sourceId: string;
  targetId: string;
  score: number;
  sourceContent: string;
  targetContent: string;
}

export interface CollectionStats {
  collection: string;
  documentCount: number;
  modelId: string | null;
}

// ─── RAG Config (added to AiosConfig) ──────────────────

export interface RagConfig {
  defaultProvider: "local" | "ollama";
  defaultModel: string;
  ollama?: {
    model: string;
    endpoint?: string;
    apiKey?: string;
  };
  collections: Record<string, Omit<CollectionConfig, "name">>;
}
