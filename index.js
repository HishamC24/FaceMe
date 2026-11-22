console.log("1");

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

const servers = {
    iceServers: [
        { urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] }
    ]
};

const enterCallOriginalSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M9 8v-2a2 2 0 0 1 2 -2h7a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-7a2 2 0 0 1 -2 -2v-2" /><path d="M3 12h13l-3 -3" /><path d="M13 15l3 -3" /></svg>`;
const spinnerSVG = `<svg class="waiting-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12 6l0 -3" /><path d="M16.25 7.75l2.15 -2.15" /><path d="M18 12l3 0" /><path d="M16.25 16.25l2.15 2.15" /><path d="M12 18l0 3" /><path d="M7.75 16.25l-2.15 2.15" /><path d="M6 12l-3 0" /><path d="M7.75 7.75l-2.15 -2.15" /></svg>`;

const nameInput = document.getElementById("nameInput");
const idInput = document.getElementById("idInput");
const saveNameBtn = document.getElementById("saveName");
const enterCallBtn = document.getElementById("enterCall");
const waitingRoom = document.getElementById("waitingRoom");
const inCall = document.getElementById("inCall");
const incomingVideo = document.getElementById("incomingVideo");
const endCallBtn = document.getElementById("endCall");
const roomSetting = document.getElementById("roomSetting");
const fullscreenBtn = document.getElementById("fullscreen");

const knockPopup = document.getElementById("knockPopup");
const knockMessage = document.getElementById("knockMessage");
const acceptKnockBtn = document.getElementById("acceptKnock");
const declineKnockBtn = document.getElementById("declineKnock");

let pc = null;
let remoteStream = null;
let outgoingVideoStream = null;
let videoInputDevices = [];
let currentVideoDeviceIndex = 0;
let isFrontCamera = false;

let saveNameConfirmed = false;
let videoEnabled = true;
let audioEnabled = true;
let currentRoomId = null;
let activeSessionId = 0;

let callUnsub = null;
let roomWaitingUnsub = null;
let candidateUnsubs = [];
let queuedCandidates = [];
let settingRemoteDesc = false;

function isCurrentCameraFront(devices, idx) {
    if (!Array.isArray(devices) || idx < 0 || idx >= devices.length) return idx === 0;
    const label = (devices[idx]?.label || "").toLowerCase();
    if (label.includes("front") || label.includes("user") || label.includes("selfie")) return true;
    if (label.includes("back") || label.includes("environment") || label.includes("rear")) return false;
    return idx === 0;
}

function hasEnabledVideoTrack(stream) {
    if (!stream) return false;
    const tracks = stream.getVideoTracks();
    return tracks.length > 0 && tracks.some(track => track.enabled && track.readyState !== "ended");
}

function setVideoOrHide(videoElem, stream, enabled, flipHorizontally = false) {
    if (!videoElem) return;
    if (!stream || !enabled || !hasEnabledVideoTrack(stream)) {
        videoElem.srcObject = null;
        videoElem.classList.add("video-hidden");
        videoElem.style.transform = "";
    } else {
        if (videoElem.srcObject !== stream) videoElem.srcObject = stream;
        videoElem.classList.remove("video-hidden");
        videoElem.style.transform = flipHorizontally ? "scaleX(-1)" : "";
        videoElem.play().catch(() => { });
    }
}

function updateButtons() {
    const hasName = Boolean(nameInput?.value.trim().length);
    const hasId = Boolean(idInput?.value.trim().length);

    if (saveNameBtn) {
        saveNameBtn.classList.toggle("disabled", !hasName);
        saveNameBtn.disabled = !hasName;
    }

    const canEnter = saveNameConfirmed && hasName && hasId;
    if (enterCallBtn) {
        enterCallBtn.classList.toggle("disabled", !canEnter);
        enterCallBtn.disabled = !canEnter;
    }
}

function clearCandidateListeners() {
    candidateUnsubs.forEach(unsub => unsub());
    candidateUnsubs = [];
}

function resetRoomState() {
    if (roomWaitingUnsub) {
        roomWaitingUnsub();
        roomWaitingUnsub = null;
    }
    clearCandidateListeners();
    queuedCandidates = [];
    settingRemoteDesc = false;
    if (enterCallBtn) enterCallBtn.innerHTML = enterCallOriginalSVG;
    knockPopup?.classList.add("removed");
}

function addSpinnerToBtn(btn) {
    if (!btn) return;
    btn.innerHTML = spinnerSVG;
    if (!document.getElementById("waiting-spinner-style")) {
        const css = document.createElement("style");
        css.id = "waiting-spinner-style";
        css.textContent = `
            .waiting-spinner { animation: spinner-rotate 1s linear infinite; }
            @keyframes spinner-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `;
        document.head.appendChild(css);
    }
}

