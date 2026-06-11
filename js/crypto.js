/* crypto.js
   AES-256-GCM 對稱加密 — 用於保護存在 GitHub repo 的書籤資料
   使用瀏覽器內建 Web Crypto API，不依賴任何第三方套件
   - 每次加密產生隨機 salt(16B) + iv(12B)，附在密文前面
   - 從密碼用 PBKDF2(310000次) 派生 AES-256 金鑰
   - 輸出格式：base64(salt[16] + iv[12] + ciphertext) */

'use strict';

const CRYPTO_SALT_LEN = 16;
const CRYPTO_IV_LEN   = 12;
const CRYPTO_ITER     = 310000; // OWASP 建議最低值

/* 把密碼字串轉成 CryptoKey */
async function _deriveKey(password, salt){
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, hash: 'SHA-256', iterations: CRYPTO_ITER },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/* 加密：plaintext string → base64 string */
async function cryptoEncrypt(plaintext, password){
  const enc  = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(CRYPTO_SALT_LEN));
  const iv   = crypto.getRandomValues(new Uint8Array(CRYPTO_IV_LEN));
  const key  = await _deriveKey(password, salt);

  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );

  // 組合：salt + iv + ciphertext
  const result = new Uint8Array(CRYPTO_SALT_LEN + CRYPTO_IV_LEN + cipherBuf.byteLength);
  result.set(salt, 0);
  result.set(iv, CRYPTO_SALT_LEN);
  result.set(new Uint8Array(cipherBuf), CRYPTO_SALT_LEN + CRYPTO_IV_LEN);

  // 轉 base64
  return btoa(String.fromCharCode(...result));
}

/* 解密：base64 string → plaintext string，密碼錯誤拋出 Error */
async function cryptoDecrypt(b64, password){
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const salt  = bytes.slice(0, CRYPTO_SALT_LEN);
  const iv    = bytes.slice(CRYPTO_SALT_LEN, CRYPTO_SALT_LEN + CRYPTO_IV_LEN);
  const data  = bytes.slice(CRYPTO_SALT_LEN + CRYPTO_IV_LEN);
  const key   = await _deriveKey(password, salt);

  try {
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(plainBuf);
  } catch(_){
    throw new Error('解密失敗：密碼錯誤或資料損壞');
  }
}
