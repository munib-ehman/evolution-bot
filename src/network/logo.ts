import { safeLogo } from './model.mjs';

export async function prepareLogo(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  if (file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error('Choose a logo smaller than 5 MB.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('This image could not be read. Choose another logo.'); }
  try {
    if (bitmap.width > 4096 || bitmap.height > 4096) throw new Error('Use a logo no larger than 4096 × 4096 pixels.');
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/webp', .85);
    if (!safeLogo(data)) throw new Error('The processed logo is too large. Try a simpler image.');
    return data;
  } finally { bitmap.close(); }
}
