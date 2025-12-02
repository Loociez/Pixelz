// auth.js

const firebaseConfig = {
  apiKey: "AIzaSyDXRSt2pmgqChOGJr4gr9e2Z_tZaGxBpoo",
  authDomain: "shildonia-38aab.firebaseapp.com",
  projectId: "shildonia-38aab",
  storageBucket: "shildonia-38aab.firebasestorage.app",
  messagingSenderId: "963502122644",
  appId: "1:963502122644:web:adbd0976dab04f25f07681",
  measurementId: "G-MQJ2D3SPTS",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();

const formTitle = document.getElementById("form-title");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const submitBtn = document.getElementById("submit-btn");
const toggleAuth = document.getElementById("toggle-auth");
const errorMsg = document.getElementById("error-msg");

let isLogin = true;

toggleAuth.addEventListener("click", () => {
  isLogin = !isLogin;
  if (isLogin) {
    formTitle.textContent = "Login";
    submitBtn.textContent = "Login";
    toggleAuth.textContent = "Don't have an account? Register";
  } else {
    formTitle.textContent = "Register";
    submitBtn.textContent = "Register";
    toggleAuth.textContent = "Already have an account? Login";
  }
  errorMsg.textContent = "";
});

submitBtn.addEventListener("click", () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    errorMsg.textContent = "Please enter email and password.";
    return;
  }

  if (isLogin) {
    auth.signInWithEmailAndPassword(email, password)
      .then(() => {
        window.location.href = "lobby.html";
      })
      .catch((error) => {
        errorMsg.textContent = error.message;
      });
  } else {
    auth.createUserWithEmailAndPassword(email, password)
      .then(() => {
        window.location.href = "lobby.html";
      })
      .catch((error) => {
        errorMsg.textContent = error.message;
      });
  }
});

// Redirect to lobby if already logged in
auth.onAuthStateChanged((user) => {
  if (user) {
    window.location.href = "lobby.html";
  }
});
