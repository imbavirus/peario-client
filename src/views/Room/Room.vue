<template>
    <div :class="['room', { 'chat-open': isChatOpen }]">
        <Loading type="room" v-if="!playerOptions"></Loading>
        <Error v-else-if="joinTimedOut" type="room" />

        <UsersList
            :show="!playerState.controlsHidden"
            :roomOwner="roomOwner"
            :isUserOwner="isUserOwner"
            :users="usersList"
            :isPlayerPaused="playerState.paused"
            @onUpdateOwnership="onUpdateOwnership"
        />

        <div class="titlebar" :class="{ hidden: hideTitlebar }" v-if="titlebar && (titlebar.name || titlebar.episode)">
            <div class="name">{{ titlebar.name }}</div>
            <div class="episode" v-if="titlebar.episode">{{ titlebar.episode }}</div>
        </div>

        <div class="controls">
            <Button clear icon="close" v-if="isChatOpen" @click="isChatOpen = false"></Button>
            <Button clear icon="chatbubbles-outline" v-else @click="isChatOpen = true">Open Chat</Button>
        </div>

        <Player
            v-if="playerOptions"
            :options="playerOptions"
            :quickSwitch="quickSwitch"
            @change="syncPlayer()"
            @ended="onEnded"
            @prev="onPrev"
            @next="onNext"
            @quickSwitchEpisode="onQuickSwitchEpisode"
            @quickSwitchStream="onQuickSwitchStream"
            @quickSwitchQuality="onQuickSwitchQuality"
            @mediaLoaded="onMediaLoaded"
            @hlsLoaded="onHlsLoaded"
            @requestSource="onRequestSource"
        ></Player>

        <transition name="fade">
            <Chat v-if="isChatOpen"></Chat>
        </transition>
    </div>
</template>

<script setup>
import { computed, getCurrentInstance, onMounted, onUnmounted, ref, watch } from 'vue';
import router from '@/router';
import store from '@/store';

import Loading from "@/components/Loading.vue";
import Error from "@/components/Error.vue";
import Button from "@/components/ui/Button.vue";
import Player from "@/components/player/Player.vue";
import Chat from "@/components/Chat.vue";
import UsersList from './UsersList/UsersList.vue';
import StremioService from "@/services/stremio.service";
import HlsService from "@/services/hls.service";
import ClientService from "@/services/client.service";
import AddonService from "@/services/addon.service";
import { compareTorrentByQualityThenSeedersDesc, getQualityRank, getSeederCount } from "@/services/streamRank.service";
import { onBeforeRouteLeave } from 'vue-router';

const initialized = ref(false); 
const playerOptions = ref(null); 
const isChatOpen = ref(false); 
const joinTimedOut = ref(false);

const toast = getCurrentInstance()?.appContext?.config?.globalProperties?.$toast;

const clientState = computed(() => store.state.client);
const clientRoomState = computed(() => store.state.client.room);
const playerState = computed(() => store.state.player);
const collectionState = computed(() => store.state.addons.collection);
const installedAddonsState = computed(() => store.state.addons.installed);

const roomOwner = computed(() => clientRoomState.value && clientRoomState.value.owner ? clientRoomState.value.owner : null);
const usersList = computed(() => clientRoomState.value && clientRoomState.value.users ? clientRoomState.value.users : []);
const isUserOwner = computed(() => {
    const myId = clientState.value && clientState.value.user && clientState.value.user.id ? clientState.value.user.id : null;
    return Boolean(myId && roomOwner.value && roomOwner.value === myId);
});
const isSeries = computed(() => playerOptions.value && playerOptions.value.meta && playerOptions.value.meta.type === 'series');

const installedStreamAddons = computed(() => {
    const col = collectionState.value;
    if (!col || !col.streams) return [];
    return col.streams.filter(addon => installedAddonsState.value && installedAddonsState.value.includes(addon.transportUrl));
});

const currentStreamKey = ref(null);

const availableStreams = ref([]);
const availableStreamsLoading = ref(false);
const seriesMeta = ref(null);
const actualPlayback = ref({ src: null, infoHash: null, fileIdx: null, season: null, episode: null });

const DEBUG_EPISODES = () => {
    if (process.env.NODE_ENV === 'development') return true;
    try {
        return localStorage.getItem('peario_debug_episode') === '1';
    } catch (_) {
        return false;
    }
};
function episodeDebug(label, data = null) {
    if (!DEBUG_EPISODES()) return;
    // eslint-disable-next-line no-console
    console.groupCollapsed(`[EpisodeDebug] ${label}`);
    // eslint-disable-next-line no-console
    if (data != null) console.log(data);
    // eslint-disable-next-line no-console
    console.groupEnd();
}

