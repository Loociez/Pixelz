const firebaseConfig = {
  apiKey: "AIzaSyDXRSt2pmgqChOGJr4gr9e2Z_tZaGxBpoo",
  authDomain: "shildonia-38aab.firebaseapp.com",
  projectId: "shildonia-38aab",
  storageBucket: "shildonia-38aab.firebasestorage.app",
  messagingSenderId: "963502122644",
  appId: "1:963502122644:web:adbd0976dab04f25f07681",
  measurementId: "G-MQJ2D3SPTS",
};

// Initialize Firebase only if not already initialized (safety check)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

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

/**
 * Update the progress label text under the slider.
 * @param {number} [currentStep] - current history index (optional, defaults to currentHistoryIndex)
 * @param {number} [totalSteps] - total history length (optional, defaults to sessionHistory.length - 1)
 */
function updateProgressLabel(currentStep = currentHistoryIndex, totalSteps = sessionHistory.length - 1) {
  if (!progressLabel) return;
  progressLabel.textContent = `History step: ${currentStep} / ${totalSteps}`;
}

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
// Undo last user action
function undo() {
  if (userUndoStack.length === 0) return;

  const lastChanges = userUndoStack.pop();
  const redoChanges = [];

  lastChanges.forEach(({ pixelId, oldColor, newColor }) => {
    if (oldColor === null) {
      delete pixelData[pixelId];
    } else {
      pixelData[pixelId] = {
        color: oldColor,
        owner: currentUser.uid,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      };
    }
    redoChanges.push({ pixelId, oldColor: newColor, newColor: oldColor });
  });

  userRedoStack.push(redoChanges);

  drawGrid();
  savePixelsToFirestore();
}

// Redo last undone action
function redo() {
  if (userRedoStack.length === 0) return;

  const lastChanges = userRedoStack.pop();
  const undoChanges = [];

  lastChanges.forEach(({ pixelId, oldColor, newColor }) => {
    if (newColor === null) {
      delete pixelData[pixelId];
    } else {
      pixelData[pixelId] = {
        color: newColor,
        owner: currentUser.uid,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      };
    }
    undoChanges.push({ pixelId, oldColor: oldColor, newColor: newColor });
  });

  userUndoStack.push(undoChanges);

  drawGrid();
  savePixelsToFirestore();
}

// Save pixelData to Firestore document
async function savePixelsToFirestore() {
  try {
    await pixelsDocRef.set(pixelData);
    // Also update session-wide history for creator only
    if (currentUser && currentUser.uid === sessionCreatorUid) {
      // Trim history if we're not at the latest
      if (currentHistoryIndex < sessionHistory.length - 1) {
        sessionHistory = sessionHistory.slice(0, currentHistoryIndex + 1);
      }
      // Save snapshot of pixelData
      const snapshot = JSON.parse(JSON.stringify(pixelData));
      sessionHistory.push({ pixelDataSnapshot: snapshot });
      currentHistoryIndex++;

      // Update slider
      if (progressSlider) {
        progressSlider.max = sessionHistory.length - 1;
        progressSlider.value = currentHistoryIndex;
        updateProgressLabel();
      }
    }
  } catch (e) {
    console.error("Failed to save pixels:", e);
  }
}

// Load pixelData from Firestore document snapshot
function loadPixelsFromSnapshot(snapshot) {
  pixelData = snapshot ? JSON.parse(JSON.stringify(snapshot)) : {};
  drawGrid();
}

// Change session history step (called by slider)
function changeHistoryStep(step) {
  if (step < 0 || step >= sessionHistory.length) return;

  currentHistoryIndex = step;
  const snapshot = sessionHistory[step].pixelDataSnapshot;
  loadPixelsFromSnapshot(snapshot);

  // Update slider and label
  if (progressSlider) {
    progressSlider.value = step;
    updateProgressLabel();
  }
}

// Event: slider changed
if (progressSlider) {
  progressSlider.addEventListener("input", (e) => {
    const step = parseInt(e.target.value, 10);
    changeHistoryStep(step);
  });
}

// Handle canvas mouse down event for painting
canvas.addEventListener("mousedown", (evt) => {
  if (isReadOnly || !currentUser) return;

  const { x, y } = getMousePos(evt);
  const brushSize = parseInt(brushSizeInput.value, 10) || 1;
  const color = isEraserActive ? null : colorPicker.value;

  const changes = applyBrush(x, y, brushSize, color, isEraserActive);

  if (changes.length > 0) {
    userUndoStack.push(changes);
    userRedoStack = [];
    lastPlacedPixel = {
      x,
      y,
      username: currentUsername,
      timestamp: firebase.firestore.Timestamp.now(),
    };
    drawGrid();
    savePixelsToFirestore();
  }
});