async function getVideoInputDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === "videoinput" && device.deviceId);
}

function updateAllOutgoingVideoPreviews() {
    document.querySelectorAll("video.outgoingVideo").forEach(vid => {
        setVideoOrHide(vid, outgoingVideoStream, videoEnabled, isFrontCamera);
    });
}

function attachRemoteStream() {
    if (!incomingVideo) return;
    if (remoteStream && remoteStream.getTracks().length > 0) {
        if (incomingVideo.srcObject !== remoteStream) {
            incomingVideo.srcObject = remoteStream;
        }
        incomingVideo.classList.remove("video-hidden");
        incomingVideo.muted = false;
        incomingVideo.volume = 1;
        incomingVideo.play().catch(() => { });
    } else {
        incomingVideo.srcObject = null;
    }
}

function syncMediaToggles() {
    document.querySelectorAll(".videoEnabledToggle").forEach(btn => {
        btn.querySelector("#videoEnabled")?.classList.toggle("removed", !videoEnabled);
        btn.querySelector("#videoDisabled")?.classList.toggle("removed", videoEnabled);
    });

    document.querySelectorAll(".audioEnabledToggle").forEach(btn => {
        btn.querySelector("#audioEnabled")?.classList.toggle("removed", !audioEnabled);
        btn.querySelector("#audioDisabled")?.classList.toggle("removed", audioEnabled);
    });

    if (outgoingVideoStream) {
        outgoingVideoStream.getVideoTracks().forEach(t => (t.enabled = videoEnabled));
        outgoingVideoStream.getAudioTracks().forEach(t => (t.enabled = audioEnabled));
    }

    updateAllOutgoingVideoPreviews();
    attachRemoteStream();
}

async function switchToNextCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    videoInputDevices = await getVideoInputDevices();
    if (videoInputDevices.length <= 1) return;

    const prevIndex = currentVideoDeviceIndex;
    const prevStream = outgoingVideoStream;
    currentVideoDeviceIndex = (currentVideoDeviceIndex + 1) % videoInputDevices.length;
    const nextDevice = videoInputDevices[currentVideoDeviceIndex];

    try {
        if (prevStream) {
            prevStream.getTracks().forEach(track => track.stop());
        }

        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: nextDevice.deviceId } },
            audio: audioEnabled
        });

        outgoingVideoStream = newStream;
        isFrontCamera = isCurrentCameraFront(videoInputDevices, currentVideoDeviceIndex);

        const videoTrack = newStream.getVideoTracks()[0];
        const audioTrack = newStream.getAudioTracks()[0];
        if (pc) {
            const videoSender = pc.getSenders().find(s => s.track && s.track.kind === "video");
            if (videoSender && videoTrack) await videoSender.replaceTrack(videoTrack);

            const audioSender = pc.getSenders().find(s => s.track && s.track.kind === "audio");
            if (audioSender && audioTrack) await audioSender.replaceTrack(audioTrack);
        }

        syncMediaToggles();
    } catch (err) {
        console.error("Camera switch failed", err);
        currentVideoDeviceIndex = prevIndex;
        try {
            outgoingVideoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: audioEnabled });
            isFrontCamera = isCurrentCameraFront(videoInputDevices, prevIndex);
            syncMediaToggles();
        } catch (_) { }
    }
}

async function clearSubcollection(docRef, subName) {
    try {
        const snap = await getDocs(collection(docRef, subName));
        await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    } catch (_) { }
}

async function setRemoteDescriptionSafe(descInit) {
    if (!pc || !descInit?.type || !descInit?.sdp) return;
    if (pc.remoteDescription || settingRemoteDesc) return;
    settingRemoteDesc = true;
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(descInit));
        while (queuedCandidates.length > 0) {
            const cand = queuedCandidates.shift();
            try {
                await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (_) { }
        }
    } finally {
        settingRemoteDesc = false;
    }
}

async function addIceCandidateSafe(candData) {
    if (!pc || !candData) return;
    if (!pc.remoteDescription || settingRemoteDesc) {
        queuedCandidates.push(candData);
        return;
    }
    try {
        await pc.addIceCandidate(new RTCIceCandidate(candData));
    } catch (_) { }
}

