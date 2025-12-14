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
        }
    },
    methods: {
        async onVideoError() {
            // If raw stream fails and we have an HLS playlist, attempt a one-time fallback.
            if (this.options && this.options.hls && !this.isHls && !this.hasTriedFallback) {
                this.hasTriedFallback = true;
                await this.toggleHls();
                return;
            }

            this.$toast.error('Stream failed to load');
        },
        async toggleHls() {
            const currentTime = this.video.currentTime;
            const wasPlaying = !this.video.paused;

            try {
                if (!this.isHls) await HlsService.loadHls(this.options.hls, this.video);
                else store.commit('player/updateVideoSrc', this.options.src);
            } catch (e) {
                // If HLS attach fails, don't leave the player stuck in a "half toggled" state.
                console.error('Failed to toggle HLS', e);
                this.$toast.error(`Failed to load stream: ${e && e.message ? e.message : 'unknown error'}`);
                return;
            }
            
            this.isHls = !this.isHls;
            store.commit('player/updateVideoCurrentTime', currentTime);

            if (wasPlaying) this.video.play();
            this.isHls ? this.$toast.success(this.$t('toasts.hlsStream')) : this.$toast.success(this.$t('toasts.sourceStream'));
        }
    },
    mounted() {
        HlsService.init();
        this.video.addEventListener('error', this.onVideoError);

        // For torrent streams we usually generate an HLS playlist. The raw file endpoint can "buffer forever"
        // without throwing, so prefer HLS by default when available.
        if (this.options && this.options.hls) {
            this.hasTriedFallback = true;
            this.toggleHls();
        }
    },
    unmounted() {
        HlsService.clear();
        this.video.removeEventListener('error', this.onVideoError);
    }
}
</script>