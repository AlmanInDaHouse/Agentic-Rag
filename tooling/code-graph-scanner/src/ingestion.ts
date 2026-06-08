import { createHash } from "node:crypto";
import type {
  ContextChunk,
  ContextDocument,
  ContextSource,
  DataClassification,
  RedactionStatus,
  SensitiveFinding
} from "@triforge/shared";
import { NotFoundError } from "../../../apps/api/src/domain/errors.js";
import type {
  ContextChunkRepository,
  ContextDocumentRepository,
  ContextRetrievalRepository,
  ContextSourceRepository,
  GoalsRepository
} from "../../../apps/api/src/domain/ports.js";
import { normalizeText } from "../../../apps/api/src/services/contextChunkingService.js";
import { stableContentHash } from "../../../apps/api/src/services/contextEngineService.js";
import { ContextRedactionService } from "../../../apps/api/src/services/contextRedactionService.js";
import { ContextRetentionPolicyService } from "../../../apps/api/src/services/contextRetentionPolicyService.js";
import type {
  CodeGraphContextPack,
  CodeGraphContextPackChunk,
  CodeGraphContextPackDocument,
  CodeGraphContextPackDocumentKind
} from "./types.js";

export type CodeGraphContextPackIngestionRepositories = {
  goalsRepository: GoalsRepository;
  contextSourceRepository: ContextSourceRepository;
  contextDocumentRepository: ContextDocumentRepository;
  contextChunkRepository: ContextChunkRepository;
  contextRetrievalRepository: ContextRetrievalRepository;
};

export type CodeGraphContextPackIngestionInput = {
  goalId: string;
  pack: unknown;
  artifactPath: string;
  sourceName?: string;
};

export type CodeGraphContextPackIngestionResult = {
  source: ContextSource;
  sourceCreated: boolean;
  packHash: string;
  documentsCreated: number;
  documentsReused: number;
  chunksCreated: number;
  chunksSkippedRestricted: number;
  chunksRedacted: number;
};

type ChunkDraft = {
  packDocument: CodeGraphContextPackDocument;
  packChunk: CodeGraphContextPackChunk;
  content: string;
  redactionStatus: RedactionStatus;
  classification: DataClassification;
  sensitiveFindings: SensitiveFinding[];
};

type DocumentGroup = {
  kind: CodeGraphContextPackDocumentKind;
  title: string;
  packDocuments: CodeGraphContextPackDocument[];
  chunks: CodeGraphContextPackChunk[];
};

const generatedFrom = "code_graph";

export class CodeGraphContextPackIngestionService {
  constructor(
    private readonly repositories: CodeGraphContextPackIngestionRepositories,
    private readonly retentionPolicyService: ContextRetentionPolicyService,
    private readonly redactionService = new ContextRedactionService()
  ) {}

  async ingest(input: CodeGraphContextPackIngestionInput): Promise<CodeGraphContextPackIngestionResult> {
    const pack = validateContextPackShape(input.pack);
    const artifactPath = normalizeRepoPath(input.artifactPath);
    const packHash = hashContextPack(pack);
    const goal = await this.repositories.goalsRepository.findById(input.goalId);
    if (!goal) {
      throw new NotFoundError(`Goal ${input.goalId} was not found`);
    }

    const { source, sourceCreated } = await this.getOrCreateSource({
      goalId: input.goalId,
      pack,
      packHash,
      artifactPath,
      sourceName: input.sourceName
    });

    const groups = groupPackChunks(pack);
    let documentsCreated = 0;
    let documentsReused = 0;
    let chunksCreated = 0;
    let chunksSkippedRestricted = 0;
    let chunksRedacted = 0;

    for (const group of groups) {
      const prepared = prepareGroup({
        pack,
        group,
        packHash,
        artifactPath,
        redactionService: this.redactionService
      });
      chunksSkippedRestricted += prepared.skippedRestricted;
      chunksRedacted += prepared.drafts.filter((draft) => draft.redactionStatus === "redacted").length;
      if (prepared.drafts.length === 0) {
        continue;
      }

      const contentHash = stableContentHash(`${packHash}\n${group.kind}\n${prepared.normalizedOriginalContent}`);
      const existing = await this.repositories.contextDocumentRepository.findBySourceAndHash(
        source.id,
        contentHash
      );
      if (existing) {
        documentsReused += 1;
        continue;
      }

      await this.retentionPolicyService.validateDocumentIngestion(
        input.goalId,
        prepared.normalizedOriginalContent
      );
      await this.retentionPolicyService.validateChunkingForSource(source.id, prepared.drafts);

      const document = await this.repositories.contextDocumentRepository.create({
        sourceId: source.id,
        title: group.title,
        contentHash,
        classification: highestClassification(prepared.drafts.map((draft) => draft.classification)),
        redactionStatus: highestRedactionStatus(prepared.drafts.map((draft) => draft.redactionStatus)),
        sensitiveFindings: prepared.documentFindings,
        redactedContentHash: prepared.redactedContentChanged
          ? stableContentHash(prepared.normalizedRedactedContent)
          : null,
        contentSize: prepared.normalizedOriginalContent.length,
        metadata: documentMetadata({
          pack,
          packHash,
          artifactPath,
          group,
          skippedRestricted: prepared.skippedRestricted
        })
      });
      const chunks = await this.createChunks({ pack, packHash, artifactPath, document, group, drafts: prepared.drafts });
      documentsCreated += 1;
      chunksCreated += chunks.length;
    }

    return {
      source,
      sourceCreated,
      packHash,
      documentsCreated,
      documentsReused,
      chunksCreated,
      chunksSkippedRestricted,
      chunksRedacted
    };
  }

