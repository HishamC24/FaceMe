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
let callSessionId = 0;

let callUnsub = null;
let waitingUnsub = null;
let candidatesUnsub = null;
let iceQueue = [];
let settingRemoteDesc = false;

function detectFrontCamera(devices, idx) {
    const device = devices?.[idx];
    if (!device) return idx === 0;
    const label = (device.label || "").toLowerCase();
    if (label.includes("front") || label.includes("user") || label.includes("selfie")) return true;
    if (label.includes("back") || label.includes("environment") || label.includes("rear")) return false;
    return idx === 0;
}

function hasActiveVideo(stream) {
    if (!stream) return false;
    return stream.getVideoTracks().some(t => t.enabled && t.readyState !== "ended");
}

function bindVideoElement(videoEl, stream, shouldShow, mirror = false) {
    if (!videoEl) return;
    const show = Boolean(shouldShow && stream && hasActiveVideo(stream));

    if (!show) {
        videoEl.srcObject = null;
        videoEl.classList.add("video-hidden");
        videoEl.style.transform = "";
        return;
    }

    if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
    }
    videoEl.classList.remove("video-hidden");
    videoEl.style.transform = mirror ? "scaleX(-1)" : "";
    videoEl.play().catch(() => { });
}

function refreshOutgoingPreviews() {
    document.querySelectorAll("video.outgoingVideo").forEach(vid => {
        bindVideoElement(vid, outgoingStream, videoEnabled, isFrontCamera);
    });
}

function refreshIncomingPreview() {
    if (!els.incomingVideo) return;
    if (remoteStream && remoteStream.getTracks().length > 0) {
        if (els.incomingVideo.srcObject !== remoteStream) {
            els.incomingVideo.srcObject = remoteStream;
        }
        els.incomingVideo.classList.remove("video-hidden");
        els.incomingVideo.muted = false;
        els.incomingVideo.volume = 1;
        els.incomingVideo.play().catch(() => { });
    } else {
        els.incomingVideo.srcObject = null;
    }
}

function syncMediaState() {
    document.querySelectorAll(".videoEnabledToggle").forEach(btn => {
        btn.querySelector("#videoEnabled")?.classList.toggle("removed", !videoEnabled);
        btn.querySelector("#videoDisabled")?.classList.toggle("removed", videoEnabled);
    });

    document.querySelectorAll(".audioEnabledToggle").forEach(btn => {
        btn.querySelector("#audioEnabled")?.classList.toggle("removed", !audioEnabled);
        btn.querySelector("#audioDisabled")?.classList.toggle("removed", audioEnabled);
    });

    if (outgoingStream) {
        outgoingStream.getVideoTracks().forEach(track => {
            track.enabled = videoEnabled;
        });
        outgoingStream.getAudioTracks().forEach(track => {
            track.enabled = audioEnabled;
        });
    }

    refreshOutgoingPreviews();
    refreshIncomingPreview();
}

function updateFormState() {
    const hasName = Boolean(els.nameInput?.value.trim().length);
    const hasRoom = Boolean(els.idInput?.value.trim().length);

    if (els.saveNameBtn) {
        els.saveNameBtn.classList.toggle("disabled", !hasName);
        els.saveNameBtn.disabled = !hasName;
    }

    const canEnter = nameSaved && hasName && hasRoom;
    if (els.enterCallBtn) {
        els.enterCallBtn.classList.toggle("disabled", !canEnter);
        els.enterCallBtn.disabled = !canEnter;
    }
}

function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (!loading) {
        btn.innerHTML = enterCallOriginalSVG;
        return;
    }
    btn.innerHTML = spinnerSVG;
    if (!document.getElementById("waiting-spinner-style")) {
        const style = document.createElement("style");
        style.id = "waiting-spinner-style";
        style.textContent = `.waiting-spinner{animation:spinner-rotate 1s linear infinite}@keyframes spinner-rotate{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`;
        document.head.appendChild(style);
    }
}

