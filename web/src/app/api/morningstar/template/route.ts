import ExcelJS from "exceljs";
import { MORNINGSTAR_TEMPLATE_COLUMNS } from "@/lib/morningstar";

export const dynamic = "force-dynamic";

/**
 * GET — downloadable Excel template for the Morningstar import.
 *
 * Built from MORNINGSTAR_TEMPLATE_COLUMNS so the headers always match what the
 * import parser recognises; fill in the "Import" sheet and upload the same
 * file (or a CSV export of it) via the Import Morningstar button. The filename
 * deliberately carries no date — the importer reads an as-of date from the
 * uploaded file's name and should fall back to the upload day, not the day the
 * template was downloaded.
 */
export async function GET() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "stock-picker";

  // ── Sheet 1: Import (what the parser reads) ──────────────────────────────
  const sheet = workbook.addWorksheet("Import");
  sheet.columns = MORNINGSTAR_TEMPLATE_COLUMNS.map((c) => ({
    header: c.header,
    key: c.concept,
    width: Math.max(c.header.length + 4, 18),
  }));
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8E8E8" },
  };
  headerRow.border = { bottom: { style: "thin" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  // ── Sheet 2: Notes (guidance + example — never parsed) ──────────────────
  const notes = workbook.addWorksheet("Notes");
  notes.columns = [
    { header: "Column", key: "header", width: 24 },
    { header: "How to fill it in", key: "guidance", width: 70 },
    { header: "Example", key: "example", width: 18 },
  ];
  notes.getRow(1).font = { bold: true };
  for (const c of MORNINGSTAR_TEMPLATE_COLUMNS) {
    notes.addRow({ header: c.header, guidance: c.guidance, example: c.example });
  }
  notes.addRow({});
  const tips = [
    "Fill in one row per stock on the Import sheet — leave the headers exactly as they are.",
    "Symbol plus at least one of Economic Moat or Fair Value is required; other cells can stay blank.",
    "Rows without Morningstar coverage (no moat AND no fair value) are skipped on import.",
    "Upload the filled-in file with the “Import Morningstar” button on the Research page — .xlsx or CSV both work.",
    "Each upload is stored as a dated snapshot and feeds the Morningstar lens in new research reports.",
  ];
  for (const t of tips) {
    const r = notes.addRow({ header: "", guidance: t });
    r.getCell(2).font = { italic: true, color: { argb: "FF666666" } };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="morningstar-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
