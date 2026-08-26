import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadAcademicProfile } from "../../src/config/academic-profile.js";

describe("local academic profile", () => {
  it("loads an owner-only, explicitly supplied academic profile", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "waseda-academic-profile-"),
    );
    const profilePath = path.join(directory, "profile.json");
    try {
      await fs.writeFile(
        profilePath,
        JSON.stringify({
          schemaVersion: 1,
          affiliations: ["例示学部"],
          academicLevel: "undergraduate",
          year: 3,
          completedPrerequisites: ["合成基礎科目"],
        }),
        { mode: 0o600 },
      );
      await expect(loadAcademicProfile(profilePath)).resolves.toMatchObject({
        year: 3,
        affiliations: ["例示学部"],
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("returns undefined when the optional profile does not exist", async () => {
    await expect(
      loadAcademicProfile(
        path.join(os.tmpdir(), "waseda-profile-does-not-exist.json"),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects a profile readable by group or other users", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "waseda-academic-profile-mode-"),
    );
    const profilePath = path.join(directory, "profile.json");
    try {
      await fs.writeFile(
        profilePath,
        JSON.stringify({ schemaVersion: 1, year: 2 }),
        { mode: 0o644 },
      );
      await expect(loadAcademicProfile(profilePath)).rejects.toThrow(
        "owner-only",
      );
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
