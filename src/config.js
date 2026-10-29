import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isProduction = process.env.NODE_ENV === 'production';

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProduction) {
    throw new Error('Defina SESSION_SECRET no .env antes de rodar em produção.');
  }
  sessionSecret = crypto.randomBytes(48).toString('base64');
  console.warn('[aviso] SESSION_SECRET não definido: usando um valor temporário. As sessões caem a cada reinício.');
}

export const config = {
  root,
  isProduction,
  port: Number(process.env.PORT || 3000),
  portalName: process.env.PORTAL_NAME || 'Probeef Analytics',
  // Endereço público do portal (usado nos links enviados pelo WhatsApp), ex.: https://bi.probeef.com.br
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  sessionSecret,
  dataFile: path.resolve(root, process.env.DATA_FILE || 'data/db.json'),
  powerbi: {
    tenantId: process.env.PBI_TENANT_ID || '',
    clientId: process.env.PBI_CLIENT_ID || '',
    clientSecret: process.env.PBI_CLIENT_SECRET || '',
    defaultWorkspaceId: process.env.PBI_WORKSPACE_ID || '',
  },
};
