/**
 * Phone photos are often 3–8 MB. Before upload, an image larger than
 * TARGET_BYTES (or in a format the server does not take, such as HEIC the
 * browser can still decode) is redrawn as a JPEG with its longer side at most
 * MAX_SIDE pixels. PDFs and small images go as they are.
 */
const MAX_SIDE = 2000;
const TARGET_BYTES = 1.5 * 1024 * 1024;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);

export const shrinkImage = async (file: File): Promise<Blob> => {
  if (!file.type.startsWith("image/")) return file;
  if (ACCEPTED.has(file.type) && file.size <= TARGET_BYTES) return file;
  if (typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");

    if (!context) return file;

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );

    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
};
