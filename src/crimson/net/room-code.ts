// Port of crimson/net/room_code.py

export type RoomCode = string;

function validateRoomCode(value: string): RoomCode {
  if (value.length < ROOM_CODE_LENGTH || value.length > ROOM_CODE_LENGTH || !new RegExp(`^[a-z0-9]{${ROOM_CODE_LENGTH}}$`).test(value)) {
    throw new Error('invalid RoomCode');
  }
  return value;
}

export const ROOM_CODE_LENGTH = 4;

export function parseRoomCode(value: string): RoomCode {
  return validateRoomCode(value.trim().toLowerCase());
}

export function parseOptionalRoomCode(value: string | null): RoomCode | null {
  const text = (value || '').trim();
  if (!text) {
    return null;
  }
  return parseRoomCode(text);
}
