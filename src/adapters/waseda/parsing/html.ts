import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";

/**
 * Marks a line the source actually draws. Source formatting newlines are not
 * line breaks, so whitespace is collapsed first and only these markers survive
 * into the result. U+2028 is a line separator that never appears in page text.
 */
const LINE_MARKER = "\u2028";
const BLOCK_ELEMENTS = "p,div,li,tr,blockquote,h1,h2,h3,h4,h5,h6";

export function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapses whitespace within each line while keeping the lines apart. */
export function cleanMultilineText(value: string): string {
  return value
    .split(LINE_MARKER)
    .map(cleanText)
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Reads an element's text with `<br>` and block boundaries turned into line
 * markers. Cells are separated by a space so a table row stays one line.
 */
function markedText($: CheerioAPI, node: AnyNode): string {
  const clone = $(node).clone();
  clone.find("br").replaceWith(LINE_MARKER);
  clone.find("td,th").append(" ");
  clone.find(BLOCK_ELEMENTS).append(LINE_MARKER);
  return clone.text();
}

export interface LabeledValueOptions {
  /**
   * Keep the line structure the source draws with `<br>` and nested rows.
   * Callers that feed values to a date or status parser should leave this off.
   */
  preserveLineBreaks?: boolean;
}

export function labeledValues(
  $: CheerioAPI,
  options: LabeledValueOptions = {},
): Map<string, string> {
  const values = new Map<string, string>();
  const cleanValue = options.preserveLineBreaks
    ? cleanMultilineText
    : cleanText;
  const set = (rawKey: string, rawValue: string): void => {
    const key = cleanText(rawKey).replace(/[：:]$/, "");
    const value = cleanValue(rawValue);
    if (key !== "" && value !== "") values.set(key, value);
  };
  const joinText = (cells: AnyNode[]): string =>
    cells
      .map((cell) =>
        options.preserveLineBreaks ? markedText($, cell) : $(cell).text(),
      )
      .join(" ");
  $("tr").each((_index, row) => {
    // Direct children only. A value that contains a nested table (the weekly
    // plan, the grading breakdown) would otherwise pick up every nested cell
    // a second time and repeat the whole block.
    const cells = $(row).children("th,td").toArray();
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
    const definition = $(node).next("dd")[0];
    if (definition === undefined) return;
    set(
      $(node).text(),
      options.preserveLineBreaks
        ? markedText($, definition)
        : $(definition).text(),
    );
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
