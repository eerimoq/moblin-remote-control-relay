function appendRow(body, group, name, value) {
    let row = body.insertRow(-1);
    appendToRow(row, `${group} / ${name}`);
    appendToRow(row, value);
}

function updateStatsGeneral(body, stats) {
    appendRow(body, "General", "Started", timeAgoString(new Date(stats.general.startTime * 1000)));
    appendRow(body, "General", "Rate limit exceeded", stats.general.rateLimitExceeded);
}

function updateStatsBridges(body, stats) {
    appendRow(body, "Bridges", "Connected", stats.bridges.connected);
    appendRow(body, "Bridges", "Streamers connected", stats.bridges.streamersConnected);
}

function updateStatsStreamers(body, stats) {
    appendRow(body, "Streamers", "Connected", stats.streamers.connected);
}

function updateStatsTrafficBridgesToStreamers(body, stats) {
    appendRow(body, "Traffic / Bridges to streamers", "Total bytes", bytesToString(stats.traffic.bridgesToStreamers.totalBytes));
    appendRow(body, "Traffic / Bridges to streamers", "Current bitrate", bitrateToString(stats.traffic.bridgesToStreamers.currentBitrate));
}

function updateStatsTrafficStreamersToBridges(body, stats) {
    appendRow(body, "Traffic / Streamers to bridges", "Total bytes", bytesToString(stats.traffic.streamersToBridges.totalBytes));
    appendRow(body, "Traffic / Streamers to bridges", "Current bitrate", bitrateToString(stats.traffic.streamersToBridges.currentBitrate));
}

async function updateStats() {
    let response = await fetch("stats.json")
    if (!response.ok) {
        return;
    }
    const stats = await response.json()
    let body = getTableBody('statistics');
    updateStatsGeneral(body, stats);
    updateStatsBridges(body, stats);
    updateStatsStreamers(body, stats);
    updateStatsTrafficBridgesToStreamers(body, stats);
    updateStatsTrafficStreamersToBridges(body, stats);
}

window.addEventListener('DOMContentLoaded', async (event) => {
    updateStats();
    setInterval(() => {
        updateStats();
    }, 2000);
});
