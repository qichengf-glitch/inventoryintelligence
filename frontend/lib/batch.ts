export type ParsedBatchNumber = {
  year: number;
  month: number;
  inferredDate: string;
};

export type BatchParserTestCase = {
  input: string;
  expected: string;
};

const YEAR_BASE = 2000;

function toInferredDate(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * Parse batch code with fixed positions:
 * - 1st char is ignored (e.g. "A")
 * - 2nd-3rd chars are 2-digit year (mapped as 2000 + yy)
 * - 4th-5th chars are month (01-12)
 * - remaining chars do not carry date info
 *
 * Returns null when input is invalid:
 * - too short
 * - year/month segment is not numeric
 * - month is outside 1..12
 */
export function parseBatchNumber(batch: string): ParsedBatchNumber | null {
  const text = String(batch ?? "").trim();
  if (text.length < 5) return null;

  const yy = text.slice(1, 3);
  const mm = text.slice(3, 5);
  if (!/^\d{2}$/.test(yy) || !/^\d{2}$/.test(mm)) return null;

  const year = YEAR_BASE + Number(yy);
  const month = Number(mm);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  return {
    year,
    month,
    inferredDate: toInferredDate(year, month),
  };
}

export const BATCH_PARSER_TEST_CASES: BatchParserTestCase[] = [
  { input: "A21052866", expected: "2021-05" },
  { input: "B24120001", expected: "2024-12" },
  { input: "A99010001", expected: "2099-01" }, // TODO: introduce configurable century strategy if needed.
  { input: "A21130001", expected: "invalid" },
  { input: "A21", expected: "invalid" },
];

export function runParseBatchNumberSelfTest() {
  return BATCH_PARSER_TEST_CASES.map((testCase) => {
    const parsed = parseBatchNumber(testCase.input);
    const actual = parsed ? `${parsed.year}-${String(parsed.month).padStart(2, "0")}` : "invalid";
    return {
      ...testCase,
      actual,
      passed: actual === testCase.expected,
    };
  });
}

