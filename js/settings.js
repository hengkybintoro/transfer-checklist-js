// Memuat config.js dengan parameter waktu (per menit). Tanpa ini, setelah config.js diubah dan di-push,
// browser/CDN GitHub Pages bisa terus memakai salinan lama sampai ±10 menit.
// Di mode server, /config.js dibuat server dan parameter ini diabaikan.
const bucket = Math.floor(Date.now() / 60000);
const mod = await import(`../config.js?v=${bucket}`);

export default mod.default;
