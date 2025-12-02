// canvas.js

const firebaseConfig = {
  apiKey: "AIzaSyDXRSt2pmgqChOGJr4gr9e2Z_tZaGxBpoo",
  authDomain: "shildonia-38aab.firebaseapp.com",
  projectId: "shildonia-38aab",
  storageBucket: "shildonia-38aab.firebasestorage.app",
  messagingSenderId: "963502122644",
  appId: "1:963502122644:web:adbd0976dab04f25f07681",
  measurementId: "G-MQJ2D3SPTS",
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get("session");
const isReadOnly = urlParams.get("readonly") === "true";

if (!sessionId) {
  alert("No session ID provided.");
  window.location.href = "lobby.html";
}

const canvas = document.getElementById("pixelCanvas");
const ctx = canvas.getContext("2d");

const colorPicker = document.getElementById("color-picker");
const brushSizeInput = document.getElementById("brush-size");
const eraserBtn = document.getElementById("eraser-btn");
const undoBtn = document.getElementById("undo-btn");
const redoBtn = document.getElementById("redo-btn");

const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const logoutBtn = document.getElementById("logout-btn");
const publishBtn = document.getElementById("publish-btn");
const backLobbyBtn = document.getElementById("back-lobby-btn");

const chatMessages = document.getElementById("chat-messages");
const chatText = document.getElementById("chat-text");
const chatSendBtn = document.getElementById("chat-send-btn");

const importAreaContainer = document.getElementById("export-import");
const importTextarea = document.getElementById("import-textarea");
const importConfirmBtn = document.getElementById("import-confirm-btn");

// New: progress slider (must be added in HTML)
const progressSlider = document.getElementById("progress-slider");
const progressLabel = document.getElementById("progress-label");

const PIXEL_SIZE = 10;
const GRID_WIDTH = 192;
const GRID_HEIGHT = 128;

const CANVAS_WIDTH = PIXEL_SIZE * GRID_WIDTH;
const CANVAS_HEIGHT = PIXEL_SIZE * GRID_HEIGHT;

canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

let pixelData = {};
let isEraserActive = false;
let currentUser = null;
let currentUsername = "Guest";
let zoomLevel = 1;

const sessionDocRef = db.collection("sessions").doc(sessionId);
const pixelsDocRef = sessionDocRef.collection("pixels").doc("data");
const chatCollectionRef = sessionDocRef.collection("chat");

let userUndoStack = [];
let userRedoStack = [];

let sessionCreatorUid = null;

let lastPlacedPixel = null; // track last placed pixel info for username display

// New: global session-wide history for all pixel changes, array of pixelData snapshots
// Each entry: { pixelDataSnapshot: {...} }
let sessionHistory = [];
// Current position in sessionHistory, -1 means initial empty
let currentHistoryIndex = -1;

// Draw grid + pixels + last placed pixel username label + pixel count for current user
function drawGrid() {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.save();
  ctx.scale(zoomLevel, zoomLevel);

  // Draw pixels
  for (const key in pixelData) {
    const { color, owner } = pixelData[key];
    const [x, y] = key.split("_").map(Number);
    ctx.fillStyle = color || "#000";
    ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);

    if (owner && currentUser && owner !== currentUser.uid) {
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(x * PIXEL_SIZE + PIXEL_SIZE - 3, y * PIXEL_SIZE, 3, 3);
    }
  }

  // Draw grid lines
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID_WIDTH; i++) {
    ctx.beginPath();
    ctx.moveTo(i * PIXEL_SIZE, 0);
    ctx.lineTo(i * PIXEL_SIZE, CANVAS_HEIGHT);
    ctx.stroke();
  }
  for (let i = 0; i <= GRID_HEIGHT; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * PIXEL_SIZE);
    ctx.lineTo(CANVAS_WIDTH, i * PIXEL_SIZE);
    ctx.stroke();
  }

  // Draw username label on last placed pixel
  if (lastPlacedPixel) {
    const { x, y, username, timestamp } = lastPlacedPixel;

    // Only show label if timestamp exists and placed less than 10 seconds ago
    if (
      timestamp &&
      typeof timestamp.toMillis === "function" &&
      Date.now() - timestamp.toMillis() < 10000
    ) {
      const px = x * PIXEL_SIZE;
      const py = y * PIXEL_SIZE;

      ctx.font = "14px Arial";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
      ctx.lineWidth = 4;

      ctx.strokeText(username, px, py - 4);
      ctx.fillText(username, px, py - 4);
    }
  }

  drawUserPixelCount();

  ctx.restore();
}

// Draw current user's placed pixel count on canvas (top-left corner)
function drawUserPixelCount() {
  if (!currentUser) return;

  let count = 0;
  for (const key in pixelData) {
    const pixel = pixelData[key];
    if (pixel.owner === currentUser.uid && pixel.color !== null) {
      count++;
    }
  }

  const text = `Pixels placed: ${count}`;
  ctx.save();
  ctx.resetTransform();
  ctx.font = "16px Arial";
  ctx.fillStyle = "white";
  ctx.strokeStyle = "black";
  ctx.lineWidth = 3;
  ctx.textBaseline = "top";
  ctx.strokeText(text, 10, 10);
  ctx.fillText(text, 10, 10);
  ctx.restore();
}

