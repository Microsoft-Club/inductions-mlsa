// Photo limits shared by the browser (shrinking) and the server (refusing). Spec §2.

/** The browser shrinks every photo to this many pixels on its long side. */
export const PHOTO_LONG_SIDE = 800;

/** The server refuses anything bigger. A shrunk photo is about a tenth of this. */
export const MAX_PHOTO_BYTES = 1_048_576;