  private async getOrCreateSource(input: {
    goalId: string;
    pack: CodeGraphContextPack;
    packHash: string;
    artifactPath: string;
    sourceName?: string;
  }): Promise<{ source: ContextSource; sourceCreated: boolean }> {
    const existing = (await this.repositories.contextSourceRepository.listByGoal(input.goalId))
      .find((source) => (
        source.type === "artifact" &&
        source.deletedAt === null &&
        source.metadata.generatedFrom === generatedFrom &&
        source.metadata.codeGraphPackHash === input.packHash &&
        source.metadata.artifactPath === input.artifactPath
      ));

    if (existing) {
      return { source: existing, sourceCreated: false };
    }

    const commitSha = input.pack.pack.commitSha;
    const source = await this.repositories.contextSourceRepository.create({
      goalId: input.goalId,
      name: input.sourceName ?? `Code Graph context pack ${commitSha.slice(0, 12)}`,
      type: "artifact",
      metadata: sourceMetadata(input.pack, input.packHash, input.artifactPath)
    });
    return { source, sourceCreated: true };
  }

  private async createChunks(input: {
    pack: CodeGraphContextPack;
    packHash: string;
    artifactPath: string;
    document: ContextDocument;
    group: DocumentGroup;
    drafts: ChunkDraft[];
  }): Promise<ContextChunk[]> {
    return this.repositories.contextChunkRepository.createMany(
      input.drafts.map((draft, index) => ({
        documentId: input.document.id,
        chunkIndex: index,
        content: draft.content,
        contentSize: draft.content.length,
        tokenEstimate: Math.ceil(draft.content.length / 4),
        redactionStatus: draft.redactionStatus,
        metadata: chunkMetadata({
          pack: input.pack,
          packHash: input.packHash,
          artifactPath: input.artifactPath,
          group: input.group,
          draft
        })
      }))
    );
  }
}

export function validateContextPackShape(input: unknown): CodeGraphContextPack {
  if (!isRecord(input)) {
    throw new Error("Code Graph context pack must be a JSON object.");
  }
  if (!isRecord(input.pack)) {
    throw new Error("Code Graph context pack is missing pack metadata.");
  }
  if (input.pack.packVersion !== "code-graph-context-pack-v0") {
    throw new Error("Code Graph context pack has an unsupported packVersion.");
  }
  if (input.pack.scannerVersion !== "code-graph-scanner-v0") {
    throw new Error("Code Graph context pack has an unsupported scannerVersion.");
  }
  if (!Array.isArray(input.documents)) {
    throw new Error("Code Graph context pack is missing documents.");
  }
  if (!Array.isArray(input.chunks)) {
    throw new Error("Code Graph context pack is missing chunks.");
  }
  if (!Array.isArray(input.warnings)) {
    throw new Error("Code Graph context pack is missing warnings.");
  }

  const pack = input as CodeGraphContextPack;
  if (pack.pack.documents !== pack.documents.length) {
    throw new Error("Code Graph context pack document count does not match documents length.");
  }
  if (pack.pack.chunks !== pack.chunks.length) {
    throw new Error("Code Graph context pack chunk count does not match chunks length.");
  }
  if (pack.pack.warnings !== pack.warnings.length) {
    throw new Error("Code Graph context pack warning count does not match warnings length.");
  }

  const documentIds = new Set<string>();
  for (const [index, document] of pack.documents.entries()) {
    if (!isRecord(document) || typeof document.id !== "string" || document.id.trim() === "") {
      throw new Error(`Code Graph context pack document at index ${index} must have an id.`);
    }
    if (!isDocumentKind(document.kind)) {
      throw new Error(`Code Graph context pack document ${document.id} has unsupported kind.`);
    }
    if (typeof document.title !== "string" || document.title.trim() === "") {
      throw new Error(`Code Graph context pack document ${document.id} must have a title.`);
    }
    documentIds.add(document.id);
  }

  const chunkIds = new Set<string>();
  for (const [index, chunk] of pack.chunks.entries()) {
    if (!isRecord(chunk) || typeof chunk.id !== "string" || chunk.id.trim() === "") {
      throw new Error(`Code Graph context pack chunk at index ${index} must have an id.`);
    }
    if (chunkIds.has(chunk.id)) {
      throw new Error(`Code Graph context pack chunk id is duplicated: ${chunk.id}`);
    }
    if (typeof chunk.documentId !== "string" || !documentIds.has(chunk.documentId)) {
      throw new Error(`Code Graph context pack chunk ${chunk.id} references an unknown document.`);
    }
    if (typeof chunk.text !== "string" || chunk.text.trim() === "") {
      throw new Error(`Code Graph context pack chunk ${chunk.id} must have text.`);
    }
    if (!isRecord(chunk.metadata)) {
      throw new Error(`Code Graph context pack chunk ${chunk.id} must have metadata.`);
    }
    chunkIds.add(chunk.id);
  }

  return pack;
}

