import type { Attachment } from "./types";

const TEXT_EXT =
  /\.(txt|md|csv|tsv|json|ya?ml|xml|html?|css|jsx?|tsx?|py|java|kt|go|rs|rb|php|sql|sh|log|toml|ini|svg)$/i;
const MAX_TEXT = 300_000; // tekens die we naar het model sturen
const MAX_IMAGE = 5_000_000;
const MAX_BINARY = 15_000_000;

export async function readFile(file: File): Promise<Attachment> {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/")) {
    if (file.size > MAX_IMAGE) throw new Error(`${file.name} is te groot (max 5 MB).`);
    return { name: file.name, type: file.type, dataUrl: await toDataUrl(file) };
  }

  if (name.endsWith(".pdf")) {
    if (file.size > MAX_BINARY) throw new Error(`${file.name} is te groot (max 15 MB).`);
    return { name: file.name, type: "application/pdf", text: clip(await pdfText(file)) };
  }
  if (name.endsWith(".docx")) {
    if (file.size > MAX_BINARY) throw new Error(`${file.name} is te groot (max 15 MB).`);
    return { name: file.name, type: file.type, text: clip(await wordText(file)) };
  }
  if (/\.(xlsx|xls|ods)$/.test(name)) {
    if (file.size > MAX_BINARY) throw new Error(`${file.name} is te groot (max 15 MB).`);
    return { name: file.name, type: file.type, text: clip(await sheetText(file)) };
  }

  if (file.type.startsWith("text/") || file.type === "application/json" || TEXT_EXT.test(file.name)) {
    if (file.size > MAX_TEXT) throw new Error(`${file.name} is te groot (max 300 KB).`);
    return { name: file.name, type: file.type || "text/plain", text: await file.text() };
  }
  throw new Error(`${file.name}: dit bestandstype wordt nog niet ondersteund (gebruik PDF, Word, Excel, tekst of afbeeldingen).`);
}

function clip(t: string): string {
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + "\n\n[... ingekort, het bestand is te lang]" : t;
}

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : ""))
      .join("");
    parts.push(`--- Pagina ${i} ---\n${text}`);
  }
  return parts.join("\n\n");
}

async function wordText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value;
}

async function sheetText(file: File): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return wb.SheetNames.map((n) => `--- Blad: ${n} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join("\n\n");
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
