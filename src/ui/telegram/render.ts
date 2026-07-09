import { z } from "zod";

import {
  cardSpecSchema,
  richTextSpecSchema,
  statusSpecSchema,
  tableSpecSchema,
} from "../../contracts/ui";

export type RichTextSpec = z.infer<typeof richTextSpecSchema>;
export type StatusSpec = z.infer<typeof statusSpecSchema>;
export type TableSpec = z.infer<typeof tableSpecSchema>;
export type CardSpec = z.infer<typeof cardSpecSchema>;

/**
 * Pure Telegram plain-text renderers for validated Param UI specs.
 *
 * These emit lightly structured plain text only. They never emit raw HTML or
 * Markdown, and never emit an em-dash character (dividers use "----").
 */

const STATE_MARKERS: Record<
  NonNullable<StatusSpec["rows"][number]["state"]>,
  string
> = {
  ok: "✅",
  warn: "⚠️",
  error: "❌",
  info: "ℹ️",
};

export function richTextToTelegram(spec: RichTextSpec): string {
  const lines: string[] = [];
  for (const block of spec.blocks) {
    switch (block.kind) {
      case "heading":
        if (block.text) lines.push(block.text.toUpperCase());
        break;
      case "paragraph":
        if (block.text) lines.push(block.text);
        break;
      case "quote":
        if (block.text) lines.push(`> ${block.text}`);
        break;
      case "bullet":
        for (const item of listItems(block)) {
          lines.push(`• ${item}`);
        }
        break;
      case "numbered":
        listItems(block).forEach((item, index) => {
          lines.push(`${index + 1}. ${item}`);
        });
        break;
      case "code":
        if (block.text) {
          for (const codeLine of block.text.split("\n")) {
            lines.push(`    ${codeLine}`);
          }
        }
        break;
      case "divider":
        lines.push("----");
        break;
      case "key_value":
        for (const pair of block.pairs ?? []) {
          lines.push(`${pair.key}: ${pair.value}`);
        }
        break;
    }
  }
  return lines.join("\n");
}

export function statusToTelegram(spec: StatusSpec): string {
  const lines: string[] = [];
  if (spec.title) lines.push(spec.title);
  for (const row of spec.rows) {
    const marker = row.state ? `${STATE_MARKERS[row.state]} ` : "";
    lines.push(`${marker}${row.label}: ${row.value}`);
  }
  return lines.join("\n");
}

export function tableToTelegram(spec: TableSpec): string {
  const widths = spec.columns.map((col, index) =>
    Math.max(col.length, ...spec.rows.map((row) => (row[index] ?? "").length)),
  );
  const formatRow = (cells: string[]): string =>
    cells.map((cell, index) => (cell ?? "").padEnd(widths[index] ?? 0)).join(" | ");

  const lines: string[] = [];
  if (spec.title) lines.push(spec.title);
  lines.push(formatRow(spec.columns));
  lines.push(widths.map((width) => "-".repeat(width)).join("-+-"));
  for (const row of spec.rows) {
    lines.push(formatRow(row));
  }
  return lines.join("\n");
}

export function cardToTelegram(spec: CardSpec): string {
  const lines: string[] = [spec.title];
  if (spec.body) lines.push(spec.body);
  for (const field of spec.fields ?? []) {
    lines.push(`${field.label}: ${field.value}`);
  }
  return lines.join("\n");
}

function listItems(block: RichTextSpec["blocks"][number]): string[] {
  if (block.items && block.items.length > 0) return block.items;
  return block.text ? [block.text] : [];
}
