import { defineConfig } from 'oxlint'

// oxlint lints .js/.ts/.jsx/.tsx and the <script> blocks of .astro files.
// TS config support is experimental upstream but stable enough on Node 24.
export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc'],
  categories: { correctness: 'error' },
  rules: {},
  env: { builtin: true },
  ignorePatterns: []
})
