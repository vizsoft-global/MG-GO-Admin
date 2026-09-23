import { PDFDocument } from "pdf-lib";
import { stampSignatureOnLastPage, tinyPng } from "./esign-compose-stamp";
import {
  buildEsignDocumentHtml,
  sampleEmployee,
  type EsignDocumentInput,
} from "./esign-document-html";
import { computeBatchCap, computeChunkSize } from "./esign-batch-cap";
import { embeddedFontCss, launchEsignBrowser, renderEsignPdf } from "./esign-pdf-renderer";

const LONG_AR =
  "هذا نص طويل لاختبار صفحة ثانية. ".repeat(80) +
  " {{employee_name}} / {{employee_id}} / {{company_name}}";

export type EsignRenderBenchEnvironment = "local-chrome" | "vercel";

export type EsignRenderBenchReport = {
  measuredAt: string;
  environment: EsignRenderBenchEnvironment;
  vercel: boolean;
  region: string | null;
  planEstimatePerRowMs: number;
  chunkSize: number;
  batchCap: number;
  coldLaunchMs: number;
  en: {
    pages: number;
    bytes: number;
    firstMs: number;
    warmMs: number[];
    warmMedianMs: number;
  };
  ar: {
    pages: number;
    bytes: number;
    firstMs: number;
    warmMs: number[];
    warmMedianMs: number;
    twoPagePages: number;
    twoPageMs: number;
  };
  compose: {
    cases: Array<{
      name: string;
      pagesBefore: number;
      pagesAfter: number;
      pageCountUnchanged: boolean;
    }>;
    arabicSignerThrows: boolean;
    arabicMessage: string;
    guardedFallbackWorks: boolean;
    guardedRecommendation: string;
  };
  derived: {
    perRowWithIoMs: number;
    formulaChunk: number;
    formulaBatchCap: number;
  };
  capChanged: boolean;
  note: string;
};

export type EsignRenderBenchResult = {
  report: EsignRenderBenchReport;
  pdfs: {
    en: Uint8Array;
    ar: Uint8Array;
    arLong: Uint8Array;
  };
};

export function benchDocumentInput(
  language: "en" | "ar",
  body: string,
): Omit<EsignDocumentInput, "fontCss"> {
  return {
    language,
    header:
      language === "ar"
        ? "إشعار جزاء — {{employee_name}}"
        : "Penalty notice — {{employee_name}}",
    body,
    declaration:
      language === "ar" ? "أقر بأنني اطلعت على هذا المستند." : "I acknowledge this document.",
    description: language === "ar" ? "تأخير في التسليم" : "Late delivery",
    fields: [
      {
        key: "penalty_date",
        label: language === "ar" ? "تاريخ الجزاء" : "Penalty date",
        value: "2026-09-01",
      },
      {
        key: "decision",
        label: language === "ar" ? "القرار" : "Decision",
        value: "Warning",
      },
      {
        key: "action",
        label: language === "ar" ? "الإجراء" : "Action",
        value: "Deduct 5 KWD",
      },
    ],
    employee: sampleEmployee(),
  };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

async function timeRender(
  browser: Awaited<ReturnType<typeof launchEsignBrowser>>,
  spec: Omit<EsignDocumentInput, "fontCss">,
  n: number,
) {
  const times: number[] = [];
  let bytes: Uint8Array = new Uint8Array();
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    bytes = await renderEsignPdf(spec, browser);
    times.push(performance.now() - t0);
  }
  return { times, bytes };
}

async function inspect(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  return { pages: pdf.getPageCount(), bytes: bytes.byteLength };
}

