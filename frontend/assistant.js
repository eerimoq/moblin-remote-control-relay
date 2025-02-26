const relayStatusConnecting = "Connecting...";
const relayStatusConnected = "Connected";
const relayStatusKicked = "Kicked";

const assistantStatusConnecting = "Connecting...";
const assistatnStatusConnected = "Connected";

const connectionStatusConnectingToRelay = "Connecting to Relay...";
const connectionStatusConnectingToAssistant =
  "Connecting to assistant on this computer...";
const connectionStatusAssistantClosed = "Assistant connection closed";
const connectionStatusAssistantError = "Assistant connection error";
const connectionStatusConnected = "Connected";
const connectionStatusStreamerClosed = "Streamer connection closed";
const connectionStatusStreamerError = "Streamer connection error";
const connectionStatusRateLimitExceeded = "Rate limit exceeded";

let streamerName = undefined;
let bridgeId = undefined;
let timerId = undefined;
let textEncoder = new TextEncoder();

class Connection {
  constructor(connectionId) {
    this.connectionId = connectionId;
    this.relayDataWebsocket = undefined;
    this.assistantWebsocket = undefined;
    this.status = connectionStatusConnectingToRelay;
    this.statusUpdateTime = new Date();
    this.bridgeToStreamersBytes = 0;
    this.bridgeToAssistantBytes = 0;
    this.bitrateToStreamer = 0;
    this.bitrateToAssistant = 0;
    this.prevBitrateToStreamersBytes = 0;
    this.prevBitrateToAssistantBytes = 0;
  }

  close() {
    if (this.relayDataWebsocket != undefined) {
      this.relayDataWebsocket.close();
    }
    if (this.assistantWebsocket != undefined) {
      this.assistantWebsocket.close();
    }
  }

  setStatus(newStatus) {
    if (this.status == newStatus) {
      return;
    }
    if (this.isAborted() && newStatus != connectionStatusRateLimitExceeded) {
      return;
    }
    this.status = newStatus;
    this.statusUpdateTime = new Date();
    updateConnections();
  }

  isAborted() {
    return (
      this.status == connectionStatusStreamerClosed ||
      this.status == connectionStatusStreamerError ||
      this.status == connectionStatusAssistantClosed ||
      this.status == connectionStatusAssistantError ||
      this.status == connectionStatusRateLimitExceeded
    );
  }

  setupRelayDataWebsocket() {
    this.relayDataWebsocket = new WebSocket(
      `${wsScheme}://${baseUrl}/bridge/data/${bridgeId}/${this.connectionId}`
    );
    this.status = connectionStatusConnectingToRelay;
    this.relayDataWebsocket.onopen = (event) => {
      this.setupAssistantWebsocket();
    };
    this.relayDataWebsocket.onerror = (event) => {
      this.setStatus(connectionStatusStreamerError);
      this.close();
    };
    this.relayDataWebsocket.onclose = (event) => {
      this.setStatus(connectionStatusStreamerClosed);
      this.close();
    };
    this.relayDataWebsocket.onmessage = async (event) => {
      if (this.assistantWebsocket.readyState == WebSocket.OPEN) {
        this.bridgeToAssistantBytes += textEncoder.encode(event.data).length;
        this.assistantWebsocket.send(event.data);
      }
    };
  }

  updateBitrates() {
    this.bitrateToStreamer =
      8 * (this.bridgeToStreamersBytes - this.prevBitrateToStreamersBytes);
    this.prevBitrateToStreamersBytes = this.bridgeToStreamersBytes;
    this.bitrateToAssistant =
      8 * (this.bridgeToAssistantBytes - this.prevBitrateToAssistantBytes);
    this.prevBitrateToAssistantBytes = this.bridgeToAssistantBytes;
  }
}

class Relay {
  constructor() {
    this.controlWebsocket = undefined;
    this.status = relayStatusConnecting;
    this.statusEnabled = false;
  }

