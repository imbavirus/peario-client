<template>
    <div class="quick-switch">
        <div class="control" v-if="quickSwitch.isSeries" @click="toggle('episode')" :class="{ active: activePanel === 'episode', disabled: quickSwitch.disabled }">
            <ion-icon name="albums-outline"></ion-icon>
        </div>
        <div class="control" @click="toggle('source')" :class="{ active: activePanel === 'source', disabled: quickSwitch.disabled }">
            <ion-icon name="layers-outline"></ion-icon>
        </div>
        <div class="control" @click="toggle('quality')" :class="{ active: activePanel === 'quality', disabled: quickSwitch.disabled }">
            <ion-icon name="options-outline"></ion-icon>
        </div>

        <transition name="fade">
            <div class="panel" v-if="activePanel">
                <div class="header">
                    <div class="title">{{ panelTitle }}</div>
                    <div class="close" @click="close()">
                        <ion-icon name="close-outline"></ion-icon>
                    </div>
                </div>

                <div class="body">
                    <div v-if="activePanel === 'episode'">
                        <div class="season-bar" v-if="hasSeasonPaging">
                            <div class="btn" :class="{ disabled: !canPrevSeason }" @click="prevSeason()">‹</div>
                            <div class="label">Season {{ seasonLabel }}</div>
                            <div class="btn" :class="{ disabled: !canNextSeason }" @click="nextSeason()">›</div>
                        </div>

                        <ul class="episode-list">
                        <li v-if="!quickSwitch.episodes || !quickSwitch.episodes.length" class="empty">
                            No episode list available yet
                        </li>
                        <li
                            v-for="opt in visibleEpisodes"
                            :key="opt.value"
                            :class="{ selected: opt.value === quickSwitch.selectedEpisodeId }"
                            @click="selectEpisode(opt.value)"
                        >
                            {{ opt.name }}
                        </li>
                        </ul>
                    </div>

                    <ul v-else-if="activePanel === 'source'">
                        <li v-if="!quickSwitch.streams || !quickSwitch.streams.length" class="empty">
                            No sources available
                        </li>
                        <li
                            v-for="opt in quickSwitch.streams"
                            :key="opt.value"
                            :class="{ selected: opt.value === quickSwitch.selectedStreamKey }"
                            @click="selectStream(opt.value)"
                        >
                            {{ opt.name }}
                        </li>
                    </ul>

                    <ul v-else>
                        <li v-if="!quickSwitch.qualities || !quickSwitch.qualities.length" class="empty">
                            No quality options available
                        </li>
                        <li
                            v-for="opt in quickSwitch.qualities"
                            :key="opt.value"
                            :class="{ selected: opt.value === quickSwitch.selectedQuality }"
                            @click="selectQuality(opt.value)"
                        >
                            {{ opt.name }}
                        </li>
                    </ul>
                </div>
            </div>
        </transition>
    </div>
</template>

<script>
import store from '@/store';

