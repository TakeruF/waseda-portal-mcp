import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";

export function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function labeledValues($: CheerioAPI): Map<string, string> {
  const values = new Map<string, string>();
  const set = (rawKey: string, rawValue: string): void => {
    const key = cleanText(rawKey).replace(/[：:]$/, "");
    const value = cleanText(rawValue);
    if (key !== "" && value !== "") values.set(key, value);
  };
  const joinText = (cells: AnyNode[]): string =>
    cells.map((cell) => $(cell).text()).join(" ");
  $("tr").each((_index, row) => {
    const cells = $(row).find("th,td").toArray();
    if (cells.length < 2) return;
    const isHeader = (cell: AnyNode): boolean =>
      (cell as unknown as { tagName?: string }).tagName === "th";
    const headerCount = cells.filter(isHeader).length;
    // Waseda detail tables put several label/value pairs in one row. Pair each
    // header with the cells that follow it; a single header keeps the older
    // "first cell labels the rest" reading.
    if (headerCount > 1 && headerCount < cells.length) {
      let index = 0;
      while (index < cells.length) {
        if (!isHeader(cells[index]!)) {
          index += 1;
          continue;
        }
        let next = index + 1;
        while (next < cells.length && !isHeader(cells[next]!)) next += 1;
        if (next > index + 1)
          set($(cells[index]).text(), joinText(cells.slice(index + 1, next)));
        index = next;
      }
      return;
    }
    set($(cells[0]).text(), joinText(cells.slice(1)));
  });
  $("dt").each((_index, node) => {
    const key = cleanText($(node).text()).replace(/[：:]$/, "");
    const value = cleanText($(node).next("dd").text());
    if (key !== "" && value !== "") values.set(key, value);
  });
  return values;
}

export function firstText(
  $node: Cheerio<AnyNode>,
  selectors: string[],
): string | undefined {
  for (const selector of selectors) {
    const value = cleanText($node.find(selector).first().text());
    if (value !== "") return value;
  }
  return undefined;
}

export function firstAttribute(
  $node: Cheerio<AnyNode>,
  selectors: string[],
  attribute: string,
): string | undefined {
  for (const selector of selectors) {
    const value = $node.find(selector).first().attr(attribute)?.trim();
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}
