<template>
    <div class="hls" @click="toggleHls()">
        <ion-icon name="color-wand-outline" v-show="!isHls"></ion-icon>
        <ion-icon name="color-wand" v-show="isHls"></ion-icon>
    </div>
</template>

<script>
import { mapGetters } from 'vuex';
import HlsService from "@/services/hls.service";
import store from '../../../store';

export default {
    name: 'HlsControl',
    emits: ['loaded', 'unloaded'],
    props: {
        options: Object
    },
    computed: mapGetters({
        video: 'player/video'
    }),
    data() {
        return {
            isHls: false,
            hasTriedFallback: false,
            autoTriedHls: false,
        }
    },
    watch: {
        // When the room switches to a new stream (autoplay-next), reinit HLS state.
        options: {
            deep: true,
            handler() {
                this.isHls = false;
                this.hasTriedFallback = false;
                this.autoTriedHls = false;
                HlsService.clear();
                HlsService.init();

                // Prefer HLS by default when available (torrent streams).
                this.autoStartHls();
            }
        }
    },
    methods: {
        isPlaybackDesired() {
            // Desired playback state should come from the app (store), not the media element.
            // Right after swapping src / attaching HLS, the element is typically paused even if we intend to keep playing.
            try {
                return !store.state.player.paused;
            } catch (_) {
                return false;
            }
        },
        async autoStartHls() {
            if (!this.options || !this.options.hls) return;
            if (this.isHls) return;
            if (this.autoTriedHls) return;

            this.autoTriedHls = true;
            await this.toggleHls();
        },
        async onVideoError() {
            // If HLS stream fails, fall back to raw source once.
            if (this.options && this.options.hls && this.isHls && !this.hasTriedFallback) {
                this.hasTriedFallback = true;
                await this.toggleHls();
                return;
            }

            this.$toast.error('Stream failed to load');
        },
        async toggleHls() {
            const currentTime = this.video.currentTime;
            const shouldPlayAfter = this.isPlaybackDesired() || !this.video.paused;

            try {
                if (!this.isHls) {
                    await HlsService.loadHls(this.options.hls, this.video);
                    this.$emit('loaded', { playlistUrl: this.options.hls, src: this.options.src });
                } else {
                    store.commit('player/updateVideoSrc', this.options.src);
                    this.$emit('unloaded', { src: this.options.src });
                }
            } catch (e) {
                // If HLS attach fails, don't leave the player stuck in a "half toggled" state.
                console.error('Failed to toggle HLS', e);
                try {
                    HlsService.clear();
                    HlsService.init();
                } catch (_) {
                    // ignore
                }
                // Ensure we're on the raw source after a failed HLS attempt.
                if (this.options && this.options.src) {
                    store.commit('player/updateVideoSrc', this.options.src);
                }
                this.$toast.error(`Failed to load stream: ${e && e.message ? e.message : 'unknown error'}`);
                return;
            }
            
            this.isHls = !this.isHls;
            store.commit('player/updateVideoCurrentTime', currentTime);

            if (shouldPlayAfter) {
                const p = this.video.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
            this.isHls ? this.$toast.success(this.$t('toasts.hlsStream')) : this.$toast.success(this.$t('toasts.sourceStream'));
        }
    },
    mounted() {
        HlsService.init();
        this.video.addEventListener('error', this.onVideoError);

        // Prefer HLS by default when available (torrent streams). If it fails, we fall back to raw.
        this.autoStartHls();
    },
    unmounted() {
        HlsService.clear();
        this.video.removeEventListener('error', this.onVideoError);
    }
}
</script>