export function hashContextPack(pack: CodeGraphContextPack): string {
  const stablePack = {
    pack: {
      ...pack.pack,
      generatedAt: null
    },
    documents: [...pack.documents].sort(compareById),
    chunks: [...pack.chunks].sort(compareById),
    warnings: [...pack.warnings].sort((left, right) => {
      return `${left.path ?? ""}:${left.code}:${left.message}`.localeCompare(
        `${right.path ?? ""}:${right.code}:${right.message}`
      );
    })
  };
  return createHash("sha256").update(JSON.stringify(stablePack)).digest("hex");
}

function groupPackChunks(pack: CodeGraphContextPack): DocumentGroup[] {
  const documentsById = new Map(pack.documents.map((document) => [document.id, document]));
  const groups = new Map<CodeGraphContextPackDocumentKind, DocumentGroup>();
  for (const chunk of pack.chunks) {
    const document = documentsById.get(chunk.documentId);
    if (!document) {
      continue;
    }
    const existing = groups.get(document.kind) ?? {
      kind: document.kind,
      title: titleForKind(document.kind),
      packDocuments: [],
      chunks: []
    };
    if (!existing.packDocuments.some((candidate) => candidate.id === document.id)) {
      existing.packDocuments.push(document);
    }
    existing.chunks.push(chunk);
    groups.set(document.kind, existing);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      packDocuments: [...group.packDocuments].sort(compareById),
      chunks: [...group.chunks].sort(compareById)
    }))
    .sort((left, right) => left.kind.localeCompare(right.kind));
}

function prepareGroup(input: {
  pack: CodeGraphContextPack;
  group: DocumentGroup;
  packHash: string;
  artifactPath: string;
  redactionService: ContextRedactionService;
}): {
  drafts: ChunkDraft[];
  skippedRestricted: number;
  normalizedOriginalContent: string;
  normalizedRedactedContent: string;
  redactedContentChanged: boolean;
  documentFindings: SensitiveFinding[];
} {
  const packDocumentsById = new Map(input.group.packDocuments.map((document) => [document.id, document]));
  const drafts: ChunkDraft[] = [];
  let skippedRestricted = 0;

  for (const packChunk of input.group.chunks) {
    const packDocument = packDocumentsById.get(packChunk.documentId);
    if (!packDocument) {
      continue;
    }
    const normalizedOriginal = normalizeText(packChunk.text);
    const redaction = input.redactionService.redactText(normalizedOriginal);
    if (redaction.classification === "restricted" || redaction.redactionStatus === "blocked") {
      skippedRestricted += 1;
      continue;
    }
    const content = redaction.redactionStatus === "redacted"
      ? normalizeText(redaction.redactedContent)
      : normalizedOriginal;
    drafts.push({
      packDocument,
      packChunk,
      content,
      redactionStatus: redaction.redactionStatus,
      classification: redaction.classification,
      sensitiveFindings: redaction.findings
    });
  }

  const normalizedOriginalContent = normalizeText(drafts.map((draft) => draft.packChunk.text).join("\n\n"));
  const normalizedRedactedContent = normalizeText(drafts.map((draft) => draft.content).join("\n\n"));
  const documentRedaction = input.redactionService.redactText(normalizedOriginalContent);

  return {
    drafts,
    skippedRestricted,
    normalizedOriginalContent,
    normalizedRedactedContent,
    redactedContentChanged: normalizedOriginalContent !== normalizedRedactedContent,
    documentFindings: documentRedaction.redactionStatus === "blocked" ? [] : documentRedaction.findings
  };
}

