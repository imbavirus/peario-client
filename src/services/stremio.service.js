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

    _torrentFilesCache: new Map(),

    async resolveTorrentFileMatch(infoHash, contentId = null, preferredFileIdx = null, episodeTitle = null) {
        // If caller already provided a fileIdx, trust it (and avoid /create).
        if (preferredFileIdx != null && Number.isFinite(Number(preferredFileIdx))) {
            return { fileIdx: Number(preferredFileIdx), score: 1000 };
        }

        const files = await this.getTorrentFiles(infoHash);

        const videoExt = (name) => /\.(mkv|mp4|avi|mov|m4v|webm)$/i.test(name || '');
        const getName = (f) => {
            if (typeof f === 'string') return f;
            return f?.path || f?.name || f?.filename || '';
        };

        const parseSeasonEpisode = (id) => {
            if (!id || typeof id !== 'string') return null;
            const parts = id.split(':');
            if (parts.length < 3) return null;
            const season = Number(parts[1]);
            const episode = Number(parts[2]);
            if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
            return { season, episode };
        };

        const se = parseSeasonEpisode(contentId);
        const patterns = [];
        if (se) {
            const s = String(se.season).padStart(2, '0');
            const e = String(se.episode).padStart(2, '0');
            patterns.push(
                new RegExp(`\\bS0*${se.season}E0*${se.episode}\\b`, 'i'),
                new RegExp(`\\bS${s}E${e}\\b`, 'i'),
                new RegExp(`\\b${se.season}x0*${se.episode}\\b`, 'i'),
                new RegExp(`\\b${s}x${e}\\b`, 'i'),
                new RegExp(`season\\s*0*${se.season}.*episode\\s*0*${se.episode}`, 'i'),
            );
        }

        const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const titleTokens = (episodeTitle || '')
            .toLowerCase()
            .split(/[^a-z0-9]+/g)
            .filter(Boolean)
            .filter(t => t.length >= 4)
            .slice(0, 6);
        const tokenRes = titleTokens.map(t => new RegExp(`\\b${escape(t)}\\b`, 'i'));

        let bestIdx = -1;
        let bestScore = -1;

        if (Array.isArray(files)) {
            files.forEach((f, idx) => {
                const name = getName(f);
                if (!videoExt(name)) return;

                const patternHits = patterns.reduce((acc, re) => acc + (re.test(name) ? 1 : 0), 0);
                const tokenHits = tokenRes.reduce((acc, re) => acc + (re.test(name) ? 1 : 0), 0);
                const score = (patternHits * 10) + tokenHits;

                if (score > bestScore) {
                    bestScore = score;
                    bestIdx = idx;
                }
            });
        }

        if (bestIdx >= 0 && bestScore > 0) {
            return { fileIdx: bestIdx, score: bestScore };
        }

        // Fallback: largest video file (score 0 = not confident)
        if (Array.isArray(files) && files.length) {
            const ranked = files
                .map((f, idx) => ({ idx, name: getName(f), size: typeof f === 'object' ? (f?.length ?? 0) : 0 }))
                .filter(x => videoExt(x.name) || x.size > 0);

            if (ranked.length) {
                ranked.sort((a, b) => (b.size || 0) - (a.size || 0));
                return { fileIdx: ranked[0].idx, score: 0 };
            }
        }

        return { fileIdx: 0, score: 0 };
    },

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

    async resolveTorrentFileIdx(infoHash, contentId = null, preferredFileIdx = null) {
        // If caller already provided a fileIdx, trust it (and avoid /create).
        if (preferredFileIdx != null && Number.isFinite(Number(preferredFileIdx))) {
            return Number(preferredFileIdx);
        }

        const match = await this.resolveTorrentFileMatch(infoHash, contentId, null, null);
        return match.fileIdx;
    },

    async createTorrentStream(stream, contentId = null) {
        const { infoHash } = stream;
        // Fast path: if fileIdx is present, don't hit /create at all.
        if (stream?.fileIdx != null && Number.isFinite(Number(stream.fileIdx))) {
            return `${STREMIO_STREAMING_SERVER}/${infoHash}/${Number(stream.fileIdx)}`;
        }

        const fileIdx = await this.resolveTorrentFileIdx(infoHash, contentId, null);
        return `${STREMIO_STREAMING_SERVER}/${infoHash}/${fileIdx}`;
    },

    async getTorrentFiles(infoHash) {
        const cached = this._torrentFilesCache.get(infoHash);
        if (cached) return cached;
        const { data } = await axios.get(`${STREMIO_STREAMING_SERVER}/${infoHash}/create`);
        const files = data && data.files ? data.files : [];
        this._torrentFilesCache.set(infoHash, files);
        return files;
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