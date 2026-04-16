import { VitestConfig } from "@savvy-web/vitest";

export default VitestConfig.create({
	coverage: VitestConfig.COVERAGE_LEVELS.standard,
	coverageTargets: VitestConfig.COVERAGE_LEVELS.strict,
});
