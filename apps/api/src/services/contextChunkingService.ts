export type ContextChunkDraft = {
  chunkIndex: number;
  content: string;
  tokenEstimate: number;
};

export type ContextChunkingOptions = {
  targetCharacters?: number;
  overlapCharacters?: number;
};

const defaultTargetCharacters = 1_000;
const defaultOverlapCharacters = 100;

export class ContextChunkingService {
  chunk(input: string, options: ContextChunkingOptions = {}): ContextChunkDraft[] {
    const targetCharacters = options.targetCharacters ?? defaultTargetCharacters;
    const overlapCharacters = options.overlapCharacters ?? defaultOverlapCharacters;
    const normalized = normalizeText(input);
    if (!normalized) {
      return [];
    }

    const chunks: string[] = [];
    for (const paragraph of normalized.split(/\n\n+/).map((part) => part.trim()).filter(Boolean)) {
      if (paragraph.length <= targetCharacters) {
        appendParagraph(chunks, paragraph, targetCharacters);
        continue;
      }

      for (const segment of splitLongText(paragraph, targetCharacters, overlapCharacters)) {
        appendParagraph(chunks, segment, targetCharacters);
      }
    }

    return chunks
      .map((content) => content.trim())
      .filter(Boolean)
      .map((content, index) => ({
        chunkIndex: index,
        content,
        tokenEstimate: Math.max(1, Math.ceil(content.length / 4))
      }));
  }
}

export function normalizeText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function appendParagraph(chunks: string[], paragraph: string, targetCharacters: number): void {
  const current = chunks[chunks.length - 1];
  if (!current || current.length + paragraph.length + 2 > targetCharacters) {
    chunks.push(paragraph);
    return;
  }
  chunks[chunks.length - 1] = `${current}\n\n${paragraph}`;
}

function splitLongText(
  text: string,
  targetCharacters: number,
  overlapCharacters: number
): string[] {
  const segments: string[] = [];
  let start = 0;

  while (start < text.length) {
    const hardEnd = Math.min(start + targetCharacters, text.length);
    const end = hardEnd === text.length ? hardEnd : findWordBoundary(text, start, hardEnd);
    const segment = text.slice(start, end).trim();
    if (segment) {
      segments.push(segment);
    }
    if (end >= text.length) {
      break;
    }
    const nextStart = Math.max(0, end - overlapCharacters);
    const boundedStart = findForwardWordBoundary(text, nextStart, end);
    start = boundedStart <= start ? end : boundedStart;
  }

  return segments;
}

function findWordBoundary(text: string, start: number, preferredEnd: number): number {
  const minEnd = Math.min(preferredEnd, start + Math.floor((preferredEnd - start) * 0.75));
  for (let index = preferredEnd; index > minEnd; index -= 1) {
    if (/\s/.test(text[index] ?? "")) {
      return index;
    }
  }
  return preferredEnd;
}

function findForwardWordBoundary(text: string, start: number, fallback: number): number {
  for (let index = start; index < fallback; index += 1) {
    if (!/\s/.test(text[index] ?? "")) {
      return index;
    }
  }
  return start;
}
