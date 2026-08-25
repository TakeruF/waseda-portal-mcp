import fs from "node:fs/promises";
import path from "node:path";

import * as z from "zod/v4";

const cacheSchema = z.object({
  version: z.literal(1),
  mappings: z.record(z.string().min(1), z.string().min(1)),
});

type CacheData = z.infer<typeof cacheSchema>;

export interface CourseSyllabusMappingCache {
  get(courseId: string): Promise<string | undefined>;
  set(courseId: string, syllabusKey: string): Promise<void>;
}

export class LocalSyllabusMappingCache implements CourseSyllabusMappingCache {
  #loaded: CacheData | undefined;

  constructor(private readonly filePath: string) {}

  async get(courseId: string): Promise<string | undefined> {
    return (await this.load()).mappings[courseId];
  }

  async set(courseId: string, syllabusKey: string): Promise<void> {
    const current = await this.load();
    if (current.mappings[courseId] === syllabusKey) return;
    const next: CacheData = {
      version: 1,
      mappings: { ...current.mappings, [courseId]: syllabusKey },
    };
    await fs.mkdir(path.dirname(this.filePath), {
      recursive: true,
      mode: 0o700,
    });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, this.filePath);
    this.#loaded = next;
  }

  private async load(): Promise<CacheData> {
    if (this.#loaded !== undefined) return this.#loaded;
    try {
      this.#loaded = cacheSchema.parse(
        JSON.parse(await fs.readFile(this.filePath, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#loaded = { version: 1, mappings: {} };
    }
    return this.#loaded;
  }
}
