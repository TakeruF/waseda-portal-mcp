import type { SourceReference } from "../models/schemas.js";

export function sourceReference(
  source: SourceReference["source"],
  url: string,
  observedAt = new Date(),
  sourceUpdatedAt?: string,
): SourceReference {
  return {
    source,
    url,
    observedAt: observedAt.toISOString(),
    ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt }),
  };
}