const selectedEpisodeId = ref('');
const selectedStreamKey = ref('AUTO');
const selectedQuality = ref('AUTO');
const selectorsReady = ref(false);
// The "target" contentId that selector changes should apply to.
// This prevents races where changing one selector (e.g. episode) triggers other watchers
// that accidentally apply to the *old* room contentId.
const desiredContentId = ref('');
// Flag to prevent watcher from running when QuickSwitch handles the change directly.
const isQuickSwitchChange = ref(false);

function streamKey(stream) {
    const addon = stream?.addon?.transportUrl || 'na';
    if (stream && stream.infoHash != null) return `t:${addon}:${stream.infoHash}:${stream.fileIdx ?? ''}`;
    if (stream && stream.url) return `u:${addon}:${stream.url}`;
    return `x:${addon}:${stream?.title ?? ''}`;
}

function isPlaceholderErrorStream(stream) {
    const url = String(stream?.url || '');
    const title = `${stream?.title ?? ''} ${stream?.name ?? ''}`.toLowerCase();
    const addonName = stream?.addon?.manifest?.name?.toLowerCase() || '';
    // Also check the stored flag in case addon object isn't fully populated
    const isOrion = addonName.includes('orion') || stream?._isOrionAddon === true;
    if (!url) return false;
    
    // IMPORTANT: Check if this is from Orion BEFORE filtering out error-general.mp4
    // Orion uses error-general.mp4 URLs but includes useful error messages in the title
    // that users need to see (like daily cap limits)
    if (isOrion && (title.includes('error') || title.includes('daily') || title.includes('cap') || 
                    title.includes('quota') || title.includes('limit') || title.includes('exceeded') ||
                    title.includes('stream limit') || title.includes('request limit'))) {
        return false; // Don't filter out - user should see the error message
    }
    
    // Always filter out generic error-general.mp4 placeholders (unless from Orion with useful info)
    if (url.includes('error-general.mp4')) return true;
    
    // Check if this is an error stream that contains useful information (like daily cap/quota)
    // These should NOT be filtered out so users can see the error message
    const hasUsefulErrorInfo = 
        title.includes('daily') || title.includes('cap') || title.includes('quota') || 
        title.includes('limit') || title.includes('exceeded') || title.includes('reached') ||
        url.includes('daily') || url.includes('cap') || url.includes('quota') || 
        url.includes('limit') || url.includes('exceeded') || url.includes('reached');
    
    // Generic "error-*.mp4" placeholders (Orion and others)
    // BUT: don't filter out error streams that contain useful info about daily cap/quota
    // OR if they're from Orion (which may use different error message formats)
    if (/\/videos\/error-[^/?#]+\.mp4/i.test(url)) {
        // Allow through error streams that indicate daily cap/quota/limit issues
        // OR if they're from Orion (to ensure daily cap messages are visible)
        if (hasUsefulErrorInfo || isOrion) return false;
        return true;
    }
    
    // GitHub blob links are often used for placeholders; treat them as non-streams here.
    // BUT: allow through if it's from Orion with useful error messages (like daily cap)
    if (/github\.com\/.+\/blob\//i.test(url)) {
        // If it's from Orion and has error-related keywords, allow it through
        if (isOrion && (title.includes('error') || title.includes('daily') || title.includes('limit') || 
                        title.includes('cap') || title.includes('quota'))) {
            return false; // Don't filter out - user should see the error message
        }
        return true;
    }
    if (title.includes('error') && url.includes('github.com') && url.includes('/blob/')) {
        // If it's from Orion and has error-related keywords, allow it through
        if (isOrion && (title.includes('error') || title.includes('daily') || title.includes('limit') || 
                        title.includes('cap') || title.includes('quota'))) {
            return false; // Don't filter out - user should see the error message
        }
        return true;
    }
    
    return false;
}

function streamLabel(stream) {
    const q = getQualityRank(stream);
    const seeds = getSeederCount(stream);
    const addonName = stream?.addon?.manifest?.name || stream?.name || '';
    const qLabel =
        q === 2160 ? '4K/2160p' :
        q === 1440 ? '1440p' :
        q === 1080 ? '1080p' :
        q === 720 ? '720p' :
        q === 480 ? '480p' :
        q === 360 ? '360p' :
        'Unknown';

    const type = stream && stream.infoHash != null ? 'Torrent' : (stream?.type || 'Source');
    const parts = [
        `${qLabel}`,
        seeds ? `${seeds} seeders` : null,
        addonName || null,
        type
    ].filter(Boolean);
    return parts.join(' • ');
}

function getCurrentPreferredKind() {
    const s = clientState.value?.room?.stream;
    if (!s) return null;
    if (s.infoHash != null) return 'TORRENT';
    if (s.url) return s.url.split(':')[0].toUpperCase();
    return null;
}

function matchesPreferredKind(stream, preferredKind) {
    if (!preferredKind) return true;
    if (preferredKind === 'TORRENT') return stream && stream.infoHash != null;
    return stream && stream.infoHash == null && stream.url && stream.url.split(':')[0].toUpperCase() === preferredKind;
}

function pickBestStream(streams, preferredKind, quality) {
    let candidates = streams || [];

    const sameKind = candidates.filter(s => matchesPreferredKind(s, preferredKind));
    if (sameKind.length) candidates = sameKind;

    if (quality && quality !== 'AUTO') {
        const q = Number(quality);
        const byQ = candidates.filter(s => getQualityRank(s) === q);
        if (byQ.length) candidates = byQ;
    }

    if (!candidates.length) return null;

    const anyTorrent = candidates.some(s => s && s.infoHash != null);
    if (anyTorrent) {
        // Prefer streams that specify fileIdx (season packs often need fileIdx to play the correct episode;
        // otherwise StremioService falls back to "largest file" which can be the wrong episode).
        const withFileIdx = candidates.filter(s => s && s.infoHash != null && s.fileIdx != null);
        const pool = withFileIdx.length ? withFileIdx : candidates;
        return pool.reduce((best, s) => (compareTorrentByQualityThenSeedersDesc(s, best) > 0 ? s : best), pool[0]);
    }

    return candidates.reduce((best, s) => {
        const qa = getQualityRank(s);
        const qb = getQualityRank(best);
        if (qa !== qb) return qa > qb ? s : best;
        const sa = getSeederCount(s);
        const sb = getSeederCount(best);
        if (sa !== sb) return sa > sb ? s : best;
        return best;
    }, candidates[0]);
}

async function fetchStreamsForContentId(contentId) {
    const meta = clientState.value?.room?.meta;
    if (!meta || !contentId) return [];
    availableStreamsLoading.value = true;
    
    // Debug: log what we're querying addons for.
    episodeDebug('fetchStreamsForContentId() querying addons', {
        contentId,
        metaType: meta.type,
        addonCount: installedStreamAddons.value?.length ?? 0,
    });
    
    const streams = await AddonService.getStreams(installedStreamAddons.value, meta.type, contentId);
    
    // Debug: log what addons returned.
    episodeDebug('fetchStreamsForContentId() addons returned', {
        contentId,
        streamCount: streams?.length ?? 0,
        torrentCount: streams?.filter(s => s?.infoHash != null).length ?? 0,
        urlCount: streams?.filter(s => s?.url != null && s?.infoHash == null).length ?? 0,
    });
    
    // Filter out known placeholder/error streams so they can never be auto-selected.
    availableStreams.value = (streams || []).filter(s => !isPlaceholderErrorStream(s));
    availableStreamsLoading.value = false;
    return availableStreams.value;
}

async function applySelectionForContentId(contentId) {
    if (!isUserOwner.value) return;
    if (!contentId) return;
    if (!installedStreamAddons.value || installedStreamAddons.value.length === 0) {
        // eslint-disable-next-line no-console
        console.warn('[Room] applySelectionForContentId: no installed stream addons available yet', { contentId });
        toast?.error?.('No stream addons loaded (can’t switch episode yet)');
        return;
    }

    const streams = await fetchStreamsForContentId(contentId);
    if (!streams.length) {
        // eslint-disable-next-line no-console
        console.warn('[Room] applySelectionForContentId: no streams returned for contentId', { contentId });
        // Fallback for series torrent packs:
        // If we're already watching a torrent (season pack), reuse the same infoHash and just resolve the proper fileIdx
        // for the requested episode. Some addons do not return per-episode streams for every episode.
        const current = clientState.value?.room?.stream;
        const currentInfoHash = current?.infoHash ?? null;
        if (currentInfoHash != null && isSeries.value) {
            try {
                const episodeName =
                    (Array.isArray(seriesMeta.value?.videos)
                        ? seriesMeta.value.videos.find(v => v?.id === contentId)?.name
                        : null) || null;
                const match = await StremioService.resolveTorrentFileMatch(currentInfoHash, contentId, null, episodeName);
                if (match && match.fileIdx != null && Number.isFinite(Number(match.fileIdx))) {
                    const chosen = { infoHash: currentInfoHash, fileIdx: Number(match.fileIdx) };
                    episodeDebug('applySelectionForContentId() fallback: reuse current torrent pack', {
                        contentId,
                        infoHash: currentInfoHash,
                        fileIdx: chosen.fileIdx,
                        score: match.score,
                        episodeName,
                    });
                    // eslint-disable-next-line no-console
                    console.log('[Room] room.setStream (fallback: reuse torrent pack)', {
                        contentId,
                        infoHash: chosen.infoHash,
                        fileIdx: chosen.fileIdx,
                    });
                    ClientService.send('room.setStream', { stream: chosen, contentId });
                    return;
                }
            } catch (e) {
                // eslint-disable-next-line no-console
                console.warn('[Room] applySelectionForContentId fallback failed', { contentId, infoHash: currentInfoHash, error: e });
            }
        }

        toast?.error?.('No streams found for this episode (with current addons)');
        return;
    }

    const preferredKind = getCurrentPreferredKind();

    let chosen = null;

    // Explicit stream selection wins.
    if (selectedStreamKey.value && selectedStreamKey.value !== 'AUTO') {
        chosen = streams.find(s => streamKey(s) === selectedStreamKey.value) || null;
    }

    if (!chosen) {
        chosen = pickBestStream(streams, preferredKind, selectedQuality.value);
        if (!chosen && selectedQuality.value !== 'AUTO') chosen = pickBestStream(streams, preferredKind, 'AUTO');
        if (!chosen) chosen = pickBestStream(streams, null, selectedQuality.value);
    }
    if (!chosen) return;

    // Make torrent selection deterministic by always sending an explicit fileIdx.
    // Also avoid torrents we can't map to the requested episode (otherwise you get "stuck" on the same file).
    if (chosen && chosen.infoHash != null && chosen.fileIdx == null && isSeries.value) {
        const episodeName = (Array.isArray(seriesMeta.value?.videos) ? seriesMeta.value.videos.find(v => v?.id === contentId)?.name : null) || null;
        const match = await StremioService.resolveTorrentFileMatch(chosen.infoHash, contentId, null, episodeName);
        if (match && match.score > 0) {
            chosen = { ...chosen, fileIdx: match.fileIdx };
        } else {
            // If we can't map this torrent to the episode, try other torrents.
            const torrents = (availableStreams.value || []).filter(s => s && s.infoHash != null);
            const ranked = torrents.slice().sort((a, b) => compareTorrentByQualityThenSeedersDesc(b, a)).slice(0, 10);
            let best = null;
            let bestScore = -1;
            for (const s of ranked) {
                const m = await StremioService.resolveTorrentFileMatch(s.infoHash, contentId, null, episodeName);
                if (m && m.score > bestScore) {
                    bestScore = m.score;
                    best = { stream: s, match: m };
                }
            }
            if (best && best.match && best.match.score > 0) {
                chosen = { ...best.stream, fileIdx: best.match.fileIdx };
            } else {
                const idx = await StremioService.resolveTorrentFileIdx(chosen.infoHash, contentId, null);
                chosen = { ...chosen, fileIdx: idx };
            }
        }
    } else if (chosen && chosen.infoHash != null && chosen.fileIdx == null) {
        const idx = await StremioService.resolveTorrentFileIdx(chosen.infoHash, contentId, null);
        chosen = { ...chosen, fileIdx: idx };
    }

    // Final guard: never send placeholder/error streams.
    if (isPlaceholderErrorStream(chosen)) {
        // eslint-disable-next-line no-console
        console.warn('[Room] applySelectionForContentId: chosen stream is placeholder/error, refusing to set', {
            contentId,
            url: chosen?.url ?? null,
            title: chosen?.title ?? null,
        });
        toast?.error?.('Stream addon returned an error placeholder (try a different addon/source)');
        return;
    }

    episodeDebug('applySelectionForContentId() chose stream', {
        contentId,
        addon: chosen?.addon?.manifest?.name || chosen?.addon?.manifest?.id || null,
        type: chosen?.infoHash != null ? 'TORRENT' : (chosen?.url ? 'URL' : 'UNKNOWN'),
        infoHash: chosen?.infoHash ?? null,
        fileIdx: chosen?.fileIdx ?? null,
        url: chosen?.url ?? null,
        title: chosen?.title ?? null,
    });
    // eslint-disable-next-line no-console
    console.log('[Room] room.setStream (applySelectionForContentId)', {
        contentId,
        addon: chosen?.addon?.manifest?.name || chosen?.addon?.manifest?.id || null,
        infoHash: chosen?.infoHash ?? null,
        fileIdx: chosen?.fileIdx ?? null,
        url: chosen?.url ?? null,
    });
    ClientService.send('room.setStream', { stream: chosen, contentId });
}

const streamSelectOptions = computed(() => {
    const streams = (availableStreams.value || [])
        // Hide anything without seeders/peers info (requested).
        .filter(s => getSeederCount(s) > 0);

    const sorted = streams.slice().sort((a, b) => {
        const at = a && a.infoHash != null;
        const bt = b && b.infoHash != null;

        // Prefer torrents first (matches typical main list expectation).
        if (at !== bt) return at ? -1 : 1;

        // For torrents: quality -> seeders (same as main page ranking).
        if (at && bt) return compareTorrentByQualityThenSeedersDesc(a, b);

        // For non-torrents: quality -> seeders as well.
        const qa = getQualityRank(a);
        const qb = getQualityRank(b);
        if (qa !== qb) return qb - qa;
        return getSeederCount(b) - getSeederCount(a);
    });

    return [
        { name: 'Auto (best)', value: 'AUTO' },
        ...sorted.map(s => ({ name: streamLabel(s), value: streamKey(s) }))
    ];
});

const qualitySelectOptions = computed(() => {
    const streams = availableStreams.value || [];
    const filtered = streams;

    const ranks = [...new Set(filtered.map(s => getQualityRank(s)))].sort((a, b) => b - a);
    const label = (r) => {
        if (r === 2160) return '4K / 2160p';
        if (r === 1440) return '1440p';
        if (r === 1080) return '1080p';
        if (r === 720) return '720p';
        if (r === 480) return '480p';
        if (r === 360) return '360p';
        return 'Unknown';
    };

    return [
        { name: 'Auto (best)', value: 'AUTO' },
        ...ranks.map(r => ({ name: label(r), value: String(r) }))
    ];
});

const episodeSelectOptions = computed(() => {
    const meta = seriesMeta.value;
    const videos = Array.isArray(meta?.videos) ? meta.videos.slice() : [];
    if (!videos.length) return [];

    const sorted = videos.sort((a, b) => {
        const sa = a.season === 0 ? Number.MAX_SAFE_INTEGER : a.season;
        const sb = b.season === 0 ? Number.MAX_SAFE_INTEGER : b.season;
        if (sa !== sb) return sa - sb;
        return (a.episode ?? 0) - (b.episode ?? 0);
    });

    return sorted.map(v => {
        const season = v.season;
        const episode = v.episode;
        const seasonStr = season == null ? '?' : String(season).padStart(2, '0');
        const episodeStr = episode == null ? '?' : String(episode).padStart(2, '0');
        const name = v.name || v.title || '';
        return {
            name: `${seasonStr !== '?' && episodeStr !== '?' ? `S${seasonStr}E${episodeStr}` : 'Episode'}${name ? ` — ${name}` : ''}`,
            value: v.id
        };
    });
});

const seasonSelectOptions = computed(() => {
    const meta = seriesMeta.value;
    const videos = Array.isArray(meta?.videos) ? meta.videos.slice() : [];
    if (!videos.length) return [];

    const seasons = [...new Set(videos.map(v => v?.season).filter(s => typeof s === 'number' && Number.isFinite(s)))];
    // Keep "specials" (season 0) last, otherwise ascending.
    return seasons.sort((a, b) => {
        const sa = a === 0 ? Number.MAX_SAFE_INTEGER : a;
        const sb = b === 0 ? Number.MAX_SAFE_INTEGER : b;
        return sa - sb;
    });
});

function parseSeasonEpisode(id) {
    if (!id || typeof id !== 'string') return { season: null, episode: null };
    const parts = id.split(':');
    if (parts.length < 3) return { season: null, episode: null };

    const season = Number(parts[1]);
    const episode = Number(parts[2]);
    if (!Number.isFinite(season) || !Number.isFinite(episode)) return { season: null, episode: null };

    return { season, episode };
}

const titlebar = computed(() => {
    const meta = playerOptions.value?.meta;
    const contentId = playerOptions.value?.contentId;
    if (!meta) return null;

    if (meta.type !== 'series') {
        return { name: meta.name || '', episode: null };
    }

    const selected = parseSeasonEpisode(contentId);
    const actual = (actualPlayback.value && actualPlayback.value.season != null && actualPlayback.value.episode != null)
        ? { season: actualPlayback.value.season, episode: actualPlayback.value.episode }
        : null;

    const shown = actual || selected;
    const seasonStr = shown && shown.season != null ? String(shown.season).padStart(2, '0') : null;
    const episodeStr = shown && shown.episode != null ? String(shown.episode).padStart(2, '0') : null;

    const mismatch = actual && selected && (actual.season !== selected.season || actual.episode !== selected.episode);

    return {
        name: meta.name || '',
        episode: seasonStr && episodeStr ? `S${seasonStr}E${episodeStr}${mismatch ? ' (mismatch)' : ''}` : null
    };
});

function parseTorrentFromSrc(src) {
    if (!src || typeof src !== 'string') return { infoHash: null, fileIdx: null };
    try {
        const u = new URL(src, window.location.origin);
        const parts = u.pathname.split('/').filter(Boolean);
        // Expect .../<infoHash>/<fileIdx>
        const fileIdxStr = parts[parts.length - 1];
        const infoHash = parts[parts.length - 2];
        const fileIdx = Number(fileIdxStr);
        if (infoHash && Number.isFinite(fileIdx)) return { infoHash, fileIdx };
    } catch (_) {
        // ignore
    }
    return { infoHash: null, fileIdx: null };
}

function parseSeasonEpisodeFromText(text) {
    if (!text) return null;
    const t = String(text);
    let m = t.match(/\bS(\d{1,2})E(\d{1,2})\b/i);
    if (m) return { season: Number(m[1]), episode: Number(m[2]) };
    m = t.match(/\b(\d{1,2})x(\d{1,2})\b/i);
    if (m) return { season: Number(m[1]), episode: Number(m[2]) };
    return null;
}

const onMediaLoaded = async ({ src }) => {
    actualPlayback.value = { src: src || null, infoHash: null, fileIdx: null, season: null, episode: null };

    const room = clientState.value?.room;
    if (!room || !room.stream || room.stream.infoHash == null) return;

    const parsed = parseTorrentFromSrc(src);
    if (!parsed.infoHash || parsed.fileIdx == null) return;

    try {
        const files = await StremioService.getTorrentFiles(parsed.infoHash);
        const f = Array.isArray(files) ? files[parsed.fileIdx] : null;
        const name = typeof f === 'string' ? f : (f?.path || f?.name || f?.filename || '');
        const se = parseSeasonEpisodeFromText(name);
        actualPlayback.value = {
            src: src || null,
            infoHash: parsed.infoHash,
            fileIdx: parsed.fileIdx,
            season: se ? se.season : null,
            episode: se ? se.episode : null,
        };
    } catch (_) {
        // ignore
    }
};

function parseMediaUrlFromPlaylist(playlistUrl) {
    if (!playlistUrl || typeof playlistUrl !== 'string') return null;
    try {
        const u = new URL(playlistUrl, window.location.origin);
        return u.searchParams.get('mediaURL');
    } catch (_) {
        return null;
    }
}

const onHlsLoaded = async ({ playlistUrl, src }) => {
    // HLS uses blob: currentSrc, so use playlistUrl's mediaURL as the authoritative "playing file".
    const mediaURL = parseMediaUrlFromPlaylist(playlistUrl);
    const effective = mediaURL || src || null;
    if (effective) await onMediaLoaded({ src: effective });
};

const hideTitlebar = computed(() => {
    // Match the player's control visibility: when controls fade, titlebar fades too.
    return Boolean(playerState.value && playerState.value.controlsHidden);
});

const syncRoom = async () => {
    if (!clientState.value || !clientState.value.room) return;
    const { stream, meta, player, contentId: roomContentId } = clientState.value.room;

    try {
        playerOptions.value = {
            ...(playerOptions.value || {}),
            meta,
            contentId: roomContentId,
            // Use the same ownership check as the UI (prevents HMR/identify desync issues).
            isOwner: isUserOwner.value,
        };
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[EpisodeDebug] syncRoom() failed while setting base playerOptions', e);
        return;
    }

    // Keep episode selector aligned with current room content.
    if (roomContentId && selectedEpisodeId.value !== roomContentId) {
        selectedEpisodeId.value = roomContentId;
    }
    if (roomContentId && desiredContentId.value !== roomContentId) {
        desiredContentId.value = roomContentId;
    }

    const streamKey = JSON.stringify({
        url: stream?.url ?? null,
        infoHash: stream?.infoHash ?? null,
        fileIdx: stream?.fileIdx ?? null,
        contentId: roomContentId ?? null
    });
    const streamChanged = currentStreamKey.value !== streamKey;

    const isTorrentStream = stream && stream.infoHash != null;
    const needsSourceSetup =
        !playerOptions.value?.src ||
        (isTorrentStream && !playerOptions.value?.hls);

    episodeDebug('syncRoom() inputs', {
        roomContentId,
        stream: {
            url: stream?.url ?? null,
            infoHash: stream?.infoHash ?? null,
            fileIdx: stream?.fileIdx ?? null,
        },
        streamChanged,
        needsSourceSetup,
        isUserOwner: isUserOwner.value,
    });

    if (!initialized.value || streamChanged || needsSourceSetup) {
        currentStreamKey.value = streamKey;
        initialized.value = false;

        try {
            const videoUrl = isTorrentStream ? await StremioService.createTorrentStream(stream, roomContentId) : stream.url;
            playerOptions.value = {
                ...(playerOptions.value || {}),
                src: videoUrl,
                hls: null,
            };

            if (DEBUG_EPISODES()) {
                // eslint-disable-next-line no-console
                console.log('[EpisodeDebug] syncRoom() set src', { src: playerOptions.value?.src ?? null });
            }

            if (isTorrentStream) {
                try {
                    const playlistUrl = await HlsService.createPlaylist(videoUrl);
                    playerOptions.value = {
                        ...(playerOptions.value || {}),
                        hls: playlistUrl,
                    };
                    if (DEBUG_EPISODES()) {
                        // eslint-disable-next-line no-console
                        console.log('[EpisodeDebug] syncRoom() set hls', { hls: playerOptions.value?.hls ?? null });
                    }
                } catch (e) {
                    // eslint-disable-next-line no-console
                    console.warn('[EpisodeDebug] syncRoom() failed creating HLS playlist, falling back to raw src', e);
                }
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[EpisodeDebug] syncRoom() failed building src/hls', {
                roomContentId,
                stream,
                error: e
            });
        }

        episodeDebug('syncRoom() built sources', {
            src: playerOptions.value?.src ?? null,
            hls: playerOptions.value?.hls ?? null,
        });

        initialized.value = true;
    }

    if (playerState.value.autoSync && playerState.value.video && !playerState.value.locked) {
        const { paused, buffering, time } = player;

        const unsync = time - playerState.value.video.currentTime;
        if (unsync > 1 || unsync < -1) {
            playerState.value.video.currentTime = time;
        }

        if (paused) {
            playerState.value.video.pause();
            store.commit('player/updatePaused', true);
        } else {
            // Treat the room state as the "desired" paused state; play() may not start
            // immediately while the new src is loading, but we still want UI/state to be "playing".
            store.commit('player/updatePaused', false);
            const p = playerState.value.video.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        }
        playerState.value.buffering = buffering;
    }
};