function setupWebRTC(callDoc, localCandidatesName, remoteCandidatesName, sessionId) {
    if (pc && pc.signalingState !== "closed") {
        pc.close();
    }
    clearCandidateListeners();
    queuedCandidates = [];
    settingRemoteDesc = false;
    remoteStream = new MediaStream();
    pc = new RTCPeerConnection(servers);

    if (outgoingVideoStream) {
        outgoingVideoStream.getTracks().forEach(track => pc.addTrack(track, outgoingVideoStream));
    }

    pc.ontrack = event => {
        const tracks = event.streams?.[0]?.getTracks() || (event.track ? [event.track] : []);
        tracks.forEach(track => {
            if (!remoteStream.getTracks().some(t => t.id === track.id)) {
                remoteStream.addTrack(track);
            }
            track.onunmute = () => attachRemoteStream();
        });
        attachRemoteStream();
    };

    pc.onicecandidate = event => {
        if (event.candidate && activeSessionId === sessionId) {
            addDoc(collection(callDoc, localCandidatesName), event.candidate.toJSON()).catch(() => { });
        }
    };

    const remoteUnsub = onSnapshot(collection(callDoc, remoteCandidatesName), snapshot => {
        if (activeSessionId !== sessionId) return;
        snapshot.docChanges().forEach(async change => {
            if (change.type === "added") {
                await addIceCandidateSafe(change.doc.data());
            }
        });
    });
    candidateUnsubs.push(remoteUnsub);
}

async function startCallAsCreator(roomId, sessionId) {
    const callDoc = doc(db, "rooms", roomId);
    await clearSubcollection(callDoc, "offerCandidates");
    await clearSubcollection(callDoc, "answerCandidates");
    await updateDoc(callDoc, { offer: null, answer: null, sessionId, hasEnded: false, participants: 2 });

    setupWebRTC(callDoc, "offerCandidates", "answerCandidates", sessionId);

    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);
    await updateDoc(callDoc, {
        offer: { sdp: offerDescription.sdp, type: offerDescription.type },
        sessionId
    });

    if (callUnsub) callUnsub();
    callUnsub = onSnapshot(callDoc, async snapshot => {
        if (activeSessionId !== sessionId) return;
        const data = snapshot.data();
        if (!data) return;
        if (data.sessionId === sessionId && data.answer?.sdp && data.answer?.type && !pc?.currentRemoteDescription) {
            await setRemoteDescriptionSafe(data.answer);
        }
        if (data.hasEnded) {
            await leaveCallAndReturnToWaitingRoom();
        }
    });

    transitionToInCall();
}

async function startCallAsJoiner(roomId) {
    const callDoc = doc(db, "rooms", roomId);
    let answeredSession = null;

    const handleSnapshotData = async data => {
        if (!data?.offer?.sdp || !data?.offer?.type) return;
        const sessionId = data.sessionId ?? 1;
        if (answeredSession === sessionId) return;
        answeredSession = sessionId;
        activeSessionId = sessionId;

        setupWebRTC(callDoc, "answerCandidates", "offerCandidates", sessionId);
        await setRemoteDescriptionSafe(data.offer);

        const answerDescription = await pc.createAnswer();
        await pc.setLocalDescription(answerDescription);
        await updateDoc(callDoc, {
            answer: { type: answerDescription.type, sdp: answerDescription.sdp },
            hasEnded: false,
            participants: 2
        });
    };

    if (callUnsub) callUnsub();
    callUnsub = onSnapshot(callDoc, async snapshot => {
        const data = snapshot.data();
        if (!data) return;
        await handleSnapshotData(data);
        if (data.hasEnded && answeredSession !== null) {
            await leaveCallAndReturnToWaitingRoom();
        }
    });

    const initialSnap = await getDoc(callDoc);
    if (initialSnap.exists()) {
        await handleSnapshotData(initialSnap.data());
    }

    transitionToInCall();
}

function transitionToInCall() {
    waitingRoom?.classList.add("removed");
    inCall?.classList.remove("removed");
    knockPopup?.classList.add("removed");
    syncMediaToggles();
}

async function leaveCallAndReturnToWaitingRoom() {
    activeSessionId += 1;
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

    setVideoOrHide(incomingVideo, null, false, false);
    inCall?.classList.add("removed");
    waitingRoom?.classList.remove("removed");
    resetRoomState();
    updateAllOutgoingVideoPreviews();
}

async function determineInitialFrontCameraSetting() {
    videoInputDevices = await getVideoInputDevices();
    currentVideoDeviceIndex = 0;
    isFrontCamera = isCurrentCameraFront(videoInputDevices, currentVideoDeviceIndex);
}

