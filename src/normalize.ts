const diacriticsRegex = /[\u0300-\u036f]/g;
const regexŁ = /ł/g;
const regexÑ = /ñ/g;

/**
 * Normalizes text for fuzzy comparison:
 * - Lowercase
 * - Remove diacritics (é → e, ü → u)
 * - Handle special characters (ł → l, ñ → n)
 * - Trim whitespace
 */
export const normalizeText = (str: string): string =>
	str
		.toLowerCase()
		.normalize("NFD")
		.replace(diacriticsRegex, "")
		.replace(regexŁ, "l")
		.replace(regexÑ, "n")
		.trim();
