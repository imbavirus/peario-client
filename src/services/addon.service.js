import AddonClient from "stremio-addon-client";

function isPlaceholderErrorStream(stream) {
    const url = String(stream?.url || '');
    const title = `${stream?.title ?? ''} ${stream?.name ?? ''}`.toLowerCase();
    const addonName = stream?.addon?.manifest?.name?.toLowerCase() || '';
    // Also check the stored flag in case addon object isn't fully populated
    const isOrion = addonName.includes('orion') || stream?._isOrionAddon === true;

    // Some addons return a "video error" placeholder instead of a real stream.
    // Example seen in the wild:
    // https://github.com/.../videos/error-general.mp4?raw=true
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
    
    // IMPORTANT: If this is from Orion and has error-related keywords in title/name, 
    // ALWAYS allow it through (even if URL doesn't match error pattern).
    // Orion returns error messages in the title/name field, not just in URLs.
    if (isOrion && (title.includes('error') || title.includes('daily') || title.includes('cap') || 
                    title.includes('quota') || title.includes('limit') || title.includes('exceeded') ||
                    title.includes('stream limit') || title.includes('request limit'))) {
        return false; // Don't filter out - user should see the error message
    }
    
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

const AddonService = {

    createCollection(addons) {
        const col = AddonClient.AddonCollection();

        addons.map(descriptor => col.add(AddonClient.fromDescriptor(descriptor)));

        const filter = (manifest, resource, prefix = null) => {
            const { id, idPrefixes, resources, types } = manifest;
            return id !== 'community.peario' && ((prefix ? idPrefixes && idPrefixes.includes(prefix) : true) && resources && resources.includes(resource) && (types.includes('movie') || types.includes('series')))
            || (resources.find(({ name, idPrefixes, types }) => name === resource && (prefix ? idPrefixes && idPrefixes.includes(prefix) : true) && types && (types.includes('movie') || types.includes('series'))));
        };

        const streams = col.getAddons().filter(({ manifest }) => filter(manifest, 'stream', 'tt'));
        const subtitles = col.getAddons().filter(({ manifest }) => filter(manifest, 'subtitles'));

        return {
            streams,
            subtitles
        };
    },

    async detectFromURL(url) {
        const { addon } = await AddonClient.detectFromURL(url);
        return addon;
    },

    async getStreams(collection, type, id) {
        return (await Promise.all(collection.map(async addon => {
            try {
                const { streams } = await addon.get('stream', type, id);
                const { icon, logo } = addon.manifest;
                const isOrionAddon = addon.manifest.name?.toLowerCase().includes('orion');
                
                // Debug: log raw addon response before filtering.
                if (process.env.NODE_ENV === 'development') {
                    console.log(`[AddonService] ${addon.manifest.name} returned for ${id}`, {
                        addonName: addon.manifest.name,
                        isOrion: isOrionAddon,
                        type,
                        id,
                        rawStreamCount: streams?.length ?? 0,
                        rawStreams: streams?.slice(0, 3).map(s => ({
                            hasInfoHash: s?.infoHash != null,
                            hasUrl: s?.url != null,
                            url: s?.url?.substring(0, 100) || null,
                            title: s?.title || s?.name || null,
                        })) || [],
                    });
                }
                
                const mapped = streams.map(stream => {
                    const { infoHash, url } = stream;
                    const streamType = infoHash ? 'Torrent' : url ? url.split(':')[0].toUpperCase() : null;
                    return {
                        ...stream,
                        icon: icon || logo,
                        type: streamType,
                        addon,
                        _isOrionAddon: isOrionAddon // Store for filter function
                    };
                });
                
                // Debug: log Orion streams before filtering
                if (process.env.NODE_ENV === 'development') {
                    const orionStreams = mapped.filter(s => {
                        const addonName = s?.addon?.manifest?.name?.toLowerCase() || '';
                        return addonName.includes('orion');
                    });
                    if (orionStreams.length > 0) {
                        console.log(`[AddonService] ${addon.manifest.name} returned ${orionStreams.length} stream(s) before filtering`, {
                            streams: orionStreams.map(s => ({
                                url: s?.url?.substring(0, 150) || null,
                                title: s?.title || null,
                                name: s?.name || null,
                                addonName: s?.addon?.manifest?.name || null,
                                willBeFiltered: isPlaceholderErrorStream(s),
                                hasErrorKeywords: `${s?.title ?? ''} ${s?.name ?? ''}`.toLowerCase().includes('error') || 
                                                 `${s?.title ?? ''} ${s?.name ?? ''}`.toLowerCase().includes('daily') ||
                                                 `${s?.title ?? ''} ${s?.name ?? ''}`.toLowerCase().includes('limit'),
                            })),
                        });
                    }
                }
                
                const filtered = mapped.filter(s => !isPlaceholderErrorStream(s));
                
                // Debug: log after filtering.
                if (process.env.NODE_ENV === 'development' && filtered.length !== mapped.length) {
                    const filteredOut = mapped.filter(s => isPlaceholderErrorStream(s));
                    console.log(`[AddonService] ${addon.manifest.name} filtered out ${mapped.length - filtered.length} placeholder streams`, {
                        filteredOut: filteredOut.map(s => ({
                            url: s?.url?.substring(0, 100) || null,
                            title: s?.title || s?.name || null,
                            addonName: s?.addon?.manifest?.name || null,
                        })),
                    });
                }
                
                return filtered;
            } catch (e) {
                if (process.env.NODE_ENV === 'development') {
                    console.warn(`[AddonService] ${addon.manifest.name} failed for ${id}`, e);
                }
                return [];
            }
        }))).flat();
    },

    async getSubtitles(collection, type, id) {
        return (await Promise.all(collection.map(async addon => {
            try {
                const { subtitles } = await addon.get('subtitles', type, id);
                return subtitles;
            } catch (e) {
                return [];
            }
        }))).filter(sub => sub).flat();
    }

};

export default AddonService;