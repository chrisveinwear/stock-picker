import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import {
  parseMorningstarCsv,
  saveMorningstarRows,
  getAllLatestMorningstar,
} from "@/lib/morningstar";
import { getQuotes } from "@/lib/yahoo-finance";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Convert the first worksheet of an .xlsx upload to CSV text so the filled-in
 *  download template (see ./template) round-trips through the CSV parser. */
async function xlsxToCsv(buffer: ArrayBuffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return "";

  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) {
      cells.push(escape(row.getCell(c).text ?? ""));
    }
    lines.push(cells.join(","));
  });
  return lines.join("\n");
}

export const dynamic = "force-dynamic";

/** GET — latest Morningstar snapshot per ticker (sorted cheapest by P/FV). */
export async function GET() {
  try {
    return NextResponse.json({ rows: getAllLatestMorningstar() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST — import a Morningstar portfolio export.
 * - JSON body: { csv: string, filename?: string, asOf?: string }
 * - Raw .xlsx body (Content-Type spreadsheetml, filename via X-Filename header)
 *   — e.g. the filled-in download template; first worksheet is imported.
 * - Or a raw text/csv body. The parser is tolerant of column/format changes.
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    let csv = "";
    let filename: string | undefined;
    let asOf: string | undefined;

    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { csv?: string; filename?: string; asOf?: string };
      csv = body.csv ?? "";
      filename = body.filename;
      asOf = body.asOf;
    } else if (contentType.includes(XLSX_MIME)) {
      csv = await xlsxToCsv(await req.arrayBuffer());
      filename = req.headers.get("x-filename") ?? undefined;
    } else {
      csv = await req.text();
    }

    if (!csv.trim()) {
      return NextResponse.json({ error: "empty CSV body" }, { status: 400 });
    }

    const result = parseMorningstarCsv(csv, { asOf, filename });
    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          error: "no usable rows parsed",
          detectedColumns: result.detectedColumns,
          skipped: result.skipped,
        },
        { status: 422 }
      );
    }

    // Rows that gave a dollar Fair Value instead of a ratio need a live price
    // to derive Price/Fair Value (price ÷ fair value) before saving. getQuotes
    // silently drops tickers it can't fetch (invalid/delisted symbols etc.) —
    // track those so the caller can surface it instead of a silent blank.
    const needsPrice = result.rows.filter((r) => r.priceToFairValue == null && r.fairValue != null);
    const priceWarnings: string[] = [];
    if (needsPrice.length > 0) {
      const quotes = await getQuotes(needsPrice.map((r) => r.ticker));
      const priceByTicker = new Map(quotes.map((q) => [q.ticker, q.lastPrice]));
      for (const row of result.rows) {
        if (row.priceToFairValue == null && row.fairValue != null) {
          const price = priceByTicker.get(row.ticker);
          if (price && price > 0) {
            row.priceToFairValue = price / row.fairValue;
          } else {
            priceWarnings.push(row.ticker);
          }
        }
      }
    }

    const saved = saveMorningstarRows(result.rows, result.asOfDate);

    return NextResponse.json({
      saved,
      asOfDate: result.asOfDate,
      detectedColumns: result.detectedColumns,
      rows: result.rows,
      skipped: result.skipped,
      priceWarnings,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
