import { defineConfig } from 'oxfmt'

// Matches the existing house style: single quotes, no semicolons.
export default defineConfig({
  useTabs: true,
  ignorePatterns: ['dist']
})
