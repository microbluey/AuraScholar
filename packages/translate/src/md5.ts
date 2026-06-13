// Compact, dependency-free MD5 (RFC 1321). Needed for Baidu Translate's request
// signature (sign = md5(appid + query + salt + key)). UTF-8 aware. Not for
// security — only for the vendor's signing scheme.

export function md5(input: string): string {
  const bytes = utf8Bytes(input);
  const words = bytesToWords(bytes);
  const bitLen = bytes.length * 8;

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  // Pad: append 0x80, zero-fill, then 64-bit little-endian length.
  words[bitLen >> 5] = (words[bitLen >> 5] ?? 0) | (0x80 << bitLen % 32);
  words[(((bitLen + 64) >>> 9) << 4) + 14] = bitLen;

  for (let i = 0; i < words.length; i += 16) {
    const oa = a;
    const ob = b;
    const oc = c;
    const od = d;

    a = ff(a, b, c, d, words[i] ?? 0, 7, -680876936);
    d = ff(d, a, b, c, words[i + 1] ?? 0, 12, -389564586);
    c = ff(c, d, a, b, words[i + 2] ?? 0, 17, 606105819);
    b = ff(b, c, d, a, words[i + 3] ?? 0, 22, -1044525330);
    a = ff(a, b, c, d, words[i + 4] ?? 0, 7, -176418897);
    d = ff(d, a, b, c, words[i + 5] ?? 0, 12, 1200080426);
    c = ff(c, d, a, b, words[i + 6] ?? 0, 17, -1473231341);
    b = ff(b, c, d, a, words[i + 7] ?? 0, 22, -45705983);
    a = ff(a, b, c, d, words[i + 8] ?? 0, 7, 1770035416);
    d = ff(d, a, b, c, words[i + 9] ?? 0, 12, -1958414417);
    c = ff(c, d, a, b, words[i + 10] ?? 0, 17, -42063);
    b = ff(b, c, d, a, words[i + 11] ?? 0, 22, -1990404162);
    a = ff(a, b, c, d, words[i + 12] ?? 0, 7, 1804603682);
    d = ff(d, a, b, c, words[i + 13] ?? 0, 12, -40341101);
    c = ff(c, d, a, b, words[i + 14] ?? 0, 17, -1502002290);
    b = ff(b, c, d, a, words[i + 15] ?? 0, 22, 1236535329);

    a = gg(a, b, c, d, words[i + 1] ?? 0, 5, -165796510);
    d = gg(d, a, b, c, words[i + 6] ?? 0, 9, -1069501632);
    c = gg(c, d, a, b, words[i + 11] ?? 0, 14, 643717713);
    b = gg(b, c, d, a, words[i] ?? 0, 20, -373897302);
    a = gg(a, b, c, d, words[i + 5] ?? 0, 5, -701558691);
    d = gg(d, a, b, c, words[i + 10] ?? 0, 9, 38016083);
    c = gg(c, d, a, b, words[i + 15] ?? 0, 14, -660478335);
    b = gg(b, c, d, a, words[i + 4] ?? 0, 20, -405537848);
    a = gg(a, b, c, d, words[i + 9] ?? 0, 5, 568446438);
    d = gg(d, a, b, c, words[i + 14] ?? 0, 9, -1019803690);
    c = gg(c, d, a, b, words[i + 3] ?? 0, 14, -187363961);
    b = gg(b, c, d, a, words[i + 8] ?? 0, 20, 1163531501);
    a = gg(a, b, c, d, words[i + 13] ?? 0, 5, -1444681467);
    d = gg(d, a, b, c, words[i + 2] ?? 0, 9, -51403784);
    c = gg(c, d, a, b, words[i + 7] ?? 0, 14, 1735328473);
    b = gg(b, c, d, a, words[i + 12] ?? 0, 20, -1926607734);

    a = hh(a, b, c, d, words[i + 5] ?? 0, 4, -378558);
    d = hh(d, a, b, c, words[i + 8] ?? 0, 11, -2022574463);
    c = hh(c, d, a, b, words[i + 11] ?? 0, 16, 1839030562);
    b = hh(b, c, d, a, words[i + 14] ?? 0, 23, -35309556);
    a = hh(a, b, c, d, words[i + 1] ?? 0, 4, -1530992060);
    d = hh(d, a, b, c, words[i + 4] ?? 0, 11, 1272893353);
    c = hh(c, d, a, b, words[i + 7] ?? 0, 16, -155497632);
    b = hh(b, c, d, a, words[i + 10] ?? 0, 23, -1094730640);
    a = hh(a, b, c, d, words[i + 13] ?? 0, 4, 681279174);
    d = hh(d, a, b, c, words[i] ?? 0, 11, -358537222);
    c = hh(c, d, a, b, words[i + 3] ?? 0, 16, -722521979);
    b = hh(b, c, d, a, words[i + 6] ?? 0, 23, 76029189);
    a = hh(a, b, c, d, words[i + 9] ?? 0, 4, -640364487);
    d = hh(d, a, b, c, words[i + 12] ?? 0, 11, -421815835);
    c = hh(c, d, a, b, words[i + 15] ?? 0, 16, 530742520);
    b = hh(b, c, d, a, words[i + 2] ?? 0, 23, -995338651);

    a = ii(a, b, c, d, words[i] ?? 0, 6, -198630844);
    d = ii(d, a, b, c, words[i + 7] ?? 0, 10, 1126891415);
    c = ii(c, d, a, b, words[i + 14] ?? 0, 15, -1416354905);
    b = ii(b, c, d, a, words[i + 5] ?? 0, 21, -57434055);
    a = ii(a, b, c, d, words[i + 12] ?? 0, 6, 1700485571);
    d = ii(d, a, b, c, words[i + 3] ?? 0, 10, -1894986606);
    c = ii(c, d, a, b, words[i + 10] ?? 0, 15, -1051523);
    b = ii(b, c, d, a, words[i + 1] ?? 0, 21, -2054922799);
    a = ii(a, b, c, d, words[i + 8] ?? 0, 6, 1873313359);
    d = ii(d, a, b, c, words[i + 15] ?? 0, 10, -30611744);
    c = ii(c, d, a, b, words[i + 6] ?? 0, 15, -1560198380);
    b = ii(b, c, d, a, words[i + 13] ?? 0, 21, 1309151649);
    a = ii(a, b, c, d, words[i + 4] ?? 0, 6, -145523070);
    d = ii(d, a, b, c, words[i + 11] ?? 0, 10, -1120210379);
    c = ii(c, d, a, b, words[i + 2] ?? 0, 15, 718787259);
    b = ii(b, c, d, a, words[i + 9] ?? 0, 21, -343485551);

    a = add(a, oa);
    b = add(b, ob);
    c = add(c, oc);
    d = add(d, od);
  }

  return wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
}

function add(x: number, y: number): number {
  const lsw = (x & 0xffff) + (y & 0xffff);
  const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xffff);
}

function rol(num: number, cnt: number): number {
  return (num << cnt) | (num >>> (32 - cnt));
}

function cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
  return add(rol(add(add(a, q), add(x, t)), s), b);
}

function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn((b & c) | (~b & d), a, b, x, s, t);
}
function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn((b & d) | (c & ~d), a, b, x, s, t);
}
function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn(b ^ c ^ d, a, b, x, s, t);
}
function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn(c ^ (b | ~d), a, b, x, s, t);
}

function utf8Bytes(str: string): number[] {
  return Array.from(new TextEncoder().encode(str));
}

function bytesToWords(bytes: number[]): number[] {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] = (words[i >> 2] ?? 0) | ((bytes[i] ?? 0) << ((i % 4) * 8));
  }
  return words;
}

function wordToHex(value: number): string {
  let hex = "";
  for (let i = 0; i < 4; i++) {
    hex += ((value >> (i * 8 + 4)) & 0x0f).toString(16) + ((value >> (i * 8)) & 0x0f).toString(16);
  }
  return hex;
}
