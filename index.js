import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    collection,
    addDoc,
    getDocs,
    deleteDoc,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    // apiKey: "AIzaSyCp_npZTuLNtrIw4BxV_VuuRkO98Fg-bsM",
    apiKey: "FIREBASE_API_KEY_PLACEHOLDER",
    authDomain: "face2face-78436.firebaseapp.com",
    projectId: "face2face-78436",
    storageBucket: "face2face-78436.firebasestorage.app",
    messagingSenderId: "641109439273",
    appId: "1:641109439273:web:0a75fbe2b676258df4fd38"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const rtcConfig = {
    iceServers: [
        { urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] }
    ]
};

const enterCallOriginalSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M9 8v-2a2 2 0 0 1 2 -2h7a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-7a2 2 0 0 1 -2 -2v-2" /><path d="M3 12h13l-3 -3" /><path d="M13 15l3 -3" /></svg>`;
const spinnerSVG = `<svg class="waiting-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12 6l0 -3" /><path d="M16.25 7.75l2.15 -2.15" /><path d="M18 12l3 0" /><path d="M16.25 16.25l2.15 2.15" /><path d="M12 18l0 3" /><path d="M7.75 16.25l-2.15 2.15" /><path d="M6 12l-3 0" /><path d="M7.75 7.75l-2.15 -2.15" /></svg>`;

const els = {
    nameInput: document.getElementById("nameInput"),
    idInput: document.getElementById("idInput"),
    saveNameBtn: document.getElementById("saveName"),
    enterCallBtn: document.getElementById("enterCall"),
    waitingRoom: document.getElementById("waitingRoom"),
    inCall: document.getElementById("inCall"),
    incomingVideo: document.getElementById("incomingVideo"),
    endCallBtn: document.getElementById("endCall"),
    roomSetting: document.getElementById("roomSetting"),
    fullscreenBtn: document.getElementById("fullscreen"),
    knockPopup: document.getElementById("knockPopup"),
    knockMessage: document.getElementById("knockMessage"),
    acceptKnockBtn: document.getElementById("acceptKnock"),
    declineKnockBtn: document.getElementById("declineKnock")
};

let pc = null;
let remoteStream = null;
let outgoingStream = null;
let videoDevices = [];
let cameraIndex = 0;
let isFrontCamera = false;

let nameSaved = false;
let videoEnabled = true;
let audioEnabled = true;
let currentRoomId = null;

let callUnsub = null;
let waitingUnsub = null;
let candidateUnsubs = [];
let iceQueue = [];
let settingRemote = false;

function detectFrontCamera(devices, idx) {
    const dev = devices?.[idx];
    if (!dev) return idx === 0;
    const label = (dev.label || "").toLowerCase();
    if (label.includes("front") || label.includes("user") || label.includes("selfie")) return true;
    if (label.includes("back") || label.includes("environment") || label.includes("rear")) return false;
    return idx === 0;
}

function hasActiveVideo(stream) {
    if (!stream) return false;
    return stream.getVideoTracks().some(t => t.enabled && t.readyState !== "ended");
}

function bindLocalVideo(videoEl, stream, show, mirror) {
    if (!videoEl) return;
    if (!show || !stream || !hasActiveVideo(stream)) {
        videoEl.srcObject = null;
        videoEl.style.transform = "";
        return;
    }
    if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
    }
    videoEl.style.transform = mirror ? "scaleX(-1)" : "";
    videoEl.play().catch(() => { });
}

function refreshLocalPreviews() {
    document.querySelectorAll("video.outgoingVideo").forEach(vid => {
        bindLocalVideo(vid, outgoingStream, videoEnabled, isFrontCamera);
    });
}

function refreshRemoteVideo() {
    if (!els.incomingVideo || !remoteStream) return;
    if (els.incomingVideo.srcObject !== remoteStream) {
        els.incomingVideo.srcObject = remoteStream;
    }
    els.incomingVideo.muted = false;
    els.incomingVideo.volume = 1;
    els.incomingVideo.play().catch(err => {
        console.warn("Remote video autoplay/play warning:", err);
    });
}

