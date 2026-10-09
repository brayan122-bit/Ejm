// Generación y verificación de TOTP (RFC 6238), cifrado AES-256-GCM y códigos de recuperación sin dependencias externas.
import crypto from 'node:crypto';

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Obtiene la clave de 256 bits para cifrar el secreto TOTP y los códigos de recuperación.
 * Es estrictamente obligatoria la variable MFA_CLAVE_CIFRADO (sin respaldo en SESSION_SECRET).
 */
export function obtenerClaveCifradoMFA() {
  const claveEnv = (process.env.MFA_CLAVE_CIFRADO || '').trim();
  if (!claveEnv || claveEnv.length < 16) {
    throw Object.assign(new Error('Falta configurar MFA_CLAVE_CIFRADO en el servidor (mínimo 16 caracteres).'), { publico: true });
  }
  return crypto.createHash('sha256').update(claveEnv).digest(); // 32 bytes para AES-256
}

/**
 * Cifra el secreto TOTP usando AES-256-GCM con un IV aleatorio único de 12 bytes.
 * Formato resultante: enc:gcm1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
 */
export function cifrarSecreto(secretoPlano) {
  if (!secretoPlano) return null;
  const key = obtenerClaveCifradoMFA();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(secretoPlano), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:gcm1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Descifra el secreto TOTP cifrado con AES-256-GCM.
 * Si el valor no tiene el prefijo de cifrado (datos previos), lo devuelve tal cual.
 */
export function descifrarSecreto(secretoCifrado) {
  if (!secretoCifrado) return null;
  const str = String(secretoCifrado).trim();
  if (!str.startsWith('enc:gcm1:')) {
    return str; // Compatibilidad con texto plano legado
  }
  const parts = str.split(':');
  if (parts.length !== 5) throw new Error('Formato de secreto cifrado inválido.');
  const iv = Buffer.from(parts[2], 'base64');
  const authTag = Buffer.from(parts[3], 'base64');
  const ciphertext = Buffer.from(parts[4], 'base64');
  const key = obtenerClaveCifradoMFA();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Genera un secreto aleatorio en Base32 (longitud por defecto 20 bytes = 32 caracteres Base32).
 */
export function generarSecretoBase32(longitudBytes = 20) {
  const bytes = crypto.randomBytes(longitudBytes);
  let bits = '';
  for (let i = 0; i < bytes.length; i++) {
    bits += bytes[i].toString(2).padStart(8, '0');
  }
  let b32 = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5);
    b32 += B32_ALPHABET[parseInt(chunk, 2)];
  }
  return b32;
}

/**
 * Convierte una cadena Base32 a Buffer.
 */
export function base32ABuffer(b32) {
  const limpio = String(b32 || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = '';
  for (let i = 0; i < limpio.length; i++) {
    const idx = B32_ALPHABET.indexOf(limpio[i]);
    if (idx === -1) throw new Error('Carácter Base32 no válido: ' + limpio[i]);
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Calcula el código TOTP numérico de 6 dígitos para un instante dado (por defecto Date.now()).
 */
export function calcularTOTP(secretoB32, timestampMs = Date.now(), pasoSegundos = 30) {
  const key = base32ABuffer(secretoB32);
  const contador = Math.floor(timestampMs / 1000 / pasoSegundos);
  const bufContador = Buffer.alloc(8);
  bufContador.writeBigUInt64BE(BigInt(contador), 0);

  const hmac = crypto.createHmac('sha1', key).update(bufContador).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binario = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;

  return String(binario).padStart(6, '0');
}

/**
 * Verifica un código TOTP contra el secreto en una ventana de +/- ventana pasos (30s cada uno).
 */
export function verificarTOTP(secretoB32, codigo, ventana = 1) {
  const c = String(codigo || '').trim();
  if (!/^\d{6}$/.test(c)) return false;
  const ahora = Date.now();
  for (let step = -ventana; step <= ventana; step++) {
    const t = ahora + (step * 30 * 1000);
    const esperado = calcularTOTP(secretoB32, t);
    const bEsperado = Buffer.from(esperado);
    const bIngresado = Buffer.from(c);
    if (bEsperado.length === bIngresado.length && crypto.timingSafeEqual(bEsperado, bIngresado)) {
      return true;
    }
  }
  return false;
}

/**
 * Genera N códigos de recuperación de 10 caracteres legibles en bloques de 5 (ej. ABCDE-FGHIJ).
 */
export function generarCodigosRecuperacion(cantidad = 8) {
  const codigos = [];
  for (let i = 0; i < cantidad; i++) {
    const hex = crypto.randomBytes(5).toString('hex').toUpperCase();
    codigos.push(hex.slice(0, 5) + '-' + hex.slice(5));
  }
  return codigos;
}

/**
 * Calcula el hash HMAC-SHA256 de un código de recuperación en mayúsculas sin guiones,
 * empleando una clave del servidor derivada criptográficamente de MFA_CLAVE_CIFRADO.
 */
export function hashCodigoRecuperacion(codigo) {
  const limpio = String(codigo || '').trim().replace(/[\s-]/g, '').toUpperCase();
  const mfaKey = obtenerClaveCifradoMFA();
  const hmacKey = crypto.createHmac('sha256', mfaKey).update('bienestar360-mfa-recovery-key').digest();
  return crypto.createHmac('sha256', hmacKey).update(limpio).digest('hex');
}
