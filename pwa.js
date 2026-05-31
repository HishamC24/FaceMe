let deferredPrompt;
const installBtn = document.getElementById("install-btn");

// Detect if app is already installed (PWA mode)
const isStandalone = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;

if (!isStandalone) {
    installBtn.classList.add('removed'); // start hidden

    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installBtn.classList.remove('removed');
    });

    installBtn.addEventListener("click", async () => {
        installBtn.classList.add('removed');

        if (deferredPrompt) {
            deferredPrompt.prompt();
            const outcome = await deferredPrompt.userChoice;
            console.log("Install choice:", outcome);
            deferredPrompt = null;
        }
    });
} else {
    installBtn.classList.add('removed');
}

// Register service worker
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js")
            .then(() => console.log("Service worker registered"))
            .catch((err) => console.error("Service worker error:", err));
    });
}