function sourceMetadata(
  pack: CodeGraphContextPack,
  packHash: string,
  artifactPath: string
): Record<string, unknown> {
  return {
    generatedFrom,
    sourceKind: generatedFrom,
    artifactPath,
    sourceArtifactPath: pack.pack.sourceArtifactPath,
    scannerVersion: pack.pack.scannerVersion,
    packVersion: pack.pack.packVersion,
    commitSha: pack.pack.commitSha,
    codeGraphPackHash: packHash,
    documents: pack.pack.documents,
    chunks: pack.pack.chunks,
    warnings: pack.pack.warnings
  };
}

function documentMetadata(input: {
  pack: CodeGraphContextPack;
  packHash: string;
  artifactPath: string;
  group: DocumentGroup;
  skippedRestricted: number;
}): Record<string, unknown> {
  return {
    generatedFrom,
    artifactPath: input.artifactPath,
    sourceArtifactPath: input.pack.pack.sourceArtifactPath,
    scannerVersion: input.pack.pack.scannerVersion,
    packVersion: input.pack.pack.packVersion,
    commitSha: input.pack.pack.commitSha,
    codeGraphPackHash: input.packHash,
    codeGraphDocumentKind: input.group.kind,
    codeGraphDocumentIds: input.group.packDocuments.map((document) => document.id),
    skippedRestrictedChunks: input.skippedRestricted
  };
}

function chunkMetadata(input: {
  pack: CodeGraphContextPack;
  packHash: string;
  artifactPath: string;
  group: DocumentGroup;
  draft: ChunkDraft;
}): Record<string, unknown> {
  const sourcePath = stringOrNull(input.draft.packChunk.metadata.sourcePath)
    ?? input.draft.packDocument.sourcePath
    ?? null;
  return {
    ...input.draft.packChunk.metadata,
    generatedFrom,
    scannerVersion: input.pack.pack.scannerVersion,
    packVersion: input.pack.pack.packVersion,
    sourcePath,
    symbolName: stringOrNull(input.draft.packChunk.metadata.symbolName),
    symbolKind: stringOrNull(input.draft.packChunk.metadata.symbolKind),
    edgeType: stringOrNull(input.draft.packChunk.metadata.edgeType),
    targetPath: stringOrNull(input.draft.packChunk.metadata.targetPath),
    confidence: numberOrNull(input.draft.packChunk.metadata.confidence),
    artifactPath: input.artifactPath,
    sourceArtifactPath: input.pack.pack.sourceArtifactPath,
    commitSha: input.pack.pack.commitSha,
    codeGraphPackHash: input.packHash,
    codeGraphDocumentKind: input.group.kind,
    codeGraphDocumentId: input.draft.packDocument.id,
    codeGraphChunkId: input.draft.packChunk.id,
    classification: input.draft.classification,
    redactionStatus: input.draft.redactionStatus
  };
}

function titleForKind(kind: CodeGraphContextPackDocumentKind): string {
  const titles: Record<CodeGraphContextPackDocumentKind, string> = {
    file: "Code Graph file summaries",
    symbol: "Code Graph symbol summaries",
    edge: "Code Graph edge summaries",
    route: "Code Graph route summaries",
    migration: "Code Graph migration summaries",
    test: "Code Graph test relationship summaries",
    doc_relationship: "Code Graph documentation relationship summaries",
    warning_summary: "Code Graph scanner warning summaries"
  };
  return titles[kind];
}

function highestClassification(values: DataClassification[]): DataClassification {
  const rank: Record<DataClassification, number> = {
    public: 0,
    internal: 1,
    confidential: 2,
    secret: 3,
    restricted: 4
  };
  return values.reduce<DataClassification>((highest, value) => (
    rank[value] > rank[highest] ? value : highest
  ), "internal");
}

function highestRedactionStatus(values: RedactionStatus[]): RedactionStatus {
  if (values.includes("blocked")) {
    return "blocked";
  }
  if (values.includes("redacted")) {
    return "redacted";
  }
  if (values.includes("clean")) {
    return "clean";
  }
  return "not_scanned";
}

function normalizeRepoPath(input: string): string {
  return input.replaceAll("\\", "/");
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isDocumentKind(input: unknown): input is CodeGraphContextPackDocumentKind {
  return (
    input === "file" ||
    input === "symbol" ||
    input === "edge" ||
    input === "route" ||
    input === "migration" ||
    input === "test" ||
    input === "doc_relationship" ||
    input === "warning_summary"
  );
}

function compareById<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}
