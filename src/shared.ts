const validWordBoundaries = new Set('  []()-–—\'"""'.split("").concat([".", ",", ":", ";", "/"]));

export const isValidWordBoundary = (char: string): boolean => validWordBoundaries.has(char);
