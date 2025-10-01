export function decodeEntities(str = "") {
  return str
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").trim();
}

export function cleanText(str = "") {
  return decodeEntities(str)
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function minutesFromISO(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}
