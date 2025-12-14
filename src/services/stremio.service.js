import axios from "axios";
import { CINEMETA_URL, OPENSUBTITLES_URL, STREMIO_API_URL, STREMIO_STREAMING_SERVER, STREMIO_STREAMING_SERVER_RAW } from "@/common/config";

function toRawStremioUrl(url) {
    if (!url) return url;
    // Convert proxied URLs back to the real Stremio server URL when passing as a parameter to Stremio.
    if (url.startsWith('/stremio')) return `${STREMIO_STREAMING_SERVER_RAW}${url.replace('/stremio', '')}`;
    // Also handle absolute same-origin proxy URLs (e.g. http://localhost:8080/stremio/...)
    try {
        const u = new URL(url, window.location.origin);
        if (u.pathname.startsWith('/stremio')) {
            return `${STREMIO_STREAMING_SERVER_RAW}${u.pathname.replace('/stremio', '')}${u.search}`;
        }
    } catch (_) {
        // ignore
    }
    return url;
}

const StremioService = {

    async isServerOpen() {
        try {
            await axios.get(`${STREMIO_STREAMING_SERVER}/stats.json`);
            return Promise.resolve(true);
        } catch(e) {
            return Promise.resolve(false);
        }
    },

    async getMetaSeries(imdbId) {
        const { data } = await axios.get(`${CINEMETA_URL}/meta/series/${imdbId}.json`);
        return data.meta;
    },

    async getMetaMovie(imdbId) {
        const { data } = await axios.get(`${CINEMETA_URL}/meta/movie/${imdbId}.json`);
        return data.meta;
    },

    async searchMovies(title) {
        const { data } = await axios.get(`${CINEMETA_URL}/catalog/movie/top/search=${title}.json`);
        return data.metas;
    },

    async searchSeries(title) {
        const { data } = await axios.get(`${CINEMETA_URL}/catalog/series/top/search=${title}.json`);
        return data.metas;
    },

    async getAddons() {
        const { data } = await axios.get(`${STREMIO_API_URL}/addonscollection.json`);
        return data;
    },

    async createTorrentStream(stream) {
        let { infoHash, fileIdx = null } = stream;
        const { data } = await axios.get(`${STREMIO_STREAMING_SERVER}/${infoHash}/create`);
        const { files } = data;
        if (!fileIdx) fileIdx = files.indexOf(files.sort((a, b) => a.length - b.length).reverse()[0]);
        return `${STREMIO_STREAMING_SERVER}/${infoHash}/${fileIdx}`;
    },

    async getStats(streamUrl) {
        const { data } = await axios.get(`${streamUrl}/stats.json`);
        console.log(data);
        
        return data;
    },

    async getSubtitles({ type, id, url }) {
        try {
            const { hash } = await getOpenSubInfo(url);
            return queryOpenSubtitles({
                type,
                id,
                videoHash: hash,
            });
        } catch(_) {
            return [];
        }
    }

};

async function getOpenSubInfo(streamUrl) {
    const rawUrl = encodeURIComponent(toRawStremioUrl(streamUrl));
    const { data } = await axios.get(`${STREMIO_STREAMING_SERVER}/opensubHash?videoUrl=${rawUrl}`);
    const { result } = data;
    return result;
}

async function queryOpenSubtitles({ type, id, videoHash }) {
    const { data } = await axios.get(`${OPENSUBTITLES_URL}/subtitles/${type}/${id}/videoHash=${videoHash}.json`);
    const { subtitles } = data;
    return subtitles;
}

export default StremioService;