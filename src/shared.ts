const validWordBoundaries = new Set('  []()-–—\'"""'.split(""));

export const isValidWordBoundary = (char: string): boolean => validWordBoundaries.has(char);
