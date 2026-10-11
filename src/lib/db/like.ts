/** Escape LIKE/ILIKE wildcards so user input is matched literally. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
