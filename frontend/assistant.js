const relayStatusConnecting = "Connecting...";
const relayStatusConnected = "Connected";
const relayStatusKicked = "Kicked";

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
    this.status = connectionStatusConnectingToRelay;
    this.statusTimerId = undefined;
  }

  close() {
    if (this.statusTimerId != undefined) {
     clearTimeout(this.statusTimerId);
     this.statusTimerId = undefined;
    }
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
      this.send({hello: {
        apiVersion: "1.0",
        authentication: {
          challenge: "1",
          salt: "2"
        }
      }})
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
      let message = JSON.parse(event.data);
      // console.log("Got", message);
      if (message.ping) {
        this.handlePing();
      } else if (message.identify) {
        this.handleIdentify();
      } else if (message.response) {
        this.handleResponse(message.response.id, message.response.data);
      }
    };
  }

  handlePing() {
    this.send({"pong": {}});
  }

  handleIdentify() {
    this.send({
      identified: {
        ok: {}
      }
    });
    this.sendGetStatusRequest();
  }

  handleResponse(id, data) {
    if (data.getStatus) {
      this.handleGetStatusResponse(data.getStatus);
      this.statusTimerId = setTimeout(() => {
        this.sendGetStatusRequest();
      }, 5000);
    }
  }

  handleGetStatusResponse(status) {
    updateStatus(status);
  }

  sendGetStatusRequest() {
    this.send({
      request: {
        id: 1,
        data: {
          getStatus: {}
        }
      }
    });
  }

  send(message) {
    // console.log("Sending", message);
    this.relayDataWebsocket.send(JSON.stringify(message));
  }
}

class Relay {
  constructor() {
    this.controlWebsocket = undefined;
    this.status = relayStatusConnecting;
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
  return `${basePath}/assistant.html?streamerName=${streamerName}&bridgeId=${bridgeId}`;
}

function copyStreamerUrlToClipboard() {
  navigator.clipboard.writeText(makeStreamerUrl());
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

function makeLocalStorageBridgeIdKey() {
  return `bridgeId.${streamerName}`;
}

function saveSettings() {
  streamerName = document.getElementById("streamerName").value;
  bridgeId = document.getElementById("bridgeId").value;
  localStorage.setItem(makeLocalStorageBridgeIdKey(), bridgeId);
  updateUrl();
  populateRemoteControllerSetup();
  reset(0);
}

function resetSettings() {
  bridgeId = crypto.randomUUID();
  localStorage.setItem(makeLocalStorageBridgeIdKey(), bridgeId);
  populateRemoteControllerSetup();
  populateSettings();
  reset(0);
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

function updateStatus(status) {
  let generalBody = getTableBodyNoHead("statusGeneral");
  let row = generalBody.insertRow(-1);
  appendToRow(row, "Battery level");
  appendToRow(row, status.general.batteryLevel);
  row = generalBody.insertRow(-1);
  appendToRow(row, "Muted");
  appendToRow(row, status.general.isMuted);
  let topLeftBody = getTableBodyNoHead("statusTopLeft");
  for (const name of Object.keys(status.topLeft).sort()) {
    row = topLeftBody.insertRow(-1);
    appendToRow(row, name);
    appendToRow(row, status.topLeft[name].message);
  }
  let topRightBody = getTableBodyNoHead("statusTopRight");
  for (const name of Object.keys(status.topRight).sort()) {
    row = topRightBody.insertRow(-1);
    appendToRow(row, name);
    appendToRow(row, status.topRight[name].message);
  }
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
  updateRelayStatus();
});
