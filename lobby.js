// lobby.js

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

// DOM elements
const createSessionBtn = document.getElementById("create-session-btn");
const usernameInput = document.getElementById("username-input");
const saveUsernameBtn = document.getElementById("username-save-btn");
const logoutBtn = document.getElementById("logout-btn");
const sessionsList = document.getElementById("sessions-list");
const galleryList = document.getElementById("gallery-list");

let currentUser = null;
let currentUsername = "Guest";

// Guest name generator
function generateGuestName() {
  return "Guest" + Math.floor(1000 + Math.random() * 9000);
}

// Save username in Firebase user profile + localStorage
async function saveUsername(username) {
  if (!currentUser) return;
  try {
    await currentUser.updateProfile({ displayName: username });
    localStorage.setItem("username", username);
    currentUsername = username;
    alert(`Username saved as "${currentUsername}"`);
  } catch (err) {
    console.error("Failed to update username:", err);
    alert("Failed to save username.");
  }
}

// Load username on login
function loadUsername() {
  const saved = localStorage.getItem("username");

  if (saved) {
    currentUsername = saved;
  } else if (currentUser?.displayName) {
    currentUsername = currentUser.displayName;
  } else {
    currentUsername = generateGuestName();
  }

  usernameInput.value = currentUsername;
}

// Create persistent session (stays open even if creator offline)
createSessionBtn.addEventListener("click", async () => {
  if (!currentUser) return alert("Please log in.");

  const newSessionRef = db.collection("sessions").doc();

  await newSessionRef.set({
    creatorUid: currentUser.uid,
    creatorUsername: currentUsername,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),

    // These allow others to join long after the creator leaves
    pixels: {},
    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),

    // Publishing data
    published: null,
    publishedAt: null,
  });

  window.location.href = `canvas.html?session=${newSessionRef.id}`;
});

// Username button
saveUsernameBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim();
  if (!username) return alert("Username cannot be empty.");
  saveUsername(username);
});

// Logout
logoutBtn.addEventListener("click", async () => {
  try {
    await auth.signOut();
    window.location.href = "index.html";
  } catch (err) {
    console.error("Logout failed:", err);
    alert("Logout failed, please try again.");
  }
});

// --------------------------
// Load PUBLISHED gallery
// --------------------------

async function loadPublishedGallery() {
  if (!galleryList) return;
  galleryList.innerHTML = "Loading gallery...";

  try {
    // Only fetch sessions that HAVE a published object
    const snapshot = await db.collection("sessions")
      .where("published", "!=", null)
      .orderBy("published")
      .orderBy("publishedAt", "desc")
      .limit(20)
      .get();

    galleryList.innerHTML = "";

    if (snapshot.empty) {
      galleryList.textContent = "No published artworks yet.";
      return;
    }

    snapshot.forEach((doc) => {
      const data = doc.data();
      const published = data.published;

      if (!published) return;

      const item = document.createElement("div");
      item.className = "gallery-item";

      const title = document.createElement("div");
      title.textContent = `By: ${data.creatorUsername || "Unknown"}`;
      title.className = "gallery-username";
      item.appendChild(title);

      const previewCanvas = document.createElement("canvas");
      previewCanvas.width = 64 * 10;
      previewCanvas.height = 64 * 10;
      previewCanvas.className = "gallery-canvas";
      item.appendChild(previewCanvas);

      // Draw preview
      const ctx = previewCanvas.getContext("2d");
      ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

      const PIXEL_SIZE = 10;

      for (const key in published) {
        const { color } = published[key];
        if (!color) continue;
        const [x, y] = key.split("_").map(Number);
        ctx.fillStyle = color;
        ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
      }

      // Open canvas in read-only mode
      item.addEventListener("click", () => {
        window.location.href = `canvas.html?session=${doc.id}&readonly=true`;
      });

      galleryList.appendChild(item);
    });

  } catch (err) {
    console.error("Error loading published gallery:", err);
    galleryList.textContent = "Failed to load published artworks.";
  }
}

// Auth state
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUser = user;
  loadUsername();
  await loadPublishedGallery();
});
