export function renderQuestLevelModule(relativePath: string): string {
  return `// Port of ${relativePath}

import { questByLevel } from './registry.ts';

export const QUEST_STAGE_COUNT = 5;
export const QUESTS_PER_STAGE = 10;
export const QUEST_COUNT = QUEST_STAGE_COUNT * QUESTS_PER_STAGE;

export type QuestStageMajor = number;
export type QuestStageMinor = number;

function _pythonRepr(value: string): string {
  const text = String(value);
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    if (ch === '\\\\' || ch === quote) {
      out += '\\\\' + ch;
    } else {
      out += ch;
    }
  }
  return out + quote;
}

export class QuestLevel {
  public readonly major: number;
  public readonly minor: number;

  constructor(opts: { major: number; minor: number }) {
    const major = opts.major;
    const minor = opts.minor;
    if (
      !Number.isInteger(major) || !Number.isInteger(minor) ||
      major < 1 || major > QUEST_STAGE_COUNT ||
      minor < 1 || minor > QUESTS_PER_STAGE
    ) {
      throw new Error(\`invalid quest level: '\${major}.\${minor}'\`);
    }
    this.major = major;
    this.minor = minor;
  }

  static parse(value: string): QuestLevel {
    const trimmed = String(value).trim();
    const parts = trimmed.split('.');
    if (parts.length !== 2) {
      throw new Error(\`invalid quest level: \${_pythonRepr(value)}\`);
    }
    const majorText = parts[0].trim();
    const minorText = parts[1].trim();
    if (!/^[+-]?\\d+$/.test(majorText) || !/^[+-]?\\d+$/.test(minorText)) {
      throw new Error(\`invalid quest level: \${_pythonRepr(value)}\`);
    }
    const major = int(Number(majorText));
    const minor = int(Number(minorText));
    try {
      return new QuestLevel({ major, minor });
    } catch {
      throw new Error(\`invalid quest level: \${_pythonRepr(value)}\`);
    }
  }

  static fromGlobalIndex(index: number): QuestLevel {
    if (!Number.isInteger(index) || index < 0 || index >= QUEST_COUNT) {
      throw new Error(\`quest global index out of range: \${index} (expected 0..\${QUEST_COUNT - 1})\`);
    }
    const major = Math.floor(index / QUESTS_PER_STAGE) + 1;
    const minor = (index % QUESTS_PER_STAGE) + 1;
    return new QuestLevel({ major, minor });
  }

  get text(): string {
    return \`\${this.major}.\${this.minor}\`;
  }

  get globalIndex(): number {
    return (this.major - 1) * QUESTS_PER_STAGE + (this.minor - 1);
  }

  get title(): string {
    const quest = questByLevel(this);
    if (quest === null) {
      throw new Error(\`unknown quest level: \${this.text}\`);
    }
    return String(quest.title);
  }

  equal(other: QuestLevel | null): boolean {
    if (other === null) return false;
    return this.major === other.major && this.minor === other.minor;
  }

  toString(): string {
    return this.text;
  }
}
`;
}
