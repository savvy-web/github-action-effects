import { describe, expect, it } from "vitest";
import {
	generatePackageViewUrl,
	getRegistryDisplayName,
	getRegistryType,
	isCustomRegistry,
	isGitHubPackagesRegistry,
	isJsrRegistry,
	isNpmRegistry,
} from "./RegistryClassifier.js";

describe("RegistryClassifier", () => {
	describe("isNpmRegistry", () => {
		it("returns true for registry.npmjs.org", () => {
			expect(isNpmRegistry("https://registry.npmjs.org/")).toBe(true);
		});

		it("returns true for registry.npmjs.org without trailing slash", () => {
			expect(isNpmRegistry("https://registry.npmjs.org")).toBe(true);
		});

		it("returns true for subdomains of npmjs.org", () => {
			expect(isNpmRegistry("https://subdomain.npmjs.org/")).toBe(true);
		});

		it("returns false for evil-npmjs.org (security check)", () => {
			expect(isNpmRegistry("https://evil-npmjs.org/")).toBe(false);
		});

		it("returns false for npmjs.org.evil.com (security check)", () => {
			expect(isNpmRegistry("https://npmjs.org.evil.com/")).toBe(false);
		});

		it("returns false for path containing npmjs.org (security check)", () => {
			expect(isNpmRegistry("https://evil.com/npmjs.org")).toBe(false);
		});

		it("returns false for GitHub Packages", () => {
			expect(isNpmRegistry("https://npm.pkg.github.com/")).toBe(false);
		});

		it("returns false for null", () => {
			expect(isNpmRegistry(null)).toBe(false);
		});

		it("returns false for undefined", () => {
			expect(isNpmRegistry(undefined)).toBe(false);
		});

		it("returns false for invalid URL", () => {
			expect(isNpmRegistry("not-a-url")).toBe(false);
		});
	});

	describe("isGitHubPackagesRegistry", () => {
		it("returns true for npm.pkg.github.com", () => {
			expect(isGitHubPackagesRegistry("https://npm.pkg.github.com/")).toBe(true);
		});

		it("returns true for subdomains of pkg.github.com", () => {
			expect(isGitHubPackagesRegistry("https://npm.pkg.github.com")).toBe(true);
		});

		it("returns false for evil-pkg.github.com (security check)", () => {
			expect(isGitHubPackagesRegistry("https://evil-pkg.github.com/")).toBe(false);
		});

		it("returns false for pkg.github.com.evil.com (security check)", () => {
			expect(isGitHubPackagesRegistry("https://pkg.github.com.evil.com/")).toBe(false);
		});

		it("returns false for npm registry", () => {
			expect(isGitHubPackagesRegistry("https://registry.npmjs.org/")).toBe(false);
		});

		it("returns false for null", () => {
			expect(isGitHubPackagesRegistry(null)).toBe(false);
		});
	});

	describe("isJsrRegistry", () => {
		it("returns true for jsr.io", () => {
			expect(isJsrRegistry("https://jsr.io/")).toBe(true);
		});

		it("returns true for subdomains of jsr.io", () => {
			expect(isJsrRegistry("https://registry.jsr.io/")).toBe(true);
		});

		it("returns false for evil-jsr.io (security check)", () => {
			expect(isJsrRegistry("https://evil-jsr.io/")).toBe(false);
		});

		it("returns false for null", () => {
			expect(isJsrRegistry(null)).toBe(false);
		});
	});

	describe("isCustomRegistry", () => {
		it("returns true for custom registries", () => {
			expect(isCustomRegistry("https://my-registry.example.com/")).toBe(true);
		});

		it("returns false for npm registry", () => {
			expect(isCustomRegistry("https://registry.npmjs.org/")).toBe(false);
		});

		it("returns false for GitHub Packages", () => {
			expect(isCustomRegistry("https://npm.pkg.github.com/")).toBe(false);
		});

		it("returns false for JSR", () => {
			expect(isCustomRegistry("https://jsr.io/")).toBe(false);
		});

		it("returns false for null", () => {
			expect(isCustomRegistry(null)).toBe(false);
		});

		it("returns false for undefined", () => {
			expect(isCustomRegistry(undefined)).toBe(false);
		});
	});

	describe("getRegistryType", () => {
		it("returns npm for npm registry", () => {
			expect(getRegistryType("https://registry.npmjs.org/")).toBe("npm");
		});

		it("returns github-packages for GitHub Packages", () => {
			expect(getRegistryType("https://npm.pkg.github.com/")).toBe("github-packages");
		});

		it("returns jsr for JSR", () => {
			expect(getRegistryType("https://jsr.io/")).toBe("jsr");
		});

		it("returns custom for custom registries", () => {
			expect(getRegistryType("https://my-registry.example.com/")).toBe("custom");
		});

		it("returns npm for null (absent registry defaults to npm)", () => {
			expect(getRegistryType(null)).toBe("npm");
		});

		it("returns npm for undefined (absent registry defaults to npm)", () => {
			expect(getRegistryType(undefined)).toBe("npm");
		});
	});

	describe("getRegistryDisplayName", () => {
		it("returns npm for npm registry", () => {
			expect(getRegistryDisplayName("https://registry.npmjs.org/")).toBe("npm");
		});

		it("returns GitHub Packages for GitHub Packages", () => {
			expect(getRegistryDisplayName("https://npm.pkg.github.com/")).toBe("GitHub Packages");
		});

		it("returns jsr.io for JSR", () => {
			expect(getRegistryDisplayName("https://jsr.io/")).toBe("jsr.io");
		});

		it("returns hostname for custom registries", () => {
			expect(getRegistryDisplayName("https://my-registry.example.com/")).toBe("my-registry.example.com");
		});

		it("returns npm for null (absent registry defaults to npm)", () => {
			expect(getRegistryDisplayName(null)).toBe("npm");
		});

		it("returns npm for undefined (absent registry defaults to npm)", () => {
			expect(getRegistryDisplayName(undefined)).toBe("npm");
		});

		it("returns original string for invalid URL", () => {
			expect(getRegistryDisplayName("not-a-url")).toBe("not-a-url");
		});
	});

	describe("generatePackageViewUrl", () => {
		it("returns npm package URL for npm registry", () => {
			expect(generatePackageViewUrl("https://registry.npmjs.org/", "@test/package")).toBe(
				"https://www.npmjs.com/package/@test/package",
			);
		});

		it("returns GitHub packages URL for GitHub Packages", () => {
			expect(generatePackageViewUrl("https://npm.pkg.github.com/", "@savvy-web/package")).toBe(
				"https://github.com/savvy-web/packages",
			);
		});

		it("returns undefined for unscoped package on GitHub Packages", () => {
			expect(generatePackageViewUrl("https://npm.pkg.github.com/", "unscoped-package")).toBeUndefined();
		});

		it("returns undefined for JSR registry", () => {
			expect(generatePackageViewUrl("https://jsr.io/", "@scope/pkg")).toBeUndefined();
		});

		it("returns undefined for custom registries", () => {
			expect(generatePackageViewUrl("https://my-registry.example.com/", "@test/package")).toBeUndefined();
		});

		it("returns undefined for null registry", () => {
			expect(generatePackageViewUrl(null, "@test/package")).toBeUndefined();
		});

		it("returns undefined for null package name", () => {
			expect(generatePackageViewUrl("https://registry.npmjs.org/", null)).toBeUndefined();
		});

		it("returns undefined for undefined package name", () => {
			expect(generatePackageViewUrl("https://registry.npmjs.org/", undefined)).toBeUndefined();
		});
	});
});