function cleanupRoomListeners() {
    if (waitingUnsub) {
        waitingUnsub();
        waitingUnsub = null;
    }
    if (candidatesUnsub) {
        candidatesUnsub();
        candidatesUnsub = null;
    }
    iceQueue = [];
    settingRemoteDesc = false;
    setButtonLoading(els.enterCallBtn, false);
    els.knockPopup?.classList.add("removed");
}

async function clearSubcollection(parentDocRef, subcollectionName) {
    try {
        const snap = await getDocs(collection(parentDocRef, subcollectionName));
        await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    } catch (_) { }
}

async function initMediaDevices() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
        try {
            outgoingStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (_) {
            outgoingStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        if (navigator.mediaDevices.enumerateDevices) {
            const devices = await navigator.mediaDevices.enumerateDevices();
            videoDevices = devices.filter(d => d.kind === "videoinput" && d.deviceId);
            const activeTrack = outgoingStream?.getVideoTracks()?.[0];
            const activeSettings = activeTrack?.getSettings?.();
            const matchedIndex = activeSettings?.deviceId
                ? videoDevices.findIndex(d => d.deviceId === activeSettings.deviceId)
                : -1;
            cameraIndex = matchedIndex >= 0 ? matchedIndex : 0;
            isFrontCamera = detectFrontCamera(videoDevices, cameraIndex);
        }

        syncMediaState();
    } catch (err) {
        console.warn("Initial camera/mic access unavailable:", err);
        syncMediaState();
    }
}

async function rotateCamera() {
    if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices?.getUserMedia) return;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput" && d.deviceId);
    videoDevices = devices;
    if (videoDevices.length <= 1) return;

    const prevIndex = cameraIndex;
    const prevStream = outgoingStream;
    cameraIndex = (cameraIndex + 1) % videoDevices.length;
    const nextDevice = videoDevices[cameraIndex];

    try {
        if (prevStream) {
            prevStream.getTracks().forEach(t => t.stop());
        }

        const nextStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: nextDevice.deviceId } },
            audio: audioEnabled
        });

        outgoingStream = nextStream;
        isFrontCamera = detectFrontCamera(videoDevices, cameraIndex);

        const newVideoTrack = nextStream.getVideoTracks()[0] || null;
        const newAudioTrack = nextStream.getAudioTracks()[0] || null;

        if (pc) {
            const videoSender = pc.getSenders().find(s => s.track?.kind === "video");
            if (videoSender && newVideoTrack) {
                await videoSender.replaceTrack(newVideoTrack);
            }
            const audioSender = pc.getSenders().find(s => s.track?.kind === "audio");
            if (audioSender && newAudioTrack) {
                await audioSender.replaceTrack(newAudioTrack);
            }
        }

        syncMediaState();
    } catch (err) {
        console.error("Camera switch failed:", err);
        cameraIndex = prevIndex;
        try {
            outgoingStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: audioEnabled });
            isFrontCamera = detectFrontCamera(videoDevices, prevIndex);
            syncMediaState();
        } catch (_) { }
    }
}

async function setRemoteDescOnce(descInit) {
    if (!pc || !descInit?.type || !descInit?.sdp) return;
    if (pc.remoteDescription || settingRemoteDesc) return;

    settingRemoteDesc = true;
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(descInit));
        while (iceQueue.length > 0) {
            const cand = iceQueue.shift();
            try {
                await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (err) {
                console.warn("Buffered ICE candidate error:", err);
            }
        }
    } finally {
        settingRemoteDesc = false;
    }
}

async function addRemoteCandidate(candData) {
    if (!pc || !candData) return;
    if (!pc.remoteDescription || settingRemoteDesc) {
        iceQueue.push(candData);
        return;
    }
    try {
        await pc.addIceCandidate(new RTCIceCandidate(candData));
    } catch (err) {
        console.warn("ICE candidate error:", err);
    }
}

