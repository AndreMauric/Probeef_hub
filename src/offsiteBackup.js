// Cópia diária fora da Railway: o backup dos cadastros e o registro de acessos, comprimidos (gzip) e
// criptografados (AES-256-GCM) ANTES de sair do servidor, enviados a um armazenamento compatível com S3
// (Cloudflare R2, Backblaze B2, AWS S3). Assinatura AWS SigV4 feita aqui, sem SDK.
// Variáveis: BACKUP_S3_ENDPOINT (ex.: https://<conta>.r2.cloudflarestorage.com), BACKUP_S3_BUCKET,
// BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY, BACKUP_S3_REGION (R2: auto) e
// BACKUP_ENCRYPTION_KEY — guarde esta última também FORA da Railway: sem ela as cópias não abrem.
// Quanto tempo as cópias ficam: regra de ciclo de vida do próprio bucket (ex.: apagar após 90 dias).
// Abrir uma cópia: npm run decrypt-backup -- arquivo.enc
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';

const env = (name) => (process.env[name] || '').trim();
const settings = () => ({
  endpoint: env('BACKUP_S3_ENDPOINT').replace(/\/$/, ''),
  bucket: env('BACKUP_S3_BUCKET'),
  accessKeyId: env('BACKUP_S3_ACCESS_KEY_ID'),
  secretAccessKey: env('BACKUP_S3_SECRET_ACCESS_KEY'),
  region: env('BACKUP_S3_REGION') || 'auto',
  passphrase: env('BACKUP_ENCRYPTION_KEY'),
});
export const offsiteConfigured = () => {
  const s = settings();
  return Boolean(s.endpoint && s.bucket && s.accessKeyId && s.secretAccessKey && s.passphrase);
};

// ---- criptografia: "PBK1" + iv (12) + tag (16) + dados (gzip criptografado)
const MAGIC = Buffer.from('PBK1');
const keyFrom = (passphrase) => crypto.createHash('sha256').update(`probeef-backup|${passphrase}`).digest();

export function encryptBackup(plain, passphrase) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(passphrase), iv);
  const data = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), data]);
}

export function decryptBackup(buf, passphrase) {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('Este arquivo não é uma cópia criptografada do portal.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(passphrase), buf.subarray(4, 16));
  decipher.setAuthTag(buf.subarray(16, 32));
  try {
    return gunzipSync(Buffer.concat([decipher.update(buf.subarray(32)), decipher.final()]));
  } catch {
    throw new Error('Não foi possível abrir: a chave (BACKUP_ENCRYPTION_KEY) está errada ou o arquivo foi alterado.');
  }
}

// ---- AWS Signature V4 (cabeçalho Authorization)
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const encodePath = (p) => p.split('/').map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');

// headers: todos os que vão assinados (host incluso), nomes em minúsculas. Devolve o valor de Authorization.
export function signV4({ method, path: urlPath, headers, payloadHash, accessKeyId, secretAccessKey, region, amzDate, service = 's3' }) {
  const date = amzDate.slice(0, 8);
  const names = Object.keys(headers).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonical = [method, encodePath(urlPath), '', ...names.map((n) => `${n}:${lower[n]}`), '', names.join(';'), payloadHash].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
}

async function putObject(key, body) {
  const s = settings();
  const url = new URL(`${s.endpoint}/${s.bucket}/${key}`);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const payloadHash = sha256(body);
  const headers = { host: url.host, 'content-type': 'application/octet-stream', 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const authorization = signV4({ method: 'PUT', path: url.pathname, headers, payloadHash, accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey, region: s.region, amzDate });
  const { host, ...sent } = headers;
  const res = await fetch(url, { method: 'PUT', headers: { ...sent, Authorization: authorization }, body, signal: AbortSignal.timeout(120000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    throw Object.assign(new Error(`O armazenamento recusou o envio (${res.status}${code ? ` ${code}` : ''}).`), { status: 502 });
  }
}

// Envia a cópia do dia (cadastros + registro de acessos, se existir). Devolve { files: [{ key, bytes }] }.
export async function uploadOffsite(backupJson, day, logFile) {
  if (!offsiteConfigured()) throw Object.assign(new Error('A cópia externa não está configurada (variáveis BACKUP_S3_* e BACKUP_ENCRYPTION_KEY).'), { status: 503 });
  const { passphrase } = settings();
  const files = [{ key: `portal/db-${day}.json.gz.enc`, body: encryptBackup(backupJson, passphrase) }];
  const log = await fs.readFile(logFile).catch(() => null);
  if (log) files.push({ key: `portal/access-log-${day}.jsonl.gz.enc`, body: encryptBackup(log, passphrase) });
  for (const f of files) {
    await putObject(f.key, f.body).catch((err) => {
      throw Object.assign(err, { status: err.status || 502, message: err.status ? err.message : `Não foi possível falar com o armazenamento: ${err.message}` });
    });
  }
  return { files: files.map((f) => ({ key: f.key, bytes: f.body.length })) };
}