export async function runEsignRenderBench(
  environment: EsignRenderBenchEnvironment,
): Promise<EsignRenderBenchResult> {
  const tLaunch = performance.now();
  const browser = await launchEsignBrowser();
  const coldLaunchMs = Math.round(performance.now() - tLaunch);

  try {
    const enSpec = benchDocumentInput("en", "Company {{company_name}}. Employee {{employee_id}}.");
    const arSpec = benchDocumentInput("ar", "الشركة {{company_name}}. الموظف {{employee_id}}.");
    const arLong = benchDocumentInput("ar", LONG_AR);

    const en1 = await timeRender(browser, enSpec, 4);
    const ar1 = await timeRender(browser, arSpec, 4);
    const ar2 = await timeRender(browser, arLong, 1);

    const enInfo = await inspect(en1.bytes);
    const arInfo = await inspect(ar1.bytes);
    const ar2Info = await inspect(ar2.bytes);

    const en = {
      pages: enInfo.pages,
      bytes: enInfo.bytes,
      firstMs: Math.round(en1.times[0] ?? 0),
      warmMs: en1.times.slice(1).map((n) => Math.round(n)),
      warmMedianMs: Math.round(median(en1.times.slice(1))),
    };
    const ar = {
      pages: arInfo.pages,
      bytes: arInfo.bytes,
      firstMs: Math.round(ar1.times[0] ?? 0),
      warmMs: ar1.times.slice(1).map((n) => Math.round(n)),
      warmMedianMs: Math.round(median(ar1.times.slice(1))),
      twoPagePages: ar2Info.pages,
      twoPageMs: Math.round(ar2.times[0] ?? 0),
    };

    const htmlEn = buildEsignDocumentHtml({ ...enSpec, fontCss: embeddedFontCss() });
    if (!htmlEn.includes('dir="ltr"') || !htmlEn.includes("Ahmed Ali")) {
      throw new Error("en html missing employee block");
    }
    if (!embeddedFontCss().includes("@font-face")) {
      throw new Error("embedded fonts missing from serverless bundle");
    }

    const composeCases = [];
    for (const [name, bytes] of [
      ["en-1", en1.bytes],
      ["ar-1", ar1.bytes],
      ["ar-2", ar2.bytes],
    ] as const) {
      const before = await PDFDocument.load(bytes);
      const beforePages = before.getPageCount();
      const stamped = await stampSignatureOnLastPage({
        pdfBytes: bytes,
        signaturePng: tinyPng(),
        captions: ["Signed by driver", "2026-09-23", "SIG-1401"],
      });
      composeCases.push({
        name,
        pagesBefore: beforePages,
        pagesAfter: stamped.pageCount,
        pageCountUnchanged: beforePages === stamped.pageCount,
      });
    }

    let arabicThrows = false;
    let arabicMessage = "";
    try {
      await stampSignatureOnLastPage({
        pdfBytes: en1.bytes,
        signaturePng: tinyPng(),
        captions: ["أحمد علي", "SIG-1401"],
      });
    } catch (err) {
      arabicThrows = true;
      arabicMessage = err instanceof Error ? err.message : String(err);
    }

    const guarded = await stampSignatureOnLastPage({
      pdfBytes: en1.bytes,
      signaturePng: tinyPng(),
      captions: ["أحمد علي", "SIG-1401"],
      dropUnencodableCaptions: true,
    });

    const perRowMs = Math.max(en.warmMedianMs, ar.warmMedianMs) + 300;
    const chunk = computeChunkSize(coldLaunchMs, perRowMs);
    const cap = computeBatchCap(chunk);

    const report: EsignRenderBenchReport = {
      measuredAt: new Date().toISOString(),
      environment,
      vercel: environment === "vercel",
      region: process.env.VERCEL_REGION ?? null,
      planEstimatePerRowMs: 1300,
      chunkSize: 25,
      batchCap: 500,
      coldLaunchMs,
      en,
      ar,
      compose: {
        cases: composeCases,
        arabicSignerThrows: arabicThrows,
        arabicMessage,
        guardedFallbackWorks: guarded.droppedCaptions.includes("أحمد علي"),
        guardedRecommendation: arabicThrows ? "guarded_fallback_required" : "no_guard_needed",
      },
      derived: {
        perRowWithIoMs: perRowMs,
        formulaChunk: chunk,
        formulaBatchCap: cap,
      },
      capChanged: chunk !== 25 || cap !== 500,
      note:
        environment === "vercel"
          ? "Vercel cold-start container. +300ms is upload+RPC allowance, not measured."
          : "Local Chrome. +300ms is upload+RPC allowance, not measured.",
    };

    return {
      report,
      pdfs: { en: en1.bytes, ar: ar1.bytes, arLong: ar2.bytes },
    };
  } finally {
    await browser.close();
  }
}