const syncPlayer = () => {
    if (playerState.value.autoSync) {
        const { currentTime } = playerState.value.video;
        ClientService.send('player.sync', {
            paused: playerState.value.paused,
            buffering: playerState.value.buffering,
            time: currentTime,
        });
    }
};

const onUpdateOwnership = (userId) => {
    ClientService.send('room.updateOwnership', { userId });
};

async function goToRelativeEpisode(delta) {
    const room = clientState.value?.room;
    if (!room || !room.meta || room.meta.type !== 'series') return;

    const contentId = room.contentId;
    if (!contentId || typeof contentId !== 'string') return;

    const [metaId] = contentId.split(':');
    if (!metaId) return;

    const fullMeta = await StremioService.getMetaSeries(metaId);
    const videos = Array.isArray(fullMeta?.videos) ? fullMeta.videos.slice() : [];
    if (!videos.length) return;

    const sorted = videos.sort((a, b) => {
        const sa = a.season === 0 ? Number.MAX_SAFE_INTEGER : a.season;
        const sb = b.season === 0 ? Number.MAX_SAFE_INTEGER : b.season;
        if (sa !== sb) return sa - sb;
        return (a.episode ?? 0) - (b.episode ?? 0);
    });

    const idx = sorted.findIndex(v => v?.id === contentId);
    if (idx < 0) return;

    const target = sorted[idx + delta];
    if (!target || !target.id) return;

    episodeDebug('goToRelativeEpisode() target', {
        delta,
        from: contentId,
        to: target.id,
        toName: target?.name ?? null,
    });

    // Use the unified selector (respects chosen quality, preferred kind, and filters placeholders).
    desiredContentId.value = target.id;
    selectedEpisodeId.value = target.id;
    selectedStreamKey.value = 'AUTO';
    await applySelectionForContentId(target.id);
}

