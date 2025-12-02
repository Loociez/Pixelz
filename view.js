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
const db = firebase.firestore();

const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get("session");

if (!sessionId) {
  alert("No session ID provided.");
  window.location.href = "lobby.html";
}

const canvas = document.getElementById("viewCanvas");
const ctx = canvas.getContext("2d");

const PIXEL_SIZE = 10;
const GRID_WIDTH = 192;
const GRID_HEIGHT = 128;

canvas.width = PIXEL_SIZE * GRID_WIDTH;
canvas.height = PIXEL_SIZE * GRID_HEIGHT;

function drawPixelArt(pixelData) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const key in pixelData) {
    const { color } = pixelData[key];
    const [x, y] = key.split("_").map(Number);
    ctx.fillStyle = color || "#000000";
    ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
  }

  // Optional: draw grid lines
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID_WIDTH; i++) {
    ctx.beginPath();
    ctx.moveTo(i * PIXEL_SIZE, 0);
    ctx.lineTo(i * PIXEL_SIZE, canvas.height);
    ctx.stroke();
  }
  for (let i = 0; i <= GRID_HEIGHT; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * PIXEL_SIZE);
    ctx.lineTo(canvas.width, i * PIXEL_SIZE);
    ctx.stroke();
  }
}

const infoDiv = document.getElementById("info");
const backBtn = document.getElementById("back-btn");

backBtn.addEventListener("click", () => {
  window.location.href = "lobby.html";
});

// Load the published art from Firestore
db.collection("sessions").doc(sessionId).get()
  .then((doc) => {
    if (!doc.exists) {
      alert("Published art not found.");
      window.location.href = "lobby.html";
      return;
    }

    const data = doc.data();
    if (!data.published) {
      alert("This art is not published.");
      window.location.href = "lobby.html";
      return;
    }

    drawPixelArt(data.published);

    const creator = data.publishedBy || "Unknown";
    const dateStr = data.publishedAt ? new Date(data.publishedAt.toDate()).toLocaleString() : "Unknown date";

    infoDiv.textContent = `Created by: ${creator} | Published on: ${dateStr}`;
  })
  .catch((error) => {
    alert("Error loading art.");
    console.error(error);
    window.location.href = "lobby.html";
  });