// Get mouse pixel pos
function getMousePos(evt) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((evt.clientX - rect.left) / (PIXEL_SIZE * zoomLevel));
  const y = Math.floor((evt.clientY - rect.top) / (PIXEL_SIZE * zoomLevel));
  return { x, y };
}

// Apply history state at given index (revert or redo)
function applyHistoryIndex(index) {
  if (index < 0 || index >= sessionHistory.length) {
    console.warn("Invalid history index", index);
    return;
  }
  const snapshot = sessionHistory[index];
  if (!snapshot) return;

  pixelData = JSON.parse(JSON.stringify(snapshot.pixelDataSnapshot)); // deep copy

  currentHistoryIndex = index;

  // Update pixels doc with reverted data (only session creator can do this)
  pixelsDocRef.set(pixelData).then(() => {
    drawGrid();
  }).catch((err) => {
    console.error("Failed to apply history index:", err);
  });

  // Update slider label
  updateProgressLabel();
}

// Update progress label text
function updateProgressLabel() {
  if (!progressLabel) return;
  progressLabel.textContent = `History step: ${currentHistoryIndex + 1} / ${sessionHistory.length}`;
}

// Drawing handler - updates pixels + lastPlacedPixel in Firestore
canvas.addEventListener("click", async (evt) => {
  if (isReadOnly) return;
  if (!currentUser) return;

  const { x, y } = getMousePos(evt);
  if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) return;

  const brushSize = Math.min(Math.max(parseInt(brushSizeInput.value, 10), 1), 10);

  let changes = [];

  // Build updates for brush area
  for (let dx = 0; dx < brushSize; dx++) {
    for (let dy = 0; dy < brushSize; dy++) {
      const px = x + dx;
      const py = y + dy;
      if (px >= GRID_WIDTH || py >= GRID_HEIGHT) continue;

      const pixelId = `${px}_${py}`;
      const oldPixel = pixelData[pixelId] || { color: null, owner: null };
      const oldColor = oldPixel.color;
      const newColor = isEraserActive ? null : colorPicker.value;

      if (oldColor !== newColor) {
        changes.push({ pixelId, oldColor, newColor });
        pixelData[pixelId] = {
          color: newColor,
          owner: currentUser.uid,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        };
      }
    }
  }

  if (changes.length > 0) {
    userUndoStack.push(changes);
    userRedoStack.length = 0;

    try {
      await pixelsDocRef.set(pixelData);

      await sessionDocRef.update({
        lastPlacedPixel: {
          x,
          y,
          username: currentUsername,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        },
      });

      // If current user is session creator, update global session history
      if (currentUser.uid === sessionCreatorUid) {
        // Remove any redo history beyond currentHistoryIndex
        if (currentHistoryIndex < sessionHistory.length - 1) {
          sessionHistory = sessionHistory.slice(0, currentHistoryIndex + 1);
        }
        // Add new snapshot
        sessionHistory.push({ pixelDataSnapshot: JSON.parse(JSON.stringify(pixelData)) });
        currentHistoryIndex = sessionHistory.length - 1;

        // Update slider max and value
        if (progressSlider) {
          progressSlider.max = sessionHistory.length - 1;
          progressSlider.value = currentHistoryIndex;
          updateProgressLabel();
        }
      }

      drawGrid();
    } catch (err) {
      console.error("Error updating pixels and lastPlacedPixel:", err);
      alert("Failed to place pixel. Try again.");
    }
  }
});

// Undo
function undo() {
  if (isReadOnly) return;
  if (!userUndoStack.length) return;
  const changes = userUndoStack.pop();

  changes.forEach(({ pixelId, oldColor }) => {
    if (oldColor === null) {
      delete pixelData[pixelId];
    } else {
      pixelData[pixelId] = { color: oldColor, owner: currentUser.uid };
    }
  });

  userRedoStack.push(changes);
  pixelsDocRef.set(pixelData);
  drawGrid();
}

// Redo
function redo() {
  if (isReadOnly) return;
  if (!userRedoStack.length) return;
  const changes = userRedoStack.pop();

  changes.forEach(({ pixelId, newColor }) => {
    if (newColor === null) {
      delete pixelData[pixelId];
    } else {
      pixelData[pixelId] = { color: newColor, owner: currentUser.uid };
    }
  });

  userUndoStack.push(changes);
  pixelsDocRef.set(pixelData);
  drawGrid();
}

eraserBtn.addEventListener("click", () => {
  if (isReadOnly) return;
  isEraserActive = !isEraserActive;
  eraserBtn.style.background = isEraserActive ? "#d32f2f" : "";
});

undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);

