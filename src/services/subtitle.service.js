import axios from "axios";
import { parseSync } from 'subtitle';
import { HTTP_SERVER } from "@/common/config";

function toSubtitlesProxyUrl(url) {
    if (!url) return url;

    // In development, subtitle downloads from subs5.strem.io are blocked by CORS.
    // Route them through the Vue devServer proxy (/subs -> https://subs5.strem.io).
    if (process.env.NODE_ENV === 'development') {
        try {
            const u = new URL(url, window.location.origin);
            if (u.hostname === 'subs5.strem.io') {
                return `/subs${u.pathname}${u.search}`;
            }
        } catch (_) {
            // ignore
        }
    }

    return url;
}

const SubtitleService = {
    
    subtitles: null,

    getCurrent(seconds) {
        if (this.subtitles) {
            const ms = seconds * 1000;
            const line = this.subtitles.find(({ data }) => ms >= data.start && ms <= data.end);
            return line ? line.data.text : '';
        }
        return null;
    },

    async set(url) {
        this.subtitles = null;
        try {
            const proxiedUrl = toSubtitlesProxyUrl(url);
            const { data } = await axios.get(proxiedUrl, { responseType: 'text' });
            if (!data || (typeof data === 'string' && data.trim().length === 0)) {
                return Promise.reject(new Error('Empty subtitles response'));
            }

            this.subtitles = parseSync(data);
            return Promise.resolve();
        } catch(err) {
            // Fall back to server-side proxy to avoid CORS and flaky subtitle hosts.
            try {
                const proxyBase = process.env.NODE_ENV === 'development' ? '/peario' : HTTP_SERVER;
                const proxyUrl = `${proxyBase}/proxy/subtitle?url=${encodeURIComponent(url)}`;
                const { data } = await axios.get(proxyUrl, { responseType: 'text' });
                if (!data || (typeof data === 'string' && data.trim().length === 0)) {
                    return Promise.reject(new Error('Empty subtitles response (proxy)'));
                }
                this.subtitles = parseSync(data);
                return Promise.resolve();
            } catch (proxyErr) {
                // eslint-disable-next-line no-console
                console.warn('Subtitle proxy failed', { url, err, proxyErr });
                return Promise.reject(proxyErr || err);
            }
        }
    },

    setCustom(data) {
        this.subtitles = parseSync(data);
    }

};

export default SubtitleService;