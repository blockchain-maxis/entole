/**
 * Where the app lives, for the few places that have to say so in full: the
 * line on a receipt picture that says where it can be checked, and the picture
 * a shared receipt link shows in a chat. Both are read by someone, or
 * something, that is nowhere near this server, so a path is not enough.
 *
 * It is the same domain accounts are made on (`NEXT_PUBLIC_RP_ID`), and the
 * one the phone app reaches the server at; `tests/domain.test.ts` holds the
 * three together.
 */
export const SITE_ORIGIN = 'https://entole.pro';
