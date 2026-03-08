const RAW_STORY_ID_SOURCE = String.raw`[\d.]+`;
const CANONICAL_STORY_ID_PATTERN = /^(\d+)\.(\d+)$/;

export interface CanonicalStoryIdParts {
  epic: number;
  story: number;
}

export const STORY_HEADER_PATTERN = new RegExp(
  String.raw`^###\s+Story\s+(${RAW_STORY_ID_SOURCE}):\s+(.+)`
);

export function createFixPlanStoryLinePattern(): RegExp {
  return new RegExp(
    String.raw`^\s*-\s*\[([ xX])\]\s*Story\s+(${RAW_STORY_ID_SOURCE}):\s*(.+?)$`,
    "gm"
  );
}

export function createOpenFixPlanStoryLinePattern(): RegExp {
  return new RegExp(String.raw`^(\s*-\s*)\[ \](\s*Story\s+(${RAW_STORY_ID_SOURCE}):)`, "gm");
}

export function isCanonicalStoryId(value: string): boolean {
  return CANONICAL_STORY_ID_PATTERN.test(value);
}

export function parseCanonicalStoryId(value: string): CanonicalStoryIdParts | null {
  const match = value.match(CANONICAL_STORY_ID_PATTERN);
  if (!match) {
    return null;
  }

  return {
    epic: Number(match[1]),
    story: Number(match[2]),
  };
}

export function compareStoryIds(left: string, right: string): number {
  const leftParts = parseCanonicalStoryId(left);
  const rightParts = parseCanonicalStoryId(right);

  if (leftParts && rightParts) {
    if (leftParts.epic !== rightParts.epic) {
      return leftParts.epic - rightParts.epic;
    }

    return leftParts.story - rightParts.story;
  }

  if (leftParts) {
    return -1;
  }

  if (rightParts) {
    return 1;
  }

  return left.localeCompare(right);
}

export function formatStoryAnchor(value: string): string {
  return value.replaceAll(".", "-");
}

export function formatMalformedStoryIdWarning(id: string, title: string): string {
  return `Malformed story ID "${id}" in "${title}" (expected format: N.M)`;
}