function createPeerConnection() {
    if (pc && pc.signalingState !== "closed") {
        pc.close();
    }
    iceQueue = [];
    settingRemoteDesc = false;
    remoteStream = new MediaStream();
    pc = new RTCPeerConnection(rtcConfig);

    if (outgoingStream) {
        outgoingStream.getTracks().forEach(track => {
            pc.addTrack(track, outgoingStream);
        });
    }

    pc.ontrack = event => {
        const incomingTracks = event.streams?.[0]?.getTracks() || (event.track ? [event.track] : []);
        incomingTracks.forEach(track => {
            if (!remoteStream.getTracks().some(existing => existing.id === track.id)) {
                remoteStream.addTrack(track);
            }
            track.onunmute = () => refreshIncomingPreview();
        });
        if (els.incomingVideo) {
            els.incomingVideo.srcObject = null;
            els.incomingVideo.srcObject = remoteStream;
        }
        refreshIncomingPreview();
    };

    pc.onconnectionstatechange = () => {
        if (pc && ["failed", "closed"].includes(pc.connectionState)) {
            leaveCall();
        }
    };
}

function enterCallView() {
    els.waitingRoom?.classList.add("removed");
    els.inCall?.classList.remove("removed");
    els.knockPopup?.classList.add("removed");
    syncMediaState();
}

async function startCreatorCall(roomId, sessionId) {
    createPeerConnection();
    const roomRef = doc(db, "rooms", roomId);

    await clearSubcollection(roomRef, "offerCandidates");
    await clearSubcollection(roomRef, "answerCandidates");

    pc.onicecandidate = event => {
        if (event.candidate && callSessionId === sessionId) {
            addDoc(collection(roomRef, "offerCandidates"), event.candidate.toJSON()).catch(() => { });
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await updateDoc(roomRef, {
        offer: { type: offer.type, sdp: offer.sdp },
        answer: null,
        sessionId,
        hasEnded: false,
        participants: 2
    });

    if (callUnsub) callUnsub();
    callUnsub = onSnapshot(roomRef, async snap => {
        if (callSessionId !== sessionId) return;
        const data = snap.data();
        if (!data) return;
        if (data.sessionId === sessionId && data.answer?.type && data.answer?.sdp && !pc?.currentRemoteDescription) {
            await setRemoteDescOnce(data.answer);
        }
        if (data.hasEnded) {
            await leaveCall();
        }
    });

    if (candidatesUnsub) candidatesUnsub();
    candidatesUnsub = onSnapshot(collection(roomRef, "answerCandidates"), snap => {
        if (callSessionId !== sessionId) return;
        snap.docChanges().forEach(async change => {
            if (change.type === "added") {
                await addRemoteCandidate(change.doc.data());
            }
        });
    });

    enterCallView();
}

async function startJoinerCall(roomId) {
    createPeerConnection();
    const roomRef = doc(db, "rooms", roomId);
    let answeredSession = null;

    pc.onicecandidate = event => {
        if (event.candidate) {
            addDoc(collection(roomRef, "answerCandidates"), event.candidate.toJSON()).catch(() => { });
        }
    };

    const tryAnswerOffer = async data => {
        if (!data?.offer?.type || !data?.offer?.sdp) return;
        const activeSession = data.sessionId ?? 1;
        if (answeredSession === activeSession) return;
        answeredSession = activeSession;
        callSessionId = activeSession;

        await setRemoteDescOnce(data.offer);
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
        if (data.offer?.type && data.offer?.sdp) {
            await tryAnswerOffer(data);
        }
        if (data.hasEnded) {
            await leaveCall();
        }
    });

    const initialSnap = await getDoc(roomRef);
    if (initialSnap.exists()) {
        await tryAnswerOffer(initialSnap.data());
    }

    if (candidatesUnsub) candidatesUnsub();
    candidatesUnsub = onSnapshot(collection(roomRef, "offerCandidates"), snap => {
        snap.docChanges().forEach(async change => {
            if (change.type === "added") {
                await addRemoteCandidate(change.doc.data());
            }
        });
    });

    enterCallView();
}

async function leaveCall() {
    callSessionId += 1;

    if (callUnsub) {
        callUnsub();
        callUnsub = null;
    }

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
        remoteStream.getTracks().forEach(track => track.stop());
        remoteStream = null;
    }

    if (els.incomingVideo) {
        els.incomingVideo.srcObject = null;
    }

    els.inCall?.classList.add("removed");
    els.waitingRoom?.classList.remove("removed");
    cleanupRoomListeners();
    refreshOutgoingPreviews();
}

