function getQualityRank(stream) {
    const text = `${stream?.title ?? ''} ${stream?.name ?? ''}`.toLowerCase();

    // Common keywords
    if (/\b(4k|uhd)\b/.test(text)) return 2160;

    // Resolution tokens
    const m = text.match(/\b(2160|1440|1080|720|480|360)p\b/);
    if (m) return Number(m[1]);

    return 0;
}

function getSeederCount(stream) {
    const direct =
        stream?.seeders ??
        stream?.seeds ??
        stream?.peers ??
        stream?.peerCount ??
        stream?.numPeers ??
        stream?.numSeeders;

    if (typeof direct === 'number' && Number.isFinite(direct)) return direct;

    const hay = `${stream?.title ?? ''} ${stream?.name ?? ''}`.trim();
    if (!hay) return 0;

    // common patterns: "👤 123", "Seeders: 123", "123 seeds", etc.
    const m =
        hay.match(/(?:👤|👥|peers?|seeders?|seeds?)\s*[:-]?\s*(\d+)/i) ||
        hay.match(/(\d+)\s*(?:peers?|seeders?|seeds?)/i);

    return m ? Number(m[1]) : 0;
}

function isTorrentStream(stream) {
    return stream && stream.infoHash != null;
}

// Higher quality first, then higher seeders/peers
function compareTorrentByQualityThenSeedersDesc(a, b) {
    const qa = getQualityRank(a);
    const qb = getQualityRank(b);
    if (qa !== qb) return qb - qa;

    const sa = getSeederCount(a);
    const sb = getSeederCount(b);
    if (sa !== sb) return sb - sa;

    return 0;
}

// Sort list but only reorder torrents among themselves; keep non-torrents stable.
function sortStreamsWithTorrentOrdering(streams) {
    return (streams || [])
        .map((s, idx) => ({ s, idx }))
        .sort((x, y) => {
            const xt = isTorrentStream(x.s);
            const yt = isTorrentStream(y.s);

            if (xt && yt) {
                const c = compareTorrentByQualityThenSeedersDesc(x.s, y.s);
                return c !== 0 ? c : x.idx - y.idx;
            }

            // Keep relative order for non-torrents, and don't move torrents across non-torrents.
            return x.idx - y.idx;
        })
        .map(({ s }) => s);
}

function pickBestTorrentByQualityThenSeeders(streams) {
    const torrents = (streams || []).filter(isTorrentStream);
    if (!torrents.length) return null;
    return torrents.reduce((best, cur) => {
        return compareTorrentByQualityThenSeedersDesc(cur, best) < 0 ? best : cur;
    }, torrents[0]);
}

export {
    getQualityRank,
    getSeederCount,
    isTorrentStream,
    compareTorrentByQualityThenSeedersDesc,
    sortStreamsWithTorrentOrdering,
    pickBestTorrentByQualityThenSeeders
};





