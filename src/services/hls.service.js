import Hls from 'hls.js';
import hat from 'hat';
import { STREMIO_STREAMING_SERVER, STREMIO_STREAMING_SERVER_RAW } from '@/common/config';

const HlsService = {

    hls: null,

    init() {
        // Re-init safely (helps with hot reload / remounts).
        if (this.hls) {
            try {
                this.hls.destroy();
            } catch (e) {
                // Ignore destroy errors; we just want a clean re-init in dev/hot-reload scenarios.
                console.warn('Failed to destroy previous HLS instance', e);
            }
        }

        this.hls = new Hls({
            startLevel: 0,
            abrMaxWithRealBitrate: true
        });
    },

    async createPlaylist(mediaURL) {
        const id = hat();

        // If we're using the dev proxy, Stremio still needs a URL it can fetch itself (raw localhost:11470).
        const rawMediaURL = (mediaURL && mediaURL.startsWith('/stremio'))
            ? `${STREMIO_STREAMING_SERVER_RAW}${mediaURL.replace('/stremio', '')}`
            : mediaURL;

        const queryParams = new URLSearchParams([
            ['mediaURL', rawMediaURL],
            ['videoCodecs', 'h264'],
            ['videoCodecs', 'vp9'],
            ['audioCodecs', 'aac'],
            ['audioCodecs', 'mp3'],
            ['audioCodecs', 'opus'],
            ['maxAudioChannels', 2],
        ]);

        return `${STREMIO_STREAMING_SERVER}/hlsv2/${id}/master.m3u8?${queryParams.toString()}`;
    },

    loadHls(playlistUrl, videoElement) {
        return new Promise((resolve, reject) => {
            if (!Hls.isSupported()) {
                return reject(new Error('HLS not supported in this browser'));
            }

            try {
                if (!this.hls) this.init();

                const onManifestParsed = () => {
                    cleanup();
                    resolve();
                };

                const onError = (_, data) => {
                    // Reject on fatal errors so callers can show UI instead of buffering forever.
                    if (data && data.fatal) {
                        cleanup();
                        // Best-effort detach to allow falling back to raw src.
                        try {
                            this.hls.detachMedia();
                        } catch (_) {
                            // ignore
                        }
                        reject(new Error(data.details || data.type || 'HLS fatal error'));
                    }
                };

                const cleanup = () => {
                    this.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
                    this.hls.off(Hls.Events.ERROR, onError);
                };

                this.hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
                this.hls.on(Hls.Events.ERROR, onError);
                this.hls.loadSource(playlistUrl);
                this.hls.attachMedia(videoElement);
            } catch (e) {
                reject(e);
            }
        });
    },

    clear() {
        if (!this.hls) return;
        try {
            this.hls.detachMedia();
        } catch (_) {
            // ignore
        }
        try {
            this.hls.destroy();
        } catch (_) {
            // ignore
        }
        this.hls = null;
    }

};

export default HlsService; 