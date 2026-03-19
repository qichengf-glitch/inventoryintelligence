import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AbcClass = "A" | "B" | "C";
type XyzClass = "X" | "Y" | "Z";

type ReportRequest = {
  matrix: Record<AbcClass, Record<XyzClass, number>>;
  total_skus: number;
  lang?: "zh" | "en";
};

function buildPrompt(matrix: Record<AbcClass, Record<XyzClass, number>>, total: number, lang: "zh" | "en"): string {
  const rows: string[] = [];
  for (const abc of ["A", "B", "C"] as AbcClass[]) {
    for (const xyz of ["X", "Y", "Z"] as XyzClass[]) {
      const n = matrix[abc][xyz];
      if (n > 0) rows.push(`${abc}${xyz}: ${n} SKUs`);
    }
  }

  const ax = matrix.A.X, ay = matrix.A.Y, az = matrix.A.Z;
  const bx = matrix.B.X, by = matrix.B.Y, bz = matrix.B.Z;
  const cx = matrix.C.X, cy = matrix.C.Y, cz = matrix.C.Z;
  const aTotal = ax + ay + az;
  const cTotal = cx + cy + cz;
  const zTotal = az + bz + cz;
  const axPct = total > 0 ? Math.round((ax / total) * 100) : 0;
  const czPct = total > 0 ? Math.round((cz / total) * 100) : 0;

  if (lang === "zh") {
    return `你是一位库存管理专家。以下是一个企业库存的 ABC/XYZ 分类分析结果，请基于这些数据生成一份简洁的中文分析报告（150-250字）。

数据概览（共 ${total} 个 SKU）：
${rows.join("\n")}

补充统计：
- A 类 SKU 合计：${aTotal}，占 ${total > 0 ? Math.round((aTotal / total) * 100) : 0}%
- C 类 SKU 合计：${cTotal}，占 ${total > 0 ? Math.round((cTotal / total) * 100) : 0}%
- AX（高价值·稳定）：${ax} 个，占 ${axPct}%
- AZ（高价值·波动大）：${az} 个，需重点关注
- CZ（低价值·不规则）：${cz} 个，占 ${czPct}%
- 全局 Z 类（需求不规则）SKU：${zTotal} 个

分类定义：A=前80%销量贡献，B=80-95%，C=后5%；X=变异系数<0.5（稳定），Y=0.5-1.0（波动），Z>1.0（不规则）。

请按以下结构输出报告（不要用 Markdown 标题，用自然段落）：
1. 整体分布总结（1-2句）
2. 关键发现与风险点（2-3句，重点提AX/AZ/CZ）
3. 具体管理建议（2-3条，针对不同象限）
语言简洁专业，面向库存管理决策者。`;
  }

  return `You are an inventory management expert. The following is an ABC/XYZ classification result for a company's inventory. Generate a concise analytical report (150-250 words) in English.

Data overview (${total} total SKUs):
${rows.join("\n")}

Additional stats:
- Class A total: ${aTotal} (${total > 0 ? Math.round((aTotal / total) * 100) : 0}%)
- Class C total: ${cTotal} (${total > 0 ? Math.round((cTotal / total) * 100) : 0}%)
- AX (high-value, stable): ${ax} SKUs (${axPct}%)
- AZ (high-value, erratic): ${az} SKUs — needs attention
- CZ (low-value, erratic): ${cz} SKUs (${czPct}%)
- Total Z-class (erratic demand): ${zTotal} SKUs

Definitions: A=top 80% sales, B=80-95%, C=bottom 5%; X=CoV<0.5 (stable), Y=0.5-1.0 (variable), Z>1.0 (erratic).

Structure the report in natural paragraphs (no Markdown headings):
1. Overall distribution summary (1-2 sentences)
2. Key findings and risk highlights (2-3 sentences, focus on AX/AZ/CZ)
3. Specific management recommendations (2-3 points per quadrant)
Keep it concise and professional, aimed at inventory managers.`;
}

export async function POST(req: NextRequest) {
  try {
    const body: ReportRequest = await req.json();
    const { matrix, total_skus, lang = "zh" } = body;

    if (!matrix || total_skus === undefined) {
      return NextResponse.json({ error: "matrix and total_skus are required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
    }

    const model = process.env.OPENAI_REPORT_MODEL || "gpt-4.1";
    const prompt = buildPrompt(matrix, total_skus, lang);

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        input: prompt,
      }),
    });

    if (!res.ok) {
      const raw = await res.text();
      return NextResponse.json({ error: `OpenAI error: ${raw}` }, { status: 502 });
    }

    const data = await res.json();
    const directText = typeof data?.output_text === "string" ? data.output_text.trim() : "";
    const outputArray = Array.isArray(data?.output) ? data.output : [];
    const fromOutput = outputArray
      .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
      .map((c: any) => (c?.type === "output_text" && typeof c?.text === "string" ? c.text : ""))
      .join("\n")
      .trim();

    const report = directText || fromOutput;
    if (!report) {
      return NextResponse.json({ error: "Empty response from AI" }, { status: 502 });
    }

    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate report" },
      { status: 500 }
    );
  }
}
