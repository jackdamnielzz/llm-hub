import type { Attachment } from "./types";

const TEXT_EXT =
  /\.(txt|md|csv|tsv|json|ya?ml|xml|html?|css|jsx?|tsx?|py|java|kt|go|rs|rb|php|sql|sh|log|toml|ini|svg)$/i;
const MAX_TEXT = 300_000;
const MAX_IMAGE = 5_000_000;

export async function readFile(file: File): Promise<Attachment> {
  if (file.type.startsWith("image/")) {
    if (file.size > MAX_IMAGE) throw new Error(`${file.name} is te groot (max 5 MB).`);
    return { name: file.name, type: file.type, dataUrl: await toDataUrl(file) };
  }
  if (file.type.startsWith("text/") || file.type === "application/json" || TEXT_EXT.test(file.name)) {
    if (file.size > MAX_TEXT) throw new Error(`${file.name} is te groot (max 300 KB).`);
    return { name: file.name, type: file.type || "text/plain", text: await file.text() };
  }
  throw new Error(`${file.name}: dit bestandstype wordt nog niet ondersteund (gebruik tekst of afbeeldingen).`);
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
