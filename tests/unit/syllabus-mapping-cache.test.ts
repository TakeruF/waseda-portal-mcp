import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LocalSyllabusMappingCache } from "../../src/adapters/waseda/matching/syllabus-mapping-cache.js";

describe("LocalSyllabusMappingCache", () => {
  it("persists only courseId to syllabusKey outside the repository", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "waseda-map-"));
    const filePath = path.join(directory, "course-syllabus-map.json");
    try {
      const cache = new LocalSyllabusMappingCache(filePath);
      await cache.set("waseda:moodle:synthetic-1", "SYNTHETIC-PUBLIC-KEY");
      expect(await cache.get("waseda:moodle:synthetic-1")).toBe(
        "SYNTHETIC-PUBLIC-KEY",
      );
      const content = await fs.readFile(filePath, "utf8");
      expect(content).not.toContain("courseName");
      expect(content).not.toContain("instructor");
      expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
