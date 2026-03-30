#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const parseAndAnnotate = () => {
	const commitlintResultsPath = join(process.cwd(), "commitlint-results.txt");

	// Check if file exists
	if (!existsSync(commitlintResultsPath)) {
		console.error("::error::Commitlint results file not found at commitlint-results.txt");
		process.exit(1);
	}

	let results;
	try {
		results = readFileSync(commitlintResultsPath, "utf8");

		// Check for empty file
		if (!results.trim()) {
			console.log("::notice::No commitlint output found");
			return;
		}
	} catch (error) {
		console.error(`::error::Failed to read commitlint results: ${error.message}`);
		process.exit(1);
	}

	let totalProblems = 0;
	let totalWarnings = 0;
	const lines = results.split("\n");
	let currentCommit = null;
	let hasAnnotations = false;

	for (const line of lines) {
		const trimmedLine = line.trim();

		// Skip empty lines and formatting lines
		if (!trimmedLine || trimmedLine.match(/^[⧗✔✖⚠]+$/)) {
			continue;
		}

		// Skip summary lines with problems/warnings count (they're redundant with individual issue annotations)
		if (trimmedLine.match(/found \d+ problems?, \d+ warnings?/)) {
			continue;
		}

		// Skip success lines and help text
		if (
			trimmedLine.includes("found 0 problems, 0 warnings") ||
			trimmedLine.startsWith("ⓘ   Get help:") ||
			trimmedLine.includes("ELIFECYCLE")
		) {
			continue;
		}

		// Detect commit input lines
		if (trimmedLine.startsWith("⧗   input: ")) {
			currentCommit = trimmedLine.replace("⧗   input: ", "").trim();
			continue;
		}

		// Detect error lines
		if (trimmedLine.startsWith("✖   ")) {
			totalProblems++;
			hasAnnotations = true;
			const message = trimmedLine.replace("✖   ", "").trim();
			console.log(`::error::${currentCommit ? `Commit "${currentCommit}": ` : ""}${message}`);
			continue;
		}

		// Detect warning lines
		if (trimmedLine.startsWith("⚠   ")) {
			totalWarnings++;
			hasAnnotations = true;
			const message = trimmedLine.replace("⚠   ", "").trim();
			console.log(`::warning::${currentCommit ? `Commit "${currentCommit}": ` : ""}${message}`);
		}
	}

	// Output final summary and set GitHub outputs for workflow decision-making
	if (hasAnnotations) {
		if (totalProblems > 0 || totalWarnings > 0) {
			console.log(
				`::notice::Commitlint validation completed: ${totalProblems} error(s) and ${totalWarnings} warning(s) total`,
			);
		}
	} else {
		console.log("::notice::All commits passed commitlint validation");
	}

	// Set GitHub outputs for workflow decision-making
	const githubOutputFile = process.env.GITHUB_OUTPUT;
	if (githubOutputFile) {
		appendFileSync(githubOutputFile, `errors=${totalProblems}\n`);
		appendFileSync(githubOutputFile, `warnings=${totalWarnings}\n`);
		appendFileSync(githubOutputFile, `has_errors=${totalProblems > 0}\n`);
		appendFileSync(githubOutputFile, `has_warnings=${totalWarnings > 0}\n`);
		appendFileSync(githubOutputFile, `warnings_only=${totalProblems === 0 && totalWarnings > 0}\n`);
	} else {
		// Fallback to deprecated set-output for older runners
		console.log(`::set-output name=errors::${totalProblems}`);
		console.log(`::set-output name=warnings::${totalWarnings}`);
		console.log(`::set-output name=has_errors::${totalProblems > 0}`);
		console.log(`::set-output name=has_warnings::${totalWarnings > 0}`);
		console.log(`::set-output name=warnings_only::${totalProblems === 0 && totalWarnings > 0}`);
	}
};

// Run the script
try {
	parseAndAnnotate();
} catch (error) {
	console.error(`::error::Unexpected error: ${error.message}`);
	process.exit(1);
}
