export function parseProfileHooksModule(trimmedPython: string): boolean {
  return trimmedPython.includes('class RenderProfileSink(Protocol):')
    && trimmedPython.includes('def profile_pass(name: str) -> Iterator[None]:')
    && trimmedPython.includes('_PASS_STACK: list[tuple[str, int]] = []')
    && trimmedPython.includes('time.perf_counter_ns()');
}
