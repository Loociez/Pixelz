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

// New tool: brush shape/type
// Possible values: "square", "circle", "line"
let brushShape = "square"; // default brush shape

// Add brush shape selector to tools panel dynamically
const toolsDiv = document.getElementById("tools");
const brushShapeLabel = document.createElement("label");
brushShapeLabel.textContent = "Brush Shape:";
brushShapeLabel.style.color = "#eee";
brushShapeLabel.style.marginLeft = "1rem";

const brushShapeSelect = document.createElement("select");
brushShapeSelect.id = "brush-shape";
["square", "circle", "line"].forEach((shape) => {
  const option = document.createElement("option");
  option.value = shape;
  option.textContent = shape.charAt(0).toUpperCase() + shape.slice(1);
  brushShapeSelect.appendChild(option);
});
brushShapeSelect.value = brushShape;

brushShapeSelect.addEventListener("change", () => {
  brushShape = brushShapeSelect.value;
});

toolsDiv.appendChild(brushShapeLabel);
toolsDiv.appendChild(brushShapeSelect);

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

// Initialize history by loading current pixel data snapshot from Firestore (called after auth and session creator known)
async function initializeHistory() {
  try {
    const pixelsSnap = await pixelsDocRef.get();
    if (pixelsSnap.exists) {
      const data = pixelsSnap.data() || {};
      // Initialize session history with current pixel data snapshot
      sessionHistory = [{ pixelDataSnapshot: JSON.parse(JSON.stringify(data)) }];
      currentHistoryIndex = 0;

      // Show slider for creator if applicable
      if (currentUser && currentUser.uid === sessionCreatorUid && progressSlider) {
        progressSlider.style.display = "inline-block";
        progressSlider.max = sessionHistory.length - 1;
        progressSlider.value = currentHistoryIndex;
        updateProgressLabel();
        document.getElementById("progress-container").style.display = "block";
      }
    } else {
      // No pixel data yet - initialize empty
      sessionHistory = [{ pixelDataSnapshot: {} }];
      currentHistoryIndex = 0;

      if (currentUser && currentUser.uid === sessionCreatorUid && progressSlider) {
        progressSlider.style.display = "inline-block";
        progressSlider.max = 0;
        progressSlider.value = 0;
        updateProgressLabel();
        document.getElementById("progress-container").style.display = "block";
      }
    }
  } catch (e) {
    console.error("Failed to initialize session history:", e);
  }
}

// Draw grid + pixels + last placed pixel username label + pixel count for current user & total pixels
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

// Draw current user's placed pixel count AND total pixels placed on canvas
function drawUserPixelCount() {
  if (!currentUser) return;

  let totalCount = 0;
  let userCount = 0;

  for (const key in pixelData) {
    const pixel = pixelData[key];
    if (pixel.color !== null && pixel.color !== undefined) {
      totalCount++;
      if (pixel.owner === currentUser.uid) {
        userCount++;
      }
    }
  }

  const text = `Pixels placed: You ${userCount} / Total ${totalCount}`;

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
// Apply brush stroke with different shapes
function applyBrush(x, y, brushSize, color, isErase) {
  const changes = [];

  // Helper: set pixel color or erase at (px, py)
  function setPixel(px, py) {
    if (px < 0 || px >= GRID_WIDTH || py < 0 || py >= GRID_HEIGHT) return;

    const pixelId = `${px}_${py}`;
    const oldPixel = pixelData[pixelId] || { color: null, owner: null };
    const oldColor = oldPixel.color;
    const newColor = isErase ? null : color;

    if (oldColor !== newColor) {
      changes.push({ pixelId, oldColor, newColor });
      pixelData[pixelId] = {
        color: newColor,
        owner: currentUser.uid,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      };
    }
  }

  if (brushShape === "square") {
    for (let dx = 0; dx < brushSize; dx++) {
      for (let dy = 0; dy < brushSize; dy++) {
        setPixel(x + dx, y + dy);
      }
    }
  } else if (brushShape === "circle") {
    // Draw circle brush with radius brushSize / 2
    const radius = brushSize / 2;
    for (let dx = -Math.floor(radius); dx <= Math.ceil(radius); dx++) {
      for (let dy = -Math.floor(radius); dy <= Math.ceil(radius); dy++) {
        if (dx * dx + dy * dy <= radius * radius) {
          setPixel(x + dx, y + dy);
        }
      }
    }
  } else if (brushShape === "line") {
    // Draw a horizontal line of length brushSize
    for (let dx = 0; dx < brushSize; dx++) {
      setPixel(x + dx, y);
    }
  }

  return changes;
}

// Drawing handler - updates pixels + lastPlacedPixel in Firestore
canvas.addEventListener("click", async (evt) => {
  if (isReadOnly) return;
  if (!currentUser) return;

  const { x, y } = getMousePos(evt);
  if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) return;

  const brushSize = Math.min(Math.max(parseInt(brushSizeInput.value, 10), 1), 10);
  const changes = applyBrush(x, y, brushSize, colorPicker.value, isEraserActive);

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
          document.getElementById("progress-container").style.display = "block";
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
        document.getElementById("progress-container").style.display = "block";
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

// Chat: Send message when Send button clicked or Enter pressed
chatSendBtn.addEventListener("click", sendChatMessage);
chatText.addEventListener("keydown", async (evt) => {
  if (evt.key === "Enter" && !evt.shiftKey) {
    evt.preventDefault();
    await sendChatMessage();
  }
});

async function sendChatMessage() {
  const text = chatText.value.trim();
  if (!text) return;

  try {
    await chatCollectionRef.add({
      uid: currentUser.uid,
      username: currentUsername,
      text,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });
    chatText.value = "";
  } catch (err) {
    console.error("Failed to send chat message:", err);
    alert("Failed to send message.");
  }
}

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
