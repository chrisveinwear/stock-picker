import { NextRequest, NextResponse } from "next/server";
import {
  parseMorningstarCsv,
  saveMorningstarRows,
  getAllLatestMorningstar,
} from "@/lib/morningstar";

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
 * POST — import a Morningstar portfolio CSV export.
 * Body (JSON): { csv: string, filename?: string, asOf?: string }
 * Or a raw text/csv body. The parser is tolerant of column/format changes.
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

    const saved = saveMorningstarRows(result.rows, result.asOfDate);

    return NextResponse.json({
      saved,
      asOfDate: result.asOfDate,
      detectedColumns: result.detectedColumns,
      rows: result.rows,
      skipped: result.skipped,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
