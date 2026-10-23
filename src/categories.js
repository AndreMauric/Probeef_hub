// Categorias de relatório: nome, descrição e imagem padrão. Cada relatório aponta para uma
// categoria (categoryId) e herda dela a descrição e a imagem, a menos que tenha as suas.
// O nome da categoria também fica copiado no relatório (report.category) para buscas e relatórios de uso.
import { db, newId } from './store.js';

const key = (name) => String(name || '').trim().toLowerCase();

export function findCategory(id) {
  return db().categories.find((c) => c.id === id) || null;
}

export function categoryByName(name) {
  return db().categories.find((c) => key(c.name) === key(name)) || null;
}

// Usa a categoria com esse nome (sem diferenciar maiúsculas) ou cria uma nova.
export function ensureCategory(name) {
  const clean = String(name || '').trim().slice(0, 60) || 'Geral';
  const existing = categoryByName(clean);
  if (existing) return existing;
  const category = { id: newId(), name: clean, description: '', imageId: null, createdAt: new Date().toISOString() };
  db().categories.push(category);
  return category;
}

export const categoryOf = (report) => findCategory(report.categoryId);

// Depois de renomear uma categoria, atualiza a cópia do nome nos relatórios.
export function syncCategoryName(category) {
  for (const r of db().reports) if (r.categoryId === category.id) r.category = category.name;
}

export const sortByName = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