document.addEventListener("DOMContentLoaded", async () => {
    nameInput?.addEventListener("input", updateButtons);
    idInput?.addEventListener("input", updateButtons);

    saveNameBtn?.addEventListener("click", function () {
        if (!this.classList.contains("disabled")) {
            saveNameConfirmed = true;
            updateButtons();
        }
    });

    if (roomSetting) {
        const options = roomSetting.querySelectorAll("p");
        options.forEach(option => {
            option.addEventListener("click", () => {
                if (option.id === "selectedSetting") return;
                options.forEach(opt => (opt.id = ""));
                option.id = "selectedSetting";
                resetRoomState();
            });
        });
    }

    try {
        outgoingVideoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        await determineInitialFrontCameraSetting();
        updateAllOutgoingVideoPreviews();
    } catch (_) {
        try {
            outgoingVideoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            await determineInitialFrontCameraSetting();
        } catch (err) {
            console.warn("Initial camera access denied or unavailable.", err);
        }
        updateAllOutgoingVideoPreviews();
        setVideoOrHide(incomingVideo, null, false, false);
    }

    enterCallBtn?.addEventListener("click", async () => {
        if (enterCallBtn.classList.contains("disabled")) return;

        const myName = nameInput.value.trim();
        currentRoomId = idInput.value.trim();
        const isCreating = document.getElementById("selectedSetting")?.innerText.includes("Create");
        const roomDoc = doc(db, "rooms", currentRoomId);

        resetRoomState();
        addSpinnerToBtn(enterCallBtn);

        if (isCreating) {
            const nextSession = Date.now();
            activeSessionId = nextSession;
            await setDoc(roomDoc, {
                creator: myName,
                knock: null,
                knockStatus: "idle",
                offer: null,
                answer: null,
                sessionId: nextSession,
                hasEnded: false,
                participants: 1
            });

            roomWaitingUnsub = onSnapshot(roomDoc, docSnap => {
                const data = docSnap.data();
                if (data?.knockStatus === "pending" && data.knock) {
                    if (knockMessage) knockMessage.innerText = `${data.knock} wants to join.`;
                    knockPopup?.classList.remove("removed");

                    if (acceptKnockBtn) {
                        acceptKnockBtn.onclick = async () => {
                            if (roomWaitingUnsub) {
                                roomWaitingUnsub();
                                roomWaitingUnsub = null;
                            }
                            knockPopup?.classList.add("removed");
                            const callSession = Date.now();
                            activeSessionId = callSession;
                            await updateDoc(roomDoc, { knockStatus: "accepted", sessionId: callSession });
                            await startCallAsCreator(currentRoomId, callSession);
                        };
                    }

                    if (declineKnockBtn) {
                        declineKnockBtn.onclick = async () => {
                            await updateDoc(roomDoc, { knockStatus: "rejected", knock: null });
                            knockPopup?.classList.add("removed");
                        };
                    }
                }
            });
        } else {
            const docExists = await getDoc(roomDoc);
            if (!docExists.exists()) {
                alert("Room does not exist.");
                resetRoomState();
                return;
            }

            await updateDoc(roomDoc, { knock: myName, knockStatus: "pending" });

            roomWaitingUnsub = onSnapshot(roomDoc, async docSnap => {
                const data = docSnap.data();
                if (data?.knockStatus === "accepted") {
                    if (roomWaitingUnsub) {
                        roomWaitingUnsub();
                        roomWaitingUnsub = null;
                    }
                    await startCallAsJoiner(currentRoomId);
                } else if (data?.knockStatus === "rejected") {
                    if (roomWaitingUnsub) {
                        roomWaitingUnsub();
                        roomWaitingUnsub = null;
                    }
                    alert("Call declined by host.");
                    if (enterCallBtn) enterCallBtn.innerHTML = "Join Failed";
                    setTimeout(() => resetRoomState(), 2000);
                }
            });
        }
    });

    document.querySelectorAll(".videoEnabledToggle").forEach(btn => {
        btn.addEventListener("click", () => {
            videoEnabled = !videoEnabled;
            syncMediaToggles();
        });
    });

    document.querySelectorAll(".audioEnabledToggle").forEach(btn => {
        btn.addEventListener("click", () => {
            audioEnabled = !audioEnabled;
            syncMediaToggles();
        });
    });

    document.querySelectorAll(".cameraRotate").forEach(btn => {
        btn.addEventListener("click", async () => {
            await switchToNextCamera();
        });
    });

    endCallBtn?.addEventListener("click", async () => {
        await leaveCallAndReturnToWaitingRoom();
    });

    syncMediaToggles();
    updateButtons();

    if (fullscreenBtn) {
        fullscreenBtn.addEventListener("click", async () => {
            try {
                if (!document.fullscreenElement) {
                    const elem = inCall && !inCall.classList.contains("removed") ? inCall : document.body;
                    if (elem.requestFullscreen) await elem.requestFullscreen();
                    else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen();
                } else {
                    if (document.exitFullscreen) await document.exitFullscreen();
                    else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
                }
            } catch (e) {
                console.warn("Fullscreen toggle failed", e);
            }
        });
    }
});