function syncMedia() {
    document.querySelectorAll(".videoEnabledToggle").forEach(btn => {
        btn.querySelector("#videoEnabled")?.classList.toggle("removed", !videoEnabled);
        btn.querySelector("#videoDisabled")?.classList.toggle("removed", videoEnabled);
    });

    document.querySelectorAll(".audioEnabledToggle").forEach(btn => {
        btn.querySelector("#audioEnabled")?.classList.toggle("removed", !audioEnabled);
        btn.querySelector("#audioDisabled")?.classList.toggle("removed", audioEnabled);
    });

    if (outgoingStream) {
        outgoingStream.getVideoTracks().forEach(t => (t.enabled = videoEnabled));
        outgoingStream.getAudioTracks().forEach(t => (t.enabled = audioEnabled));
    }

    refreshLocalPreviews();
    refreshRemoteVideo();
}

function updateButtons() {
    const hasName = Boolean(els.nameInput?.value.trim().length);
    const hasId = Boolean(els.idInput?.value.trim().length);

    if (els.saveNameBtn) {
        els.saveNameBtn.classList.toggle("disabled", !hasName);
        els.saveNameBtn.disabled = !hasName;
    }

    const canEnter = nameSaved && hasName && hasId;
    if (els.enterCallBtn) {
        els.enterCallBtn.classList.toggle("disabled", !canEnter);
        els.enterCallBtn.disabled = !canEnter;
    }
}

function setSpinner(active) {
    if (!els.enterCallBtn) return;
    if (!active) {
        els.enterCallBtn.innerHTML = enterCallOriginalSVG;
        return;
    }
    els.enterCallBtn.innerHTML = spinnerSVG;
    if (!document.getElementById("waiting-spinner-style")) {
        const style = document.createElement("style");
        style.id = "waiting-spinner-style";
        style.textContent = `.waiting-spinner{animation:spinner-rotate 1s linear infinite}@keyframes spinner-rotate{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`;
        document.head.appendChild(style);
    }
}

function clearCandidateUnsubs() {
    candidateUnsubs.forEach(fn => fn());
    candidateUnsubs = [];
}

function resetLobbyState() {
    if (waitingUnsub) {
        waitingUnsub();
        waitingUnsub = null;
    }
    iceQueue = [];
    settingRemote = false;
    setSpinner(false);
    els.knockPopup?.classList.add("removed");
}

async function wipeSubcollection(docRef, name) {
    try {
        const snap = await getDocs(collection(docRef, name));
        await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    } catch (_) { }
}

async function initCameraAndMic() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
        try {
            outgoingStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (_) {
            outgoingStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        if (navigator.mediaDevices.enumerateDevices) {
            const list = await navigator.mediaDevices.enumerateDevices();
            videoDevices = list.filter(d => d.kind === "videoinput" && d.deviceId);
            const trackId = outgoingStream?.getVideoTracks()?.[0]?.getSettings?.()?.deviceId;
            const foundIdx = trackId ? videoDevices.findIndex(d => d.deviceId === trackId) : -1;
            cameraIndex = foundIdx >= 0 ? foundIdx : 0;
            isFrontCamera = detectFrontCamera(videoDevices, cameraIndex);
        }

        syncMedia();
    } catch (err) {
        console.warn("Camera/mic init failed:", err);
        syncMedia();
    }
}

async function switchCamera() {
    if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices?.getUserMedia) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    videoDevices = list.filter(d => d.kind === "videoinput" && d.deviceId);
    if (videoDevices.length <= 1) return;

    const prevIdx = cameraIndex;
    const prevStream = outgoingStream;
    cameraIndex = (cameraIndex + 1) % videoDevices.length;
    const nextDev = videoDevices[cameraIndex];

    try {
        if (prevStream) prevStream.getTracks().forEach(t => t.stop());

        const nextStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: nextDev.deviceId } },
            audio: audioEnabled
        });

        outgoingStream = nextStream;
        isFrontCamera = detectFrontCamera(videoDevices, cameraIndex);

        if (pc) {
            const vTrack = nextStream.getVideoTracks()[0] || null;
            const aTrack = nextStream.getAudioTracks()[0] || null;
            const vSender = pc.getSenders().find(s => s.track?.kind === "video");
            const aSender = pc.getSenders().find(s => s.track?.kind === "audio");
            if (vSender && vTrack) await vSender.replaceTrack(vTrack);
            if (aSender && aTrack) await aSender.replaceTrack(aTrack);
        }

        syncMedia();
    } catch (err) {
        console.error("Camera switch failed:", err);
        cameraIndex = prevIdx;
        try {
            outgoingStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: audioEnabled });
            isFrontCamera = detectFrontCamera(videoDevices, prevIdx);
            syncMedia();
        } catch (_) { }
    }
}

