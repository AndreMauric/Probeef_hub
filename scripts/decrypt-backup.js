// Abre uma cópia externa do backup (src/offsiteBackup.js): descriptografa e descompacta.
// Uso: BACKUP_ENCRYPTION_KEY="a chave" npm run decrypt-backup -- db-2026-11-03.json.gz.enc
// Sai ao lado, sem o ".gz.enc" (ex.: db-2026-11-03.json). O .json do portal se restaura em
// Admin → Visão geral → Backups → "Restaurar backup".
import fs from 'node:fs';
import { decryptBackup } from '../src/offsiteBackup.js';

const file = process.argv[2];
const passphrase = (process.env.BACKUP_ENCRYPTION_KEY || '').trim();
if (!file || !passphrase) {
  console.error('Uso: BACKUP_ENCRYPTION_KEY="a chave" npm run decrypt-backup -- arquivo.gz.enc');
  process.exit(1);
}
try {
  const out = file.replace(/\.gz\.enc$/, '').replace(/\.enc$/, '') || `${file}.json`;
  fs.writeFileSync(out === file ? `${file}.json` : out, decryptBackup(fs.readFileSync(file), passphrase));
  console.log(`Pronto: ${out === file ? `${file}.json` : out}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