// Toggle eraser button
eraserBtn.addEventListener("click", () => {
  isEraserActive = !isEraserActive;
  eraserBtn.classList.toggle("active", isEraserActive);
});

// Undo button click
undoBtn.addEventListener("click", undo);

// Redo button click
redoBtn.addEventListener("click", redo);

// Export pixelData as JSON
exportBtn.addEventListener("click", () => {
  const exportData = JSON.stringify(pixelData, null, 2);
  navigator.clipboard.writeText(exportData)
    .then(() => alert("Pixel data copied to clipboard!"))
    .catch(() => alert("Failed to copy pixel data."));
});

// Import pixelData from textarea
importBtn.addEventListener("click", () => {
  importAreaContainer.style.display = "block";
  importTextarea.value = "";
});

importConfirmBtn.addEventListener("click", () => {
  try {
    const importedData = JSON.parse(importTextarea.value);
    pixelData = importedData;
    drawGrid();
    savePixelsToFirestore();
    importAreaContainer.style.display = "none";
  } catch (e) {
    alert("Invalid JSON data.");
  }
});

// Logout button click
logoutBtn.addEventListener("click", () => {
  auth.signOut();
});

// Publish button click (for example, to finalize or send notifications)
publishBtn.addEventListener("click", () => {
  alert("Publish feature not implemented yet.");
});

// Back to lobby button click
backLobbyBtn.addEventListener("click", () => {
  window.location.href = "lobby.html";
});

// Chat send button
chatSendBtn.addEventListener("click", async () => {
  const message = chatText.value.trim();
  if (!message || !currentUser) return;

  try {
    await chatCollectionRef.add({
      uid: currentUser.uid,
      username: currentUsername,
      message,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });
    chatText.value = "";
  } catch (e) {
    console.error("Failed to send chat message:", e);
  }
});

// Listen for chat messages realtime update
chatCollectionRef
  .orderBy("timestamp", "asc")
  .onSnapshot((snapshot) => {
    chatMessages.innerHTML = "";
    snapshot.forEach((doc) => {
      const { username, message, timestamp } = doc.data();
      const timeStr = timestamp ? new Date(timestamp.toMillis()).toLocaleTimeString() : "";
      const li = document.createElement("li");
      li.textContent = `(${timeStr}) ${username}: ${message}`;
      chatMessages.appendChild(li);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  });
// Firebase auth state change listener
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    currentUsername = user.displayName || user.email || "User";

    // Check if current user is session creator
    try {
      const sessionDoc = await sessionDocRef.get();
      if (sessionDoc.exists) {
        const sessionData = sessionDoc.data();
        sessionCreatorUid = sessionData.creatorUid || null;

        // Show slider only for creator
        if (currentUser.uid === sessionCreatorUid && progressSlider) {
          progressSlider.style.display = "inline-block";
          document.getElementById("progress-container").style.display = "block";
        } else {
          if (progressSlider) progressSlider.style.display = "none";
          document.getElementById("progress-container").style.display = "none";
        }
      }
    } catch (e) {
      console.error("Failed to fetch session info:", e);
    }

    // Initialize pixel data and history after auth and session creator known
    await initializeHistory();

    // Load current pixels from Firestore realtime
    pixelsDocRef.onSnapshot((doc) => {
      if (doc.exists && currentHistoryIndex === sessionHistory.length - 1) {
        const data = doc.data() || {};
        pixelData = data;
        drawGrid();
      }
    });

  } else {
    currentUser = null;
    currentUsername = "Guest";
    window.location.href = "login.html";
  }
});

// Zoom controls (optional)
document.getElementById("zoom-in-btn").addEventListener("click", () => {
  zoomLevel = Math.min(4, zoomLevel + 0.25);
  drawGrid();
});
document.getElementById("zoom-out-btn").addEventListener("click", () => {
  zoomLevel = Math.max(0.25, zoomLevel - 0.25);
  drawGrid();
});

// Prevent actions if read-only mode
if (isReadOnly) {
  colorPicker.disabled = true;
  brushSizeInput.disabled = true;
  eraserBtn.disabled = true;
  undoBtn.disabled = true;
  redoBtn.disabled = true;
  exportBtn.disabled = true;
  importBtn.disabled = true;
  publishBtn.disabled = true;
  chatText.disabled = true;
  chatSendBtn.disabled = true;
  alert("You are in read-only mode. Editing is disabled.");
}
