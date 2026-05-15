export function parseBrowserInputModule(trimmedPython: string): boolean {
  return trimmedPython.includes('from grim.raylib_api import rl')
    && trimmedPython.includes('class ActionMap(msgspec.Struct):')
    && trimmedPython.includes('def is_key_down(key: int) -> bool:')
    && trimmedPython.includes('def was_key_pressed(key: int) -> bool:')
    && trimmedPython.includes('def is_mouse_button_down(button: int) -> bool:')
    && trimmedPython.includes('def was_mouse_button_pressed(button: int) -> bool:')
    && trimmedPython.includes('def mouse_position() -> tuple[int, int]:');
}
