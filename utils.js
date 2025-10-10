
// Fonctions JS classiques pour compatibilité totale HTML <script>

// Ajoute un padding zéro devant un chiffre (<10)
function pad2(num) {
  return String(num).padStart(2, '0');
}

// Décode les entités HTML courantes
function decodeEntities(str = "") {
  return str
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/'/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

// Nettoie une chaîne (suppression balises HTML et caractères spéciaux)
function cleanText(str = "") {
  return decodeEntities(str)
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Calcule le nombre de minutes entre une date ISO et maintenant
function minutesFromISO(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}