async function applyRemoteSdp(desc) {
    if (!pc || !desc?.type || !desc?.sdp) return;
    if (pc.remoteDescription || settingRemote) return;
    settingRemote = true;
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(desc));
        while (iceQueue.length > 0) {
            const c = iceQueue.shift();
            try {
                await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch (_) { }
        }
    } finally {
        settingRemote = false;
    }
}

async function addRemoteIce(cand) {
    if (!pc || !cand) return;
    if (!pc.remoteDescription || settingRemote) {
        iceQueue.push(cand);
        return;
    }
    try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
    } catch (_) { }
}

function buildPeerConnection(roomRef, localSubcol, remoteSubcol) {
    if (pc && pc.signalingState !== "closed") {
        pc.close();
    }
    clearCandidateUnsubs();
    iceQueue = [];
    settingRemote = false;
    remoteStream = new MediaStream();

    pc = new RTCPeerConnection(rtcConfig);

    if (outgoingStream) {
        outgoingStream.getTracks().forEach(track => {
            pc.addTrack(track, outgoingStream);
        });
    }

    pc.ontrack = event => {
        console.log("Remote track received:", event.track?.kind);
        const tracks = event.streams?.[0]?.getTracks() || (event.track ? [event.track] : []);
        tracks.forEach(track => {
            if (!remoteStream.getTracks().some(t => t.id === track.id)) {
                remoteStream.addTrack(track);
            }
            track.onunmute = () => refreshRemoteVideo();
        });
        refreshRemoteVideo();
    };

    pc.onicecandidate = event => {
        if (event.candidate) {
            addDoc(collection(roomRef, localSubcol), event.candidate.toJSON()).catch(() => { });
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", pc?.iceConnectionState);
    };

    const unsubRemoteCand = onSnapshot(collection(roomRef, remoteSubcol), snap => {
        snap.docChanges().forEach(async change => {
            if (change.type === "added") {
                await addRemoteIce(change.doc.data());
            }
        });
    });
    candidateUnsubs.push(unsubRemoteCand);
}

function showInCallUI() {
    els.waitingRoom?.classList.add("removed");
    els.inCall?.classList.remove("removed");
    els.knockPopup?.classList.add("removed");
    syncMedia();
}

async function runCreatorCall(roomId) {
    const roomRef = doc(db, "rooms", roomId);
    await wipeSubcollection(roomRef, "offerCandidates");
    await wipeSubcollection(roomRef, "answerCandidates");

    await updateDoc(roomRef, {
        offer: null,
        answer: null,
        hasEnded: false,
        participants: 2
    });

    buildPeerConnection(roomRef, "offerCandidates", "answerCandidates");

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await updateDoc(roomRef, {
        offer: { type: offer.type, sdp: offer.sdp }
    });

    if (callUnsub) callUnsub();
    callUnsub = onSnapshot(roomRef, async snap => {
        const data = snap.data();
        if (!data) return;
        if (data.answer?.type && data.answer?.sdp && !pc?.currentRemoteDescription) {
            await applyRemoteSdp(data.answer);
        }
        if (data.hasEnded) {
            await endCall();
        }
    });

    showInCallUI();
}

async function runJoinerCall(roomId) {
    const roomRef = doc(db, "rooms", roomId);
    buildPeerConnection(roomRef, "answerCandidates", "offerCandidates");

    let answered = false;
    const handleOffer = async data => {
        if (answered || !data?.offer?.type || !data?.offer?.sdp) return;
        answered = true;
        await applyRemoteSdp(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await updateDoc(roomRef, {
            answer: { type: answer.type, sdp: answer.sdp },
            hasEnded: false,
            participants: 2
        });
    };

    if (callUnsub) callUnsub();
    callUnsub = onSnapshot(roomRef, async snap => {
        const data = snap.data();
        if (!data) return;
        await handleOffer(data);
        if (data.hasEnded) {
            await endCall();
        }
    });

    const snap = await getDoc(roomRef);
    if (snap.exists()) {
        await handleOffer(snap.data());
    }

    showInCallUI();
}

async function endCall() {
    if (callUnsub) {
        callUnsub();
        callUnsub = null;
    }
    clearCandidateUnsubs();

    if (currentRoomId) {
        try {
            await updateDoc(doc(db, "rooms", currentRoomId), { hasEnded: true, participants: 0 });
        } catch (_) { }
    }

    if (pc && pc.signalingState !== "closed") {
        try {
            pc.close();
        } catch (_) { }
    }
    pc = null;

    if (remoteStream) {
        remoteStream.getTracks().forEach(t => t.stop());
        remoteStream = null;
    }
    if (els.incomingVideo) {
        els.incomingVideo.srcObject = null;
    }

    els.inCall?.classList.add("removed");
    els.waitingRoom?.classList.remove("removed");
    resetLobbyState();
    refreshLocalPreviews();
}

document.addEventListener("DOMContentLoaded", async () => {
    els.nameInput?.addEventListener("input", updateButtons);
    els.idInput?.addEventListener("input", updateButtons);

    els.saveNameBtn?.addEventListener("click", () => {
        if (!els.saveNameBtn.classList.contains("disabled")) {
            nameSaved = true;
            updateButtons();
        }
    });

    els.roomSetting?.querySelectorAll("p").forEach(opt => {
        opt.addEventListener("click", () => {
            if (opt.id === "selectedSetting") return;
            els.roomSetting.querySelectorAll("p").forEach(p => (p.id = ""));
            opt.id = "selectedSetting";
            resetLobbyState();
        });
    });

    await initCameraAndMic();

    els.enterCallBtn?.addEventListener("click", async () => {
        if (els.enterCallBtn.classList.contains("disabled")) return;

        const myName = els.nameInput.value.trim();
        currentRoomId = els.idInput.value.trim();
        const isCreating = document.getElementById("selectedSetting")?.textContent.includes("Create");
        const roomRef = doc(db, "rooms", currentRoomId);

        resetLobbyState();
        setSpinner(true);

        if (isCreating) {
            await setDoc(roomRef, {
                creator: myName,
                knock: null,
                knockStatus: "idle",
                offer: null,
                answer: null,
                hasEnded: false,
                participants: 1
            });

            waitingUnsub = onSnapshot(roomRef, snap => {
                const data = snap.data();
                if (!data) return;

                if (data.knockStatus === "pending" && data.knock) {
                    if (els.knockMessage) els.knockMessage.textContent = `${data.knock} wants to join.`;
                    els.knockPopup?.classList.remove("removed");

                    if (els.acceptKnockBtn) {
                        els.acceptKnockBtn.onclick = async () => {
                            if (waitingUnsub) {
                                waitingUnsub();
                                waitingUnsub = null;
                            }
                            els.knockPopup?.classList.add("removed");
                            await updateDoc(roomRef, { knockStatus: "accepted" });
                            await runCreatorCall(currentRoomId);
                        };
                    }

                    if (els.declineKnockBtn) {
                        els.declineKnockBtn.onclick = async () => {
                            await updateDoc(roomRef, { knockStatus: "rejected", knock: null });
                            els.knockPopup?.classList.add("removed");
                        };
                    }
                }
            });
        } else {
            const snap = await getDoc(roomRef);
            if (!snap.exists()) {
                alert("Room does not exist.");
                resetLobbyState();
                return;
            }

            await updateDoc(roomRef, { knock: myName, knockStatus: "pending" });

            waitingUnsub = onSnapshot(roomRef, async snap => {
                const data = snap.data();
                if (!data) return;

                if (data.knockStatus === "accepted") {
                    if (waitingUnsub) {
                        waitingUnsub();
                        waitingUnsub = null;
                    }
                    await runJoinerCall(currentRoomId);
                } else if (data.knockStatus === "rejected") {
                    if (waitingUnsub) {
                        waitingUnsub();
                        waitingUnsub = null;
                    }
                    alert("Call declined by host.");
                    if (els.enterCallBtn) els.enterCallBtn.textContent = "Join Failed";
                    setTimeout(() => resetLobbyState(), 2000);
                }
            });
        }
    });

    document.querySelectorAll(".videoEnabledToggle").forEach(btn => {
        btn.addEventListener("click", () => {
            videoEnabled = !videoEnabled;
            syncMedia();
        });
    });

    document.querySelectorAll(".audioEnabledToggle").forEach(btn => {
        btn.addEventListener("click", () => {
            audioEnabled = !audioEnabled;
            syncMedia();
        });
    });

    document.querySelectorAll(".cameraRotate").forEach(btn => {
        btn.addEventListener("click", switchCamera);
    });

    els.endCallBtn?.addEventListener("click", endCall);

    els.fullscreenBtn?.addEventListener("click", async () => {
        try {
            if (!document.fullscreenElement) {
                const target = els.inCall && !els.inCall.classList.contains("removed") ? els.inCall : document.body;
                await (target.requestFullscreen?.() || target.webkitRequestFullscreen?.());
            } else {
                await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
            }
        } catch (err) {
            console.warn("Fullscreen failed:", err);
        }
    });

    syncMedia();
    updateButtons();
});