export default {
    name: 'QuickSwitchControl',
    props: {
        quickSwitch: Object
    },
    emits: ['episode', 'stream', 'quality', 'open', 'close'],
    data() {
        return {
            activePanel: null,
            season: null,
        };
    },
    computed: {
        panelTitle() {
            if (this.activePanel === 'episode') return 'Episode';
            if (this.activePanel === 'source') return 'Source';
            return 'Quality';
        },
        hasSeasonPaging() {
            return Boolean(this.quickSwitch?.isSeries && Array.isArray(this.quickSwitch?.seasons) && this.quickSwitch.seasons.length);
        },
        seasonLabel() {
            if (!this.hasSeasonPaging) return '?';
            return this.season != null ? this.season : (this.quickSwitch?.seasons?.[0] ?? '?');
        },
        seasonIndex() {
            if (!this.hasSeasonPaging) return -1;
            const s = this.season != null ? this.season : this.quickSwitch.seasons[0];
            return this.quickSwitch.seasons.indexOf(s);
        },
        canPrevSeason() {
            return this.hasSeasonPaging && this.seasonIndex > 0;
        },
        canNextSeason() {
            return this.hasSeasonPaging && this.seasonIndex >= 0 && this.seasonIndex < this.quickSwitch.seasons.length - 1;
        },
        visibleEpisodes() {
            const eps = this.quickSwitch?.episodes || [];
            if (!this.hasSeasonPaging) return eps;
            const s = this.season != null ? this.season : this.quickSwitch.seasons[0];
            return eps.filter((opt) => this.parseSeasonFromEpisodeId(opt?.value) === s);
        },
    },
    watch: {
        // When the selected episode changes (or when data arrives), keep the picker on that season by default.
        'quickSwitch.selectedEpisodeId': {
            immediate: true,
            handler(id) {
                this.setSeasonFromEpisodeId(id);
            }
        },
        // When seasons list changes (e.g. meta loads), re-sync to selected episode season.
        'quickSwitch.seasons': {
            immediate: true,
            handler() {
                this.setSeasonFromEpisodeId(this.quickSwitch?.selectedEpisodeId);
            }
        }
    },
    methods: {
        parseSeasonFromEpisodeId(id) {
            if (!id || typeof id !== 'string') return null;
            const parts = id.split(':');
            if (parts.length < 3) return null;
            const season = Number(parts[1]);
            return Number.isFinite(season) ? season : null;
        },
        setSeasonFromEpisodeId(id) {
            if (!this.hasSeasonPaging) return;
            const s = this.parseSeasonFromEpisodeId(id);
            if (s == null) {
                if (this.season == null) this.season = this.quickSwitch?.seasons?.[0] ?? null;
                return;
            }
            // Only set if the season exists in the list.
            if (Array.isArray(this.quickSwitch?.seasons) && this.quickSwitch.seasons.includes(s)) {
                this.season = s;
            }
        },
        prevSeason() {
            if (!this.canPrevSeason) return;
            this.season = this.quickSwitch.seasons[this.seasonIndex - 1];
        },
        nextSeason() {
            if (!this.canNextSeason) return;
            this.season = this.quickSwitch.seasons[this.seasonIndex + 1];
        },
        toggle(which) {
            // eslint-disable-next-line no-console
            console.log('[QuickSwitch] toggle', { which, disabled: this.quickSwitch?.disabled, isSeries: this.quickSwitch?.isSeries, counts: { episodes: this.quickSwitch?.episodes?.length, streams: this.quickSwitch?.streams?.length, qualities: this.quickSwitch?.qualities?.length } });
            if (this.quickSwitch && this.quickSwitch.disabled) return;
            if (this.activePanel === which) return this.close();
            this.activePanel = which;
            if (which === 'episode') this.setSeasonFromEpisodeId(this.quickSwitch?.selectedEpisodeId);
            store.commit('player/updateHideState', false);
            store.commit('player/updatePreventHide', true);
            this.$emit('open');
        },
        close() {
            this.activePanel = null;
            store.commit('player/updatePreventHide', false);
            this.$emit('close');
        },
        selectEpisode(value) {
            // eslint-disable-next-line no-console
            console.log('[QuickSwitch] selectEpisode', { value });
            this.$emit('episode', value);
            this.close();
        },
        selectStream(value) {
            this.$emit('stream', value);
            this.close();
        },
        selectQuality(value) {
            this.$emit('quality', value);
            this.close();
        }
    },
    unmounted() {
        store.commit('player/updatePreventHide', false);
    }
};
</script>

<style lang="scss" scoped>
.quick-switch {
    position: relative;
    display: flex;
    gap: 0.2rem;

    .control {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.5em;
        font-size: 1.8em;
        cursor: pointer;
        opacity: 0.95;

        &.active {
            opacity: 1;
        }

        &.disabled {
            opacity: 0.3;
            pointer-events: none;
        }
    }

    .panel {
        z-index: 200;
        position: absolute;
        right: 0;
        bottom: calc(#{$player-controls-height} + 0.5rem);
        width: 320px;
        max-height: 320px;
        border-radius: 10px;
        overflow: hidden;
        background-color: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(10px);
        color: white;
        box-shadow: 0 0 30px rgba(0, 0, 0, 0.35);

        .header {
            height: 44px;
            padding: 0 10px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);

            .title {
                font-family: 'Montserrat-SemiBold';
                font-size: 14px;
                opacity: 0.95;
            }

            .close {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 36px;
                height: 36px;
                cursor: pointer;
            }
        }

        .body {
            overflow: auto;
            max-height: calc(320px - 44px);
        }

        .season-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 10px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);

            .label {
                font-family: 'Montserrat-SemiBold';
                font-size: 12px;
                opacity: 0.95;
            }

            .btn {
                width: 28px;
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 8px;
                background: rgba(255, 255, 255, 0.08);
                cursor: pointer;
                user-select: none;

                &.disabled {
                    opacity: 0.3;
                    pointer-events: none;
                }
            }
        }

        ul {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        li {
            padding: 10px 12px;
            font-family: 'Montserrat-Medium';
            font-size: 13px;
            cursor: pointer;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);

            &:hover {
                background: rgba(255, 255, 255, 0.07);
            }

            &.selected {
                background: rgba(255, 255, 255, 0.10);
            }
        }

        li.empty {
            cursor: default;
            opacity: 0.75;
            font-style: italic;
        }
    }
}

@media only screen and (max-width: 768px) {
    .quick-switch {
        .panel {
            width: 90vw;
            right: -10px;
        }
    }
}
</style>



