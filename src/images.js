// Imagens dos relatórios: arquivos guardados na pasta "images" ao lado dos cadastros.
// Cada categoria pode ter uma imagem padrão e cada relatório pode ter a sua (imageId).
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { categoryOf } from './categories.js';
import { db } from './store.js';

export const IMAGE_DIR = path.join(path.dirname(config.dataFile), 'images');
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const TYPES = {
  png: { ext: 'png', mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpeg: { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { ext: 'webp', mime: 'image/webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
};

// Descobre o tipo pelo conteúdo do arquivo (não confia na extensão nem no cabeçalho enviado).
export function detectImage(buffer) {
  return Object.values(TYPES).find((t) => buffer.length > 12 && t.test(buffer)) || null;
}

export async function saveImageFile(id, type, buffer) {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  await fs.writeFile(path.join(IMAGE_DIR, `${id}.${type.ext}`), buffer);
}

export async function deleteImageFile(image) {
  await fs.unlink(path.join(IMAGE_DIR, image.file)).catch(() => {});
}

export function imagePath(image) {
  return path.join(IMAGE_DIR, image.file);
}

// Imagem que vale para um relatório: a dele, senão a da categoria, senão nenhuma.
export function reportImageId(report) {
  const id = report.imageId || categoryOf(report)?.imageId || null;
  return id && db().images.some((i) => i.id === id) ? id : null;
}

export const imageUrl = (id) => (id ? `/api/images/${id}` : null);
