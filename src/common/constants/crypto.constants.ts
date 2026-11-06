/** Algorithm of every opaque hash / checksum the backend computes: refresh and activation tokens at rest, the login lock-out keys and the checksums of ingested files. */
export const HASH_ALGORITHM = 'sha256';

/** Text encoding of every token and digest (random bytes and hash output are stored/compared as hex). */
export const HEX_ENCODING = 'hex';

/** Random bytes behind every opaque token (refresh and activation tokens). */
export const SECURE_TOKEN_BYTES = 32;
