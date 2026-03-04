import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { access, mkdir, readFile, writeFile } from "fs/promises";

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

const execFileAsync = promisify(execFile);

const TEMP_DIR = "/tmp/inventory-preprocess";

export const runtime = "nodejs";

type PreviewRow = Record<string, string | number | null>;

function resolvePreprocessScriptPath() {
  const candidates = [
    path.resolve(process.cwd(), "server/preprocessing/preprocess.py"),
    path.resolve(process.cwd(), "../server/preprocessing/preprocess.py"),
  ];

  return candidates;
}

async function findExistingPath(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error("Cannot find server/preprocessing/preprocess.py");
}

function parseCsvPreview(csvContent: string) {
  const workbook = XLSX.read(csvContent, { type: "string" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<PreviewRow>(sheet, { defval: null });

  return {
    columns: rows.length > 0 ? Object.keys(rows[0]) : [],
    rowCount: rows.length,
    preview: rows.slice(0, 20),
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file field" }, { status: 400 });
    }

    const fileName = file.name || "upload.csv";
    if (!fileName.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "Only CSV files are supported" }, { status: 400 });
    }

    await mkdir(TEMP_DIR, { recursive: true });

    const tempId = randomUUID();
    const rawPath = path.join(TEMP_DIR, `${tempId}.raw.csv`);
    const cleanedPath = path.join(TEMP_DIR, `${tempId}.cleaned.csv`);

    const inputBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(rawPath, inputBuffer);

    const scriptPath = await findExistingPath(resolvePreprocessScriptPath());
    const { stderr } = await execFileAsync("python3", [
      scriptPath,
      "--input",
      rawPath,
      "--output",
      cleanedPath,
    ]);

    const cleanedBuffer = await readFile(cleanedPath);
    const cleanedCsv = cleanedBuffer.toString("utf-8");
    const { columns, rowCount, preview } = parseCsvPreview(cleanedCsv);

    return NextResponse.json({
      tempFileId: tempId,
      originalFileName: fileName,
      cleanedFileName: `${path.parse(fileName).name}.cleaned.csv`,
      columns,
      rowCount,
      preview,
      warnings: stderr?.trim() ? [stderr.trim()] : [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preprocess failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
