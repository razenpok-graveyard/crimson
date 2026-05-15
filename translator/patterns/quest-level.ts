export function parseQuestLevelModule(trimmedPython: string): boolean {
  return trimmedPython.includes('QUEST_STAGE_COUNT = 5')
    && trimmedPython.includes('QuestStageMajor: TypeAlias = Annotated[int, msgspec.Meta(ge=1, le=QUEST_STAGE_COUNT)]')
    && trimmedPython.includes('class QuestLevel(msgspec.Struct, frozen=True):')
    && trimmedPython.includes('def parse(cls, value: str) -> QuestLevel:')
    && trimmedPython.includes('def from_global_index(cls, index: int) -> QuestLevel:')
    && trimmedPython.includes('def global_index(self) -> int:')
    && trimmedPython.includes('def title(self) -> str:');
}