document.addEventListener("DOMContentLoaded", async () => {
    els.nameInput?.addEventListener("input", updateFormState);
    els.idInput?.addEventListener("input", updateFormState);

    els.saveNameBtn?.addEventListener("click", () => {
        if (!els.saveNameBtn.classList.contains("disabled")) {
            nameSaved = true;
            updateFormState();
        }
    });

    els.roomSetting?.querySelectorAll("p").forEach(option => {
        option.addEventListener("click", () => {
            if (option.id === "selectedSetting") return;
            els.roomSetting.querySelectorAll("p").forEach(p => (p.id = ""));
            option.id = "selectedSetting";
            cleanupRoomListeners();
        });
    });

    await initMediaDevices();

    els.enterCallBtn?.addEventListener("click", async () => {
        if (els.enterCallBtn.classList.contains("disabled")) return;

        const myName = els.nameInput.value.trim();
        currentRoomId = els.idInput.value.trim();
        const isCreating = document.getElementById("selectedSetting")?.textContent.includes("Create");
        const roomRef = doc(db, "rooms", currentRoomId);

        cleanupRoomListeners();
        setButtonLoading(els.enterCallBtn, true);

        if (isCreating) {
            const nextSession = Date.now();
            callSessionId = nextSession;

            await setDoc(roomRef, {
                creator: myName,
                knock: null,
                knockStatus: "idle",
                offer: null,
                answer: null,
                sessionId: nextSession,
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
                            const activeSession = Date.now();
                            callSessionId = activeSession;
                            await updateDoc(roomRef, { knockStatus: "accepted", sessionId: activeSession });
                            await startCreatorCall(currentRoomId, activeSession);
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
                cleanupRoomListeners();
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
                    await startJoinerCall(currentRoomId);
                } else if (data.knockStatus === "rejected") {
                    if (waitingUnsub) {
                        waitingUnsub();
                        waitingUnsub = null;
                    }
                    alert("Call declined by host.");
                    if (els.enterCallBtn) els.enterCallBtn.textContent = "Join Failed";
                    setTimeout(() => cleanupRoomListeners(), 2000);
                }
            });
        }
    });

    document.querySelectorAll(".videoEnabledToggle").forEach(btn => {
        btn.addEventListener("click", () => {
            videoEnabled = !videoEnabled;
            syncMediaState();
        });
    });

    document.querySelectorAll(".audioEnabledToggle").forEach(btn => {
        btn.addEventListener("click", () => {
            audioEnabled = !audioEnabled;
            syncMediaState();
        });
    });

    document.querySelectorAll(".cameraRotate").forEach(btn => {
        btn.addEventListener("click", rotateCamera);
    });

    els.endCallBtn?.addEventListener("click", leaveCall);

    els.fullscreenBtn?.addEventListener("click", async () => {
        try {
            if (!document.fullscreenElement) {
                const target = els.inCall && !els.inCall.classList.contains("removed") ? els.inCall : document.body;
                await (target.requestFullscreen?.() || target.webkitRequestFullscreen?.());
            } else {
                await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
            }
        } catch (err) {
            console.warn("Fullscreen toggle failed:", err);
        }
    });

    syncMediaState();
    updateFormState();
});