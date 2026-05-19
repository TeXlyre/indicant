import { createHash } from 'node:crypto'

export function hashRoomKey(input: string, domain: string): string {
    return createHash('sha256').update(domain).update('\n').update(input).digest('base64url')
}

export function roomKeyFromUuid(roomUuid: string): string {
    return hashRoomKey(hashRoomKey(roomUuid, 'indicant-room-h1'), 'indicant-room-h2')
}