async function goToEpisodeId(targetId) {
    const room = clientState.value?.room;
    if (!room || !room.meta) return;
    if (!targetId || typeof targetId !== 'string') return;
    if (!isUserOwner.value) return;

    episodeDebug('goToEpisodeId() start', {
        targetId,
        roomContentId: room?.contentId ?? null,
        currentRoomStream: {
            url: room?.stream?.url ?? null,
            infoHash: room?.stream?.infoHash ?? null,
            fileIdx: room?.stream?.fileIdx ?? null,
        }
    });

    // Use the unified selector (respects chosen quality, preferred kind, and filters placeholders).
    desiredContentId.value = targetId;
    selectedEpisodeId.value = targetId;
    selectedStreamKey.value = 'AUTO';
    await applySelectionForContentId(targetId);
}

const onEnded = async () => {
    // Only the owner advances the room to the next item
    if (!isUserOwner.value) return;
    await goToRelativeEpisode(1);
};

const onPrev = async () => {
    if (!isUserOwner.value) return;
    await goToRelativeEpisode(-1);
};

const onNext = async () => {
    if (!isUserOwner.value) return;
    await goToRelativeEpisode(1);
};

watch(clientRoomState, () => {
    syncRoom();
}, { immediate: true });

watch(
    () => clientState.value?.room?.contentId,
    async (id) => {
        const meta = clientState.value?.room?.meta;
        if (!meta || !id) return;
        desiredContentId.value = id;
        await fetchStreamsForContentId(id);
        selectorsReady.value = true;
    },
    { immediate: true }
);

watch(
    () => clientState.value?.room?.meta?.id,
    async (id) => {
        const meta = clientState.value?.room?.meta;
        if (!meta || meta.type !== 'series' || !id) {
            seriesMeta.value = null;
            return;
        }
        seriesMeta.value = await StremioService.getMetaSeries(id);
    },
    { immediate: true }
);

watch(selectedEpisodeId, async (id) => {
    if (!selectorsReady.value) return;
    const currentId = clientState.value?.room?.contentId;
    if (!id || !currentId || id === currentId) return;
    // Skip if this change came from QuickSwitch (it handles switching directly).
    if (isQuickSwitchChange.value) {
        isQuickSwitchChange.value = false;
        return;
    }
    episodeDebug('episode selector changed', { from: currentId, to: id });
    desiredContentId.value = id;
    // Reset explicit stream choice when switching episodes.
    selectedStreamKey.value = 'AUTO';
    // Use the same switching logic as skip buttons (works reliably for torrents/episodes).
    await goToEpisodeId(id);
});

watch(selectedQuality, async () => {
    if (!selectorsReady.value) return;
    const id = desiredContentId.value || clientState.value?.room?.contentId;
    if (!id) return;
    await applySelectionForContentId(id);
});

watch(selectedStreamKey, async () => {
    if (!selectorsReady.value) return;
    const id = desiredContentId.value || clientState.value?.room?.contentId;
    if (!id) return;
    await applySelectionForContentId(id);
});

