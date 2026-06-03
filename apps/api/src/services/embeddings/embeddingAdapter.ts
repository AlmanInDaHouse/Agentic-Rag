export interface EmbeddingAdapter {
  readonly name: string;
  readonly provider: string;
  readonly dimension: number;

  embedText(input: string): Promise<number[]>;
  embedBatch(inputs: string[]): Promise<number[][]>;
}