  close() {
    if (this.controlWebsocket != undefined) {
      this.controlWebsocket.close();
      this.controlWebsocket = undefined;
    }
  }

  setStatus(newStatus) {
    if (this.status == newStatus) {
      return;
    }
    this.status = newStatus;
    updateRelayStatus();
  }

  sendStatus(status) {
    if (
      this.controlWebsocket != undefined &&
      this.controlWebsocket.readyState == WebSocket.OPEN
    ) {
      this.controlWebsocket.send(JSON.stringify(status));
    }
  }

  setupControlWebsocket() {
    this.controlWebsocket = new WebSocket(
      `${wsScheme}://${baseUrl}/bridge/control/${bridgeId}`
    );
    this.setStatus(relayStatusConnecting);
    this.controlWebsocket.onopen = (event) => {
      this.setStatus(relayStatusConnected);
    };
    this.controlWebsocket.onerror = (event) => {
      if (this.status != relayStatusKicked) {
        reset(10000);
      }
    };
    this.controlWebsocket.onclose = (event) => {
      if (this.status != relayStatusKicked) {
        reset(10000);
      }
    };
    this.controlWebsocket.onmessage = async (event) => {
      let message = JSON.parse(event.data);
      if (message.type == "connect") {
        let connectionId = message.data.connectionId;
        let connection = new Connection(connectionId);
        connection.setupRelayDataWebsocket();
        connections.unshift(connection);
        while (connections.length > 5) {
          connections.pop().close();
        }
      } else if (message.type == "startStatus") {
        this.statusEnabled = true;
      } else if (message.type == "stopStatus") {
        this.statusEnabled = false;
      } else if (message.type == "kicked") {
        this.setStatus(relayStatusKicked);
      } else if (message.type == "rateLimitExceeded") {
        for (const connection of connections) {
          if (connection.connectionId == message.data.connectionId) {
            connection.setStatus(connectionStatusRateLimitExceeded);
          }
        }
      }
    };
  }
}

let relay = undefined;
let connections = [];

function reset(delayMs) {
  for (const connection of connections) {
    connection.close();
  }
  connections = [];
  relay.close();
  relay = new Relay();
  if (timerId != undefined) {
    clearTimeout(timerId);
  }
  timerId = setTimeout(() => {
    timerId = undefined;
    relay.setupControlWebsocket();
  }, delayMs);
}

function makeStreamerUrl() {
  return `${wsScheme}://${baseUrl}/streamer/${bridgeId}`;
}

function makeAssistantUrl() {
  return `${basePath}assistant.html?streamerName=${streamerName}&bridgeId=${bridgeId}`;
}

function copyStreamerUrlToClipboard() {
  navigator.clipboard.writeText(makeStreamerUrl());
}

function makeStatusPageUrl() {
  return `${httpScheme}://${baseUrl}/status.html?bridgeId=${bridgeId}`;
}

function copyStatusPageUrlToClipboard() {
  navigator.clipboard.writeText(makeStatusPageUrl());
}

function toggleShow(inputId, iconId) {
  let input = document.getElementById(inputId);
  let icon = document.getElementById(iconId);
  if (input.type === "password") {
    input.type = "text";
    icon.classList.add("p-icon--hide");
    icon.classList.remove("p-icon--show");
  } else {
    input.type = "password";
    icon.classList.add("p-icon--show");
    icon.classList.remove("p-icon--hide");
  }
}

function toggleShowMoblinStreamerAssistantUrl() {
  toggleShow("streamerAssistantUrl", "streamerAssistantUrlIcon");
}

function toggleShowStatusPageUrl() {
  toggleShow("statusPageUrl", "statusPageUrlIcon");
}

function populateRemoteControllerSetup() {
  document.getElementById("streamerAssistantUrl").value = makeStreamerUrl();
}