watch(streamSelectOptions, (opts) => {
    // If the currently selected stream is filtered out (e.g. 0 seeders), fall back to Auto.
    if (selectedStreamKey.value === 'AUTO') return;
    const exists = (opts || []).some(o => o.value === selectedStreamKey.value);
    if (!exists) selectedStreamKey.value = 'AUTO';
});

const quickSwitch = computed(() => ({
    disabled: !isUserOwner.value,
    isSeries: isSeries.value,
    seasons: seasonSelectOptions.value || [],
    episodes: episodeSelectOptions.value || [],
    streams: streamSelectOptions.value || [],
    qualities: qualitySelectOptions.value || [],
    selectedEpisodeId: selectedEpisodeId.value,
    selectedStreamKey: selectedStreamKey.value,
    selectedQuality: selectedQuality.value,
    loading: availableStreamsLoading.value
}));

const onQuickSwitchEpisode = async (id) => {
    episodeDebug('QuickSwitch episode clicked', { id });
    
    // Execute immediately (don't depend on selectorsReady/watchers).
    if (!id) return;
    if (!isUserOwner.value) return;
    
    // Set flag to prevent watcher from also calling goToEpisodeId.
    isQuickSwitchChange.value = true;
    selectedEpisodeId.value = id;
    desiredContentId.value = id;
    selectedStreamKey.value = 'AUTO';
    await goToEpisodeId(id);
};
const onQuickSwitchStream = (key) => {
    selectedStreamKey.value = key;
};
const onQuickSwitchQuality = (q) => {
    selectedQuality.value = q;
};

