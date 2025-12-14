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
    emits: ['change'],
    props: {
        options: Object
    },
    computed: mapGetters({
        video: 'player/video',
        paused: 'player/paused',
        autoSync: 'player/autoSync'
    }),
    methods: {
        async togglePlay() {
            if ((!this.options.isOwner && !this.autoSync) || this.options.isOwner) {
                try {
                    if (this.paused) {
                        await this.video.play();
                        store.commit('player/updatePaused', false);
                    } else {
                        this.video.pause();
                        store.commit('player/updatePaused', true);
                    }
                    this.$emit('change', this.paused);
                } catch (e) {
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