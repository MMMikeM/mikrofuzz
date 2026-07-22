import { defineConfig } from "vitest/config";

// The library's own tests live in test/. The bench workspace has its own tests
// (which import comparison libs like uFuzzy) and runs them via its own script,
// so keep them out of the root run.
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
	},
});
