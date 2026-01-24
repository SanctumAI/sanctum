import * as nip19 from 'nostr-tools/nip19'

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

export function normalizePubkey(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('Missing pubkey')
  }

  if (HEX_PUBKEY_RE.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  if (trimmed.toLowerCase().startsWith('npub')) {
    let decoded
    try {
      decoded = nip19.decode(trimmed.toLowerCase())
    } catch {
      throw new Error('Invalid npub')
    }
    if (decoded.type !== 'npub') {
      throw new Error('Invalid npub')
    }
    if (typeof decoded.data !== 'string') {
      throw new Error('Invalid npub payload')
    }
    return decoded.data.toLowerCase()
  }

  throw new Error('Invalid pubkey format')
}
