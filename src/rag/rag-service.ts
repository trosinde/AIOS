import { join } from "path";
import { homedir } from "os";
import type {
  EmbeddingProvider,
  CollectionConfig,
  SearchResult,
  CompareResult,
  RagConfig,
} from "./types.js";
import { VectorStore } from "./vector-store.js";
import { applyCleaners, chunkText, concatFields } from "./preprocessing.js";
import { createEmbeddingProvider } from "./embedding-provider.js";

export interface IndexItem {
  id: string;
  content?: string;
  fields?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * RAGService – high-level orchestrator tying VectorStore + EmbeddingProvider + Preprocessing.
 */
export class RAGService {
  private store: VectorStore;
  private embedder: EmbeddingProvider;
  private collections: Map<string, CollectionConfig>;

  constructor(config: RagConfig, dbPath?: string) {
    const vectorsDb = dbPath ?? join(homedir(), ".aios", "vectors.db");
    this.store = new VectorStore(vectorsDb);

    // Create embedding provider from config
    if (config.defaultProvider === "ollama" && config.ollama) {
      this.embedder = createEmbeddingProvider({
        type: "ollama",
        model: config.ollama.model,
        endpoint: config.ollama.endpoint,
        apiKey: config.ollama.apiKey,
      });
    } else {
      this.embedder = createEmbeddingProvider({
        type: "local",
        model: config.defaultModel,
      });
    }

    // Build collection configs
    this.collections = new Map();
    for (const [name, cfg] of Object.entries(config.collections)) {
      this.collections.set(name, { name, ...cfg });
    }
  }

  /** Construct from components (for testing) */
  static fromComponents(
    store: VectorStore,
    embedder: EmbeddingProvider,
    collections: Map<string, CollectionConfig>,
  ): RAGService {
    const service = Object.create(RAGService.prototype) as RAGService;
    service.store = store;
    service.embedder = embedder;
    service.collections = collections;
    return service;
  }

  getCollection(name: string): CollectionConfig | undefined {
    return this.collections.get(name);
  }

  /** Index items into a collection */
  async index(collectionName: string, items: IndexItem[]): Promise<number> {
    const config = this.collections.get(collectionName);
    if (!config) throw new Error(`Collection "${collectionName}" nicht konfiguriert`);

    const docs: Array<{
      id: string;
      chunks: string[];
      metadata: Record<string, unknown>;
    }> = [];

    // Preprocess all items
    for (const item of items) {
      let text: string;
      if (item.fields && config.preprocessing.fields) {
        text = concatFields(item.fields, config.preprocessing.fields, config.preprocessing.fieldSeparator);
      } else {
        text = item.content ?? "";
      }

      // Apply cleaners
      text = applyCleaners(text, config.preprocessing.cleaners);

      // Chunk
      const chunks = chunkText(text, config.preprocessing);

      docs.push({
        id: item.id,
        chunks,
        metadata: item.metadata ?? {},
      });
    }

    // Embed all chunks
    const allTexts = docs.flatMap((d) => d.chunks);
    const allEmbeddings = await this.embedder.embedBatch(allTexts);

    // Build vector documents
    let embIdx = 0;
    const vectorDocs = [];
    const now = new Date().toISOString();

    for (const doc of docs) {
      for (let chunkIdx = 0; chunkIdx < doc.chunks.length; chunkIdx++) {
        vectorDocs.push({
          id: doc.id,
          collection: collectionName,
          chunkIndex: chunkIdx,
          content: doc.chunks[chunkIdx],
          metadata: doc.metadata,
          embedding: allEmbeddings[embIdx],
          modelId: this.embedder.modelId,
          createdAt: now,
        });
        embIdx++;
      }
    }

    this.store.upsertMany(vectorDocs);
    return vectorDocs.length;
  }

  /** Semantic search in a collection */
  async search(
    collectionName: string,
    query: string,
    overrides?: { topK?: number; minRelevance?: number; metadataFilter?: Record<string, unknown> },
  ): Promise<SearchResult[]> {
    const config = this.collections.get(collectionName);
    if (!config) throw new Error(`Collection "${collectionName}" nicht konfiguriert`);

    // Query expansion
    let expandedQuery = query;
    if (config.search.queryExpansion) {
      for (const [abbr, expansions] of Object.entries(config.search.queryExpansion)) {
        if (query.includes(abbr)) {
          expandedQuery += " " + expansions.join(" ");
        }
      }
    }

    const queryEmbedding = await this.embedder.embed(expandedQuery);

    return this.store.search(
      collectionName,
      queryEmbedding,
      overrides?.topK ?? config.search.topK,
      overrides?.minRelevance ?? config.search.minRelevance,
      overrides?.metadataFilter,
    );
  }

  /** Cross-collection similarity: find target items most similar to source items */
  async compare(
    sourceCollection: string,
    sourceIds: string[],
    targetCollection: string,
    topK: number = 10,
    minScore: number = 0.3,
  ): Promise<CompareResult[]> {
    const sourceEmbeddings = this.store.getEmbeddings(sourceCollection, sourceIds);
    const results: CompareResult[] = [];

    for (const [sourceId, embeddings] of sourceEmbeddings) {
      // Use first chunk embedding as representative
      const sourceEmb = embeddings[0];
      if (!sourceEmb) continue;

      const matches = this.store.search(targetCollection, sourceEmb, topK, minScore);
      for (const match of matches) {
        results.push({
          sourceId,
          targetId: match.id,
          score: match.score,
          sourceContent: "", // caller can look up if needed
          targetContent: match.content,
        });
      }
    }

    // Sort by score and deduplicate (same source-target pair)
    const seen = new Set<string>();
    return results
      .sort((a, b) => b.score - a.score)
      .filter((r) => {
        const key = `${r.sourceId}:${r.targetId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  /** Direct pairwise similarity between two texts */
  async similarity(textA: string, textB: string): Promise<number> {
    const [embA, embB] = await this.embedder.embedBatch([textA, textB]);
    let dot = 0;
    for (let i = 0; i < embA.length; i++) {
      dot += embA[i] * embB[i];
    }
    return dot;
  }

  /** Get collection statistics */
  stats(collection?: string) {
    return this.store.stats(collection);
  }

  /** Delete a collection */
  deleteCollection(collection: string): number {
    return this.store.deleteCollection(collection);
  }

  close(): void {
    this.store.close();
  }
}
