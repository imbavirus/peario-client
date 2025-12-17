<template>
    <div class="play-pause" @click="togglePlay()" :class="{ 'disabled': autoSync && !options.isOwner }">
        <ion-icon name="play-outline" v-if="paused"></ion-icon>
        <ion-icon name="pause-outline" v-else></ion-icon>
    </div>
</template>

<script>
import { mapGetters } from 'vuex';
import store from '@/store';

export default {
    name: 'PlayPauseControl',
    emits: ['change', 'requestSource'],
    props: {
        options: Object
    },
    computed: mapGetters({
        video: 'player/video',
        paused: 'player/paused',
        autoSync: 'player/autoSync'
    }),
    methods: {
        logVideoDebug(label, err = null) {
            try {
                const v = this.video;
                const mediaErr = v && v.error ? v.error : null;
                // eslint-disable-next-line no-console
                console.groupCollapsed(`[Player] ${label}`);
                // eslint-disable-next-line no-console
                console.log({
                    isOwner: this.options?.isOwner,
                    autoSync: this.autoSync,
                    pausedState: this.paused,
                    videoPaused: v?.paused,
                    optionsSrc: this.options?.src || null,
                    optionsHls: this.options?.hls || null,
                    contentId: this.options?.contentId || null,
                    src: v?.src,
                    currentSrc: v?.currentSrc,
                    readyState: v?.readyState,
                    networkState: v?.networkState,
                    error: mediaErr
                        ? {
                            code: mediaErr.code,
                            message: mediaErr.message,
                        }
                        : null,
                    exception: err
                        ? {
                            name: err.name,
                            message: err.message,
                            code: err.code,
                        }
                        : null
                });
                // eslint-disable-next-line no-console
                console.groupEnd();
            } catch (_) {
                // ignore
            }
        },
        async togglePlay() {
            const canControl = ((!this.options?.isOwner && !this.autoSync) || this.options?.isOwner);
            if (!canControl) {
                this.logVideoDebug('Play blocked (not owner while autosync enabled)');
                return;
            }

            this.logVideoDebug('Play/Pause clicked (before)');
            // If the room/player hasn't set a source yet (can happen after HMR/reconnect),
            // ask the room owner to auto-pick a source for the current episode.
            if (!this.options?.src) {
                if (this.options?.isOwner) {
                    this.logVideoDebug('No source set; auto-selecting best source (owner)');
                    this.$emit('requestSource');
                } else {
                    this.logVideoDebug('No source set; cannot auto-select (not owner)');
                }
                return;
            }
            if (canControl) {
                try {
                    if (this.paused) {
                        const p = this.video.play();
                        if (p && typeof p.then === 'function') {
                            p.then(() => this.logVideoDebug('video.play() resolved'))
                                .catch((e) => {
                                    this.logVideoDebug('video.play() rejected', e);
                                    // Also log the raw exception so it's visible without expanding groups.
                                    // eslint-disable-next-line no-console
                                    console.error('[Player] video.play() rejected (raw)', e);
                                });
                        }
                        await p;
                        store.commit('player/updatePaused', false);
                    } else {
                        this.video.pause();
                        store.commit('player/updatePaused', true);
                    }
                    this.$emit('change', this.paused);
                } catch (e) {
                    // AbortError is common when the source is being swapped (autoplay-next / HLS toggle).
                    if (e && (e.name === 'AbortError' || String(e.message || '').includes('interrupted by a new load request'))) {
                        this.logVideoDebug('video.play() abort (source changed)', e);
                        return;
                    }
                    // NotSupportedError usually means the selected stream URL is invalid (404/HTML) or codec isn't supported.
                    // If we're the owner, try to auto-pick another source instead of leaving the player stuck.
                    if (e && e.name === 'NotSupportedError') {
                        this.logVideoDebug('video.play() not supported (bad source?)', e);
                        if (this.options?.isOwner) {
                            this.$emit('requestSource');
                            this.$toast?.error?.('Stream not supported — trying another source');
                            return;
                        }
                    }
                    this.logVideoDebug('Failed to play', e);
                    console.error('Failed to play', e);
                    this.$toast?.error?.('Playback failed to start (check stream / browser console)');
                }
            }
        },
        onKeyUp({ code }) {
            if (code === 'Space') this.togglePlay();
        }
    },
    mounted() {
        document.body.onkeyup = this.onKeyUp;
    },
    unmounted() {
        document.body.removeEventListener('keyup', this.onKeyUp);
    }
}
</script>

<style lang="scss" scoped>
.play-pause {
    display: flex;
    font-size: 3em !important;
    padding: 0 0.25em 0 0.3em !important;

    &.disabled {
        user-select: none;
        opacity: 0.3;
    }
}
</style>