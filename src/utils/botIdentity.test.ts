import { describe, expect, it } from "vitest";
import { formatBotIdentity } from "./botIdentity.js";

describe("formatBotIdentity", () => {
	it("returns a verified identity when slug and user ID are both present", () => {
		expect(formatBotIdentity({ appSlug: "acme-bot", appUserId: 123456 })).toEqual({
			name: "acme-bot[bot]",
			email: "123456+acme-bot[bot]@users.noreply.github.com",
		});
	});

	it("falls back to github-actions[bot] when no source is given", () => {
		expect(formatBotIdentity()).toEqual({
			name: "github-actions[bot]",
			email: "41898282+github-actions[bot]@users.noreply.github.com",
		});
	});

	it("falls back when only the slug is present", () => {
		expect(formatBotIdentity({ appSlug: "acme-bot" })).toEqual({
			name: "github-actions[bot]",
			email: "41898282+github-actions[bot]@users.noreply.github.com",
		});
	});

	it("falls back when only the user ID is present", () => {
		expect(formatBotIdentity({ appUserId: 123456 })).toEqual({
			name: "github-actions[bot]",
			email: "41898282+github-actions[bot]@users.noreply.github.com",
		});
	});
});