function populateSettings() {
  document.getElementById("streamerName").value = streamerName;
  document.getElementById("bridgeId").value = bridgeId;
}

function populateStatusPage() {
}

function makeLocalStorageBridgeIdKey() {
  return `bridgeId.${streamerName}`;
}

function saveSettings() {
  streamerName = document.getElementById("streamerName").value;
  bridgeId = document.getElementById("bridgeId").value;
  localStorage.setItem(makeLocalStorageBridgeIdKey(), bridgeId);
  updateUrl();
  populateRemoteControllerSetup();
  populateStatusPage();
  reset(0);
}

function resetSettings() {
  bridgeId = crypto.randomUUID();
  localStorage.setItem(makeLocalStorageBridgeIdKey(), bridgeId);
  populateRemoteControllerSetup();
  populateSettings();
  populateStatusPage();
  reset(0);
}

function updateConnections() {
}

function updateStatus() {
  if (!relay.statusEnabled) {
    return;
  }
  let status = {
    connections: [],
  };
  for (const connection of connections) {
    status.connections.push({
      status: connection.status,
      aborted: connection.isAborted(),
      statusUpdateTime: connection.statusUpdateTime,
      bitrateToStreamer: connection.bitrateToStreamer,
      bitrateToAssistant: connection.bitrateToAssistant,
    });
  }
  relay.sendStatus(status);
}

function updateRelayStatus() {
  let relayStatus = '<i class="p-icon--error"></i> Unknown server status';
  if (relay.status == relayStatusConnecting) {
    relayStatus =
      '<i class="p-icon--spinner u-animation--spin"></i> Connecting to server';
  } else if (relay.status == relayStatusConnected) {
    relayStatus = '<i class="p-icon--success"></i> Connected to server';
  } else if (relay.status == relayStatusKicked) {
    relayStatus = '<i class="p-icon--error"></i> Kicked by server';
  }
  document.getElementById("relayStatus").innerHTML = relayStatus;
}

function toggleShowBridgeId() {
  let bridgeIdInput = document.getElementById("bridgeId");
  let bridgeIdText = document.getElementById("bridgeIdText");
  let bridgeIdIcon = document.getElementById("bridgeIdIcon");
  if (bridgeIdInput.type === "password") {
    bridgeIdInput.type = "text";
    bridgeIdText.innerText = "Hide";
    bridgeIdIcon.classList.add("p-icon--hide");
    bridgeIdIcon.classList.remove("p-icon--show");
  } else {
    bridgeIdInput.type = "password";
    bridgeIdText.innerText = "Show";
    bridgeIdIcon.classList.add("p-icon--show");
    bridgeIdIcon.classList.remove("p-icon--hide");
  }
}

function loadStreamerName(urlParams) {
  streamerName = urlParams.get("streamerName");
  if (streamerName == undefined) {
    streamerName = "Anna";
  }
}

function loadBridgeId(urlParams) {
  bridgeId = urlParams.get("bridgeId");
  if (bridgeId == undefined) {
    bridgeId = localStorage.getItem(makeLocalStorageBridgeIdKey());
  }
  if (bridgeId == undefined) {
    bridgeId = crypto.randomUUID();
  }
  localStorage.setItem(makeLocalStorageBridgeIdKey(), bridgeId);
}

function updateUrl() {
  history.replaceState(history.state, "", makeAssistantUrl());
}

window.addEventListener("DOMContentLoaded", async (event) => {
  const urlParams = new URLSearchParams(window.location.search);
  loadStreamerName(urlParams);
  loadBridgeId(urlParams);
  updateUrl();
  relay = new Relay();
  relay.setupControlWebsocket();
  populateRemoteControllerSetup();
  populateSettings();
  populateStatusPage();
  updateConnections();
  updateRelayStatus();
  setInterval(() => {
    for (const connection of connections) {
      connection.updateBitrates();
    }
    updateConnections();
    updateStatus();
  }, 1000);
});
