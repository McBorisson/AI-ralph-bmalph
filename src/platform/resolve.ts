import { join } from "node:path";
import { isEnoent, formatError } from "../utils/errors.js";
import { warn } from "../utils/logger.js";
import { readJsonFile } from "../utils/json.js";
import { CONFIG_FILE } from "../utils/constants.js";
import { getPlatform, isPlatformId } from "./registry.js";
import { detectPlatform } from "./detect.js";
import type { Platform, PlatformId } from "./types.js";

function extractConfiguredPlatform(data: unknown): PlatformId | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const platform = (data as Record<string, unknown>).platform;
  if (typeof platform !== "string" || !isPlatformId(platform)) {
    return null;
  }

  return platform;
}

/**
 * Resolve the platform for a project from its config, defaulting to claude-code.
 *
 * Used by doctor and upgrade commands to determine which platform checks and
 * assets to use. Falls back to claude-code when config is missing or unreadable.
 */
export async function resolveProjectPlatform(projectDir: string): Promise<Platform> {
  try {
    const config = await readJsonFile<unknown>(join(projectDir, CONFIG_FILE));
    const configuredPlatform = extractConfiguredPlatform(config);
    if (configuredPlatform) {
      return getPlatform(configuredPlatform);
    }
  } catch (err) {
    if (!isEnoent(err)) {
      warn(`Failed to read project config: ${formatError(err)}`);
    }
  }

  const detection = await detectPlatform(projectDir);
  if (detection.detected) {
    return getPlatform(detection.detected);
  }

  return getPlatform("claude-code");
}
