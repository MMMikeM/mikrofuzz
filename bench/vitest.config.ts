import { defineConfig } from "vitest/config";

// Benchmarks write machine-readable results to results.json alongside the table.
export default defineConfig({
	test: {
		benchmark: {
			outputJson: "results.json",
		},
	},
});
