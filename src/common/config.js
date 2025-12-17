const CINEMETA_URL = "https://v3-cinemeta.strem.io";
const OPENSUBTITLES_URL = "https://opensubtitles-v3.strem.io";
const STREMIO_API_URL = "https://api.strem.io";
// In dev, proxy Stremio through Vue dev server to avoid CORS (see vue.config.js proxy).
const STREMIO_STREAMING_SERVER_RAW = "http://localhost:11470";
const STREMIO_STREAMING_SERVER = process.env.NODE_ENV === 'development' ? "/stremio" : STREMIO_STREAMING_SERVER_RAW;
const ADDON_COMMUNITY_LIST = 'https://stremio-addons.netlify.app/';
const HLS_PLAYLIST = "stream-q-720.m3u8";
// Sensible dev defaults so the app still works when .env files aren't present/injected.
const WS_SERVER = process.env.VUE_APP_WS_SERVER || "ws://localhost:8181";
const HTTP_SERVER = WS_SERVER.replace(/^ws(s)?:\/\//, (m, s) => s ? 'https://' : 'http://');
const APP_TITLE = process.env.VUE_APP_TITLE || "Peario";

export {
    CINEMETA_URL,
    OPENSUBTITLES_URL,
    STREMIO_API_URL,
    STREMIO_STREAMING_SERVER_RAW,
    STREMIO_STREAMING_SERVER,
    ADDON_COMMUNITY_LIST,
    HLS_PLAYLIST,
    WS_SERVER,
    HTTP_SERVER,
    APP_TITLE
};