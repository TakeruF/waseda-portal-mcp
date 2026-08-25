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
  $("tr").each((_index, row) => {
    const cells = $(row).find("th,td");
    if (cells.length >= 2) {
      const key = cleanText($(cells[0]).text()).replace(/[：:]$/, "");
      const value = cleanText(cells.slice(1).text());
      if (key !== "" && value !== "") values.set(key, value);
    }
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