const onRequestSource = async () => {
    // Only the room owner can pick/set the room stream.
    if (!isUserOwner.value) return;
    const targetId = desiredContentId.value || clientState.value?.room?.contentId;
    if (!targetId) return;

    // First try to (re)build the local src/hls from the current room stream (helps after HMR/reconnect).
    try {
        await syncRoom();
        if (playerOptions.value?.src) return;
    } catch (_) {
        // ignore
    }

    // If addons aren't loaded yet, we can't auto-pick a new stream. At least avoid a silent no-op.
    if (!installedStreamAddons.value || installedStreamAddons.value.length === 0) {
        // eslint-disable-next-line no-console
        console.warn('[Room] Cannot auto-select stream: no installed stream addons loaded yet');
        return;
    }

    await applySelectionForContentId(targetId);
};

let syncPlayerInterval = null;

onMounted(() => {
    const { id } = router.currentRoute.value.params;
    ClientService.send('room.join', { id });

    // If we never receive room state (sync/room), show a hint instead of spinning forever.
    setTimeout(() => {
        if (!playerOptions.value) joinTimedOut.value = true;
    }, 8000);
    
    syncPlayerInterval = setInterval(() => {
        if (playerState.value.video && !playerState.value.paused) {
            syncPlayer();
        }
    }, 1000);
});

