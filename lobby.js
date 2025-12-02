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

const createSessionBtn = document.getElementById("create-session-btn");
const usernameInput = document.getElementById("username-input");
const saveUsernameBtn = document.getElementById("username-save-btn");
const logoutBtn = document.getElementById("logout-btn");
const sessionsList = document.getElementById("sessions-list");
const galleryList = document.getElementById("gallery-list");

let currentUser = null;
let currentUsername = "Guest";

function generateGuestName() {
  return "Guest" + Math.floor(1000 + Math.random() * 9000);
}

// Save username locally and in user profile
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

// Load username from local storage or use guest/default
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

createSessionBtn.addEventListener("click", async () => {
  if (!currentUser) return alert("Please log in.");

  const newSessionRef = db.collection("sessions").doc();
  await newSessionRef.set({
    creatorUid: currentUser.uid,
    creatorUsername: currentUsername,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    pixels: {}, // initial empty pixels
    published: null,
  });

  window.location.href = `canvas.html?session=${newSessionRef.id}`;
});

saveUsernameBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim();
  if (!username) return alert("Username cannot be empty.");
  saveUsername(username);
});

// Logout button listener
logoutBtn.addEventListener("click", async () => {
  try {
    await auth.signOut();
    window.location.href = "index.html";
  } catch (err) {
    console.error("Logout failed:", err);
    alert("Logout failed, please try again.");
  }
});

// Load published gallery
async function loadPublishedGallery() {
  if (!galleryList) return;
  galleryList.innerHTML = "Loading gallery...";

  try {
    // We'll just order by publishedAt descending and filter in code.
    const snapshot = await db.collection("sessions")
      .orderBy("publishedAt", "desc")
      .limit(20)
      .get();

    galleryList.innerHTML = "";

    let foundPublished = false;

    snapshot.forEach((doc) => {
      const data = doc.data();
      const published = data.published;

      if (!published) return; // Skip if not published

      foundPublished = true;

      const item = document.createElement("div");
      item.className = "gallery-item";

      const title = document.createElement("div");
      title.textContent = `By: ${data.creatorUsername || "Unknown"}`;
      title.className = "gallery-username";
      item.appendChild(title);

      const previewCanvas = document.createElement("canvas");
      previewCanvas.width = 64 * 10; // 64 pixels wide * pixel size (10)
      previewCanvas.height = 64 * 10; // 64 pixels tall * pixel size (10)
      previewCanvas.className = "gallery-canvas";
      item.appendChild(previewCanvas);

      // Draw preview of published art on canvas
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

      item.addEventListener("click", () => {
        window.location.href = `canvas.html?session=${doc.id}&readonly=true`;
      });

      galleryList.appendChild(item);
    });

    if (!foundPublished) {
      galleryList.textContent = "No published artworks yet.";
    }
  } catch (err) {
    console.error("Error loading published gallery:", err);
    galleryList.textContent = "Failed to load published artworks.";
  }
}

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  loadUsername();
  await loadPublishedGallery();
});
