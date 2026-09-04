import { describe, expect, it } from "vitest";

import { parseAcademicCalendar } from "../../src/adapters/waseda/academic-calendar/calendar-parser.js";
import { parseClassChanges } from "../../src/adapters/waseda/mywaseda/change-parser.js";
import {
  parseSyllabus,
  parseSyllabusSearch,
} from "../../src/adapters/waseda/syllabus/syllabus-parser.js";
import type { PortalError } from "../../src/core/errors/portal-error.js";
import { fixtureSnapshot } from "../helpers/fixtures.js";

describe("Waseda source parsers", () => {
  it("extracts cancellations and room changes", async () => {
    const changes = parseClassChanges(
      await fixtureSnapshot(
        "class-changes.html",
        "https://class.waseda.jp/kyuko/epb3010.htm",
      ),
    );
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      type: "cancellation",
      effectiveDate: "2026-07-23",
    });
    expect(changes[1]).toMatchObject({
      type: "room_change",
      effectiveDate: "2026-08-28",
    });
  });

  it("recognizes the current MyWaseda explicit empty state", () => {
    expect(
      parseClassChanges({
        url: "https://class.waseda.jp/kyuko/epb3010.htm",
        observedAt: new Date("2026-08-26T00:00:00Z"),
        html: `<!doctype html><body class="basecolor">
          <form method="post" action="epb3010.htm">
            <input type="submit" name="s_mode">
            <table class="subcolor"><tr><td>休講情報はありません</td></tr></table>
          </form>
        </body>`,
      }),
    ).toEqual([]);
  });

  it("does not confuse an unknown MyWaseda structure with no changes", () => {
    expect(() =>
      parseClassChanges({
        url: "https://class.waseda.jp/kyuko/epb3010.htm",
        observedAt: new Date("2026-08-26T00:00:00Z"),
        html: "<!doctype html><body><main>synthetic unknown layout</main></body>",
      }),
    ).toThrow(
      expect.objectContaining<Partial<PortalError>>({
        code: "PAGE_STRUCTURE_CHANGED",
      }),
    );
  });

  it("extracts Web Syllabus detail, schedule, room, and mode", async () => {
    const syllabus = parseSyllabus(
      await fixtureSnapshot(
        "syllabus.html",
        "https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=SYNTH-101&pLng=jp",
      ),
    );
    expect(syllabus).toMatchObject({
      key: "SYNTH-101",
      year: 2026,
      school: "基幹理工学部",
      allocatedYear: "学部2年以上",
      eligibleAffiliations: "例示学部の学生のみ",
      prerequisites: "合成基礎科目",
      eligibilityNotes: ["履修条件は人工データによる。"],
      deliveryMode: "in_person",
      exam: "試験に関する合成記載。",
    });
    expect(syllabus.schedules[0]).toMatchObject({
      weekday: 4,
      period: "2",
      room: "合成101室",
      campus: "西早稲田",
    });
  });

  it("reads rows that carry several label and value pairs", async () => {
    const syllabus = parseSyllabus(
      await fixtureSnapshot(
        "syllabus-multipair.html",
        "https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=SYNTH-MULTI-1&pLng=jp",
      ),
    );
    expect(syllabus).toMatchObject({
      // The fetchable pKey wins over the page's shorter internal 科目キー.
      key: "SYNTH-MULTI-1",
      year: 2026,
      courseName: "合成科目名 ０１",
      school: "合成学部",
      classCode: "01",
      publicCourseCode: "SYNX101L",
      allocatedYear: "２年以上",
      term: "春学期",
      deliveryMode: "in_person",
    });
    expect(syllabus.instructors).toEqual(["例 太郎"]);
    expect(syllabus.schedules).toEqual([
      {
        weekday: 3,
        weekdayLabel: "水曜日",
        period: "5",
        room: "１-２０３",
        campus: "合成キャンパス",
      },
    ]);
  });

  it("keeps the line structure the syllabus draws", async () => {
    const syllabus = parseSyllabus(
      await fixtureSnapshot(
        "syllabus-multipair.html",
        "https://www.wsl.waseda.jp/syllabus/JAA104.php?pKey=SYNTH-MULTI-1&pLng=jp",
      ),
    );
    expect(syllabus.overview).toBe("一行目の合成説明。\n二行目の合成説明。");
    expect(syllabus.evaluation).toBe(
      "割合 評価基準\n試験: 60％ 合成された期末試験。\nその他: 40％ 合成された小テスト。",
    );
    expect(syllabus.exam).toBe("60％ 合成された期末試験。");
    // A value holding a nested table is read once, not repeated per cell.
    expect(syllabus.plan).toBe("1: 合成回題目\n合成回の内容。");
  });

  it("extracts detail keys from the official JavaScript result links", async () => {
    const urls = parseSyllabusSearch(
      await fixtureSnapshot(
        "syllabus-search.html",
        "https://www.wsl.waseda.jp/syllabus/index.php",
      ),
    );
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("pKey=SYNTH-101");
  });

  it("normalizes relevant academic calendar events", async () => {
    const events = parseAcademicCalendar(
      await fixtureSnapshot(
        "academic-calendar.html",
        "https://www.waseda.jp/academic-calendar",
      ),
    );
    expect(events.map((item) => item.type)).toEqual([
      "classes_start",
      "break",
      "holiday_classes",
      "exam",
    ]);
    expect(events[1]).toMatchObject({ from: "2026-07-30", to: "2026-09-20" });
  });

  it("supports the official heading-and-paragraph academic calendar layout", async () => {
    const events = parseAcademicCalendar(
      await fixtureSnapshot(
        "academic-calendar-current.html",
        "https://www.waseda.jp/academic-calendar",
      ),
    );
    expect(
      events.some(
        (item) => item.type === "classes_start" && item.from === "2026-04-11",
      ),
    ).toBe(true);
    expect(
      events.some(
        (item) =>
          item.type === "break" &&
          item.from === "2026-12-22" &&
          item.to === "2027-01-05",
      ),
    ).toBe(true);
    expect(
      events.filter((item) => item.type === "holiday_classes"),
    ).toHaveLength(2);
    expect(events.filter((item) => item.type === "no_classes")).toHaveLength(2);
  });
});