onUnmounted(() => {
    clearInterval(syncPlayerInterval);
    syncPlayerInterval = null;
});

onBeforeRouteLeave(() => {
    store.commit('client/updateError', null);
});
</script>

<style lang="scss" scoped>
.room {
    display: flex;
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    width: 100%;
    user-select: none;

    &.chat-open {
        .users-list {
            display: none;
        }
    }

    .controls {
        z-index: 97;
        position: absolute;
        top: 0.75rem;
        right: 1rem;
    }

    .titlebar {
        z-index: 97;
        position: absolute;
        top: 0.7rem;
        left: 50%;
        transform: translateX(-50%);
        // Force CSS `min()` (Sass tries to evaluate min() and fails with mixed units).
        max-width: #{'min(70vw, 700px)'};
        padding: 0.35rem 0.8rem;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(10px);
        color: white;
        text-align: center;
        pointer-events: none;
        opacity: 1;
        transform: translateX(-50%) translateY(0);
        transition: opacity 0.25s ease, transform 0.25s ease;

        &.hidden {
            opacity: 0;
            transform: translateX(-50%) translateY(-6px);
        }

        .name {
            font-family: 'Montserrat-SemiBold';
            font-size: 14px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .episode {
            font-family: 'Montserrat-Medium';
            font-size: 12px;
            opacity: 0.85;
        }
    }

}

@media only screen and (min-width: 768px) and (min-height: 768px) {
    .room {
        &.chat-open {
            .users-list {
                display: inherit;
            }
        }
    }
}
</style>