// Export
exportBtn.addEventListener("click", () => {
  if (isReadOnly) return;
  const data = JSON.stringify(pixelData, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `pixel-art-session-${sessionId}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// Import
importBtn.addEventListener("click", () => {
  if (isReadOnly) return;
  importAreaContainer.style.display = "block";
});

importConfirmBtn.addEventListener("click", () => {
  if (isReadOnly) return;
  try {
    pixelData = JSON.parse(importTextarea.value);
    pixelsDocRef.set(pixelData);
    importTextarea.value = "";
    importAreaContainer.style.display = "none";

    // Reset history after import (only for creator)
    if (currentUser && currentUser.uid === sessionCreatorUid) {
      sessionHistory = [{ pixelDataSnapshot: JSON.parse(JSON.stringify(pixelData)) }];
      currentHistoryIndex = 0;
      if (progressSlider) {
        progressSlider.max = 0;
        progressSlider.value = 0;
        updateProgressLabel();
      }
    }
  } catch {
    alert("Invalid JSON");
  }
});

// Listen for slider changes (only for session creator)
if (progressSlider) {
  progressSlider.addEventListener("input", () => {
    if (!currentUser || currentUser.uid !== sessionCreatorUid) return;
    const index = parseInt(progressSlider.value, 10);
    applyHistoryIndex(index);
  });
}

// Chat
chatSendBtn.addEventListener("click", async () => {
  const text = chatText.value.trim();
  if (!text) return;

  await chatCollectionRef.add({
    uid: currentUser.uid,
    username: currentUsername,
    text,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
  });

  chatText.value = "";
});

// Publish
publishBtn.addEventListener("click", async () => {
  if (isReadOnly) return;
  if (currentUser.uid !== sessionCreatorUid) {
    alert("Only the creator can publish.");
    return;
  }

  await sessionDocRef.update({
    published: pixelData,
    publishedAt: firebase.firestore.FieldValue.serverTimestamp(),
    publishedBy: currentUsername,
  });

  alert("Published!");
});

// Zoom
document.getElementById("zoom-in-btn").addEventListener("click", () => {
  zoomLevel = Math.min(zoomLevel + 0.25, 4);
  drawGrid();
});
document.getElementById("zoom-out-btn").addEventListener("click", () => {
  zoomLevel = Math.max(zoomLevel - 0.25, 0.25);
  drawGrid();
});
document.getElementById("reset-zoom-btn").addEventListener("click", () => {
  zoomLevel = 1;
  drawGrid();
});

// Live pixel updates + also listen for lastPlacedPixel field
function listenCanvasUpdates() {
  pixelsDocRef.onSnapshot(async (snap) => {
    if (snap.exists) {
      pixelData = snap.data();
      drawGrid();
    }
  });

  sessionDocRef.onSnapshot((snap) => {
    if (snap.exists) {
      const data = snap.data();
      if (data.lastPlacedPixel) {
        lastPlacedPixel = data.lastPlacedPixel;
        drawGrid();
      }
    }
  });
}

// Live chat updates
function listenChat() {
  chatCollectionRef.orderBy("timestamp").onSnapshot((snap) => {
    chatMessages.innerHTML = "";
    snap.forEach((doc) => {
      const { username, text, timestamp } = doc.data();
      const div = document.createElement("div");
      const time = timestamp ? new Date(timestamp.toDate()).toLocaleTimeString() : "";
      div.textContent = `[${time}] ${username}: ${text}`;
      chatMessages.appendChild(div);
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

// LOGOUT
logoutBtn.addEventListener("click", () => {
  auth.signOut().then(() => {
    window.location.href = "index.html";
  });
});

backLobbyBtn.addEventListener("click", () => {
  window.location.href = "lobby.html";
});

// Auth
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  await user.reload();
  currentUser = auth.currentUser;
  currentUsername = currentUser.displayName || currentUser.email || "Guest";

  const sessionDoc = await sessionDocRef.get();
  if (sessionDoc.exists) {
    sessionCreatorUid = sessionDoc.data().creatorUid;

    if (currentUser.uid === sessionCreatorUid && !isReadOnly) {
      publishBtn.style.display = "inline-block";

      // Show slider UI for creator
      if (progressSlider) {
        progressSlider.style.display = "inline-block";
        progressSlider.max = sessionHistory.length - 1 >= 0 ? sessionHistory.length - 1 : 0;
        progressSlider.value = currentHistoryIndex >= 0 ? currentHistoryIndex : 0;
        updateProgressLabel();
      }
    } else {
      if (progressSlider) {
        progressSlider.style.display = "none";
      }
    }
  }

  if (isReadOnly) {
    colorPicker.style.display = "none";
    brushSizeInput.style.display = "none";
    eraserBtn.style.display = "none";
    undoBtn.style.display = "none";
    redoBtn.style.display = "none";
    exportBtn.style.display = "none";
    importBtn.style.display = "none";
    publishBtn.style.display = "none";
    importAreaContainer.style.display = "none";
    if (progressSlider) progressSlider.style.display = "none";
  }

  listenCanvasUpdates();
  listenChat();
});

// Initial render
drawGrid();
