import { describe, it, expect } from "vitest";
import config from "../vitest.config.js";

describe("vitest.config", () => {
  it("excludes e2e suites from the default test run", () => {
    const exclude = config.test?.exclude;

    expect(Array.isArray(exclude)).toBe(true);
    expect(exclude).toContain("tests/e2e/**/*.e2e.test.ts");
  });
});
