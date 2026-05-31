import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCp_npZTuLNtrIw4BxV_VuuRkO98Fg-bsM",
    authDomain: "face2face-78436.firebaseapp.com",
    projectId: "face2face-78436",
    storageBucket: "face2face-78436.firebasestorage.app",
    messagingSenderId: "641109439273",
    appId: "1:641109439273:web:0a75fbe2b676258df4fd38"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const servers = {
    iceServers: [{ urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }]
};

let pc = null;
let remoteStream = new MediaStream();
let outgoingVideoStream = null;
let videoInputDevices = [];
let currentVideoDeviceIndex = 0;
let isFrontCamera = false;

let saveNameConfirmed = false;
let videoEnabled = true;
let audioEnabled = true;
let currentRoomId = null;

let callUnsub = null;
let roomWaitingUnsub = null;

const enterCallOriginalSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M9 8v-2a2 2 0 0 1 2 -2h7a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-7a2 2 0 0 1 -2 -2v-2" /><path d="M3 12h13l-3 -3" /><path d="M13 15l3 -3" /></svg>`;
const spinnerSVG = `<svg class="waiting-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12 6l0 -3" /><path d="M16.25 7.75l2.15 -2.15" /><path d="M18 12l3 0" /><path d="M16.25 16.25l2.15 2.15" /><path d="M12 18l0 3" /><path d="M7.75 16.25l-2.15 2.15" /><path d="M6 12l-3 0" /><path d="M7.75 7.75l-2.15 -2.15" /></svg>`;

const nameInput = document.getElementById('nameInput');
const idInput = document.getElementById('idInput');
const saveNameBtn = document.getElementById('saveName');
const enterCallBtn = document.getElementById('enterCall');
const waitingRoom = document.getElementById('waitingRoom');
const inCall = document.getElementById('inCall');
const incomingVideo = document.getElementById('incomingVideo');
const endCallBtn = document.getElementById('endCall');
const roomSetting = document.getElementById('roomSetting');

const knockPopup = document.getElementById('knockPopup');
const knockMessage = document.getElementById('knockMessage');
const acceptKnockBtn = document.getElementById('acceptKnock');
const declineKnockBtn = document.getElementById('declineKnock');

function isCurrentCameraFront(devices, idx) {
    if (!Array.isArray(devices)) return false;
    if (idx < 0 || idx >= devices.length) return false;
    const device = devices[idx];
    if (device && typeof device.label === 'string') {
        if (device.label.toLowerCase().includes('front')) return true;
        if (device.label.toLowerCase().includes('user')) return true;
        if (device.label.toLowerCase().includes('selfie')) return true;
    }
    if (idx === 0) return true;
    return false;
}

function setVideoOrHide(videoElem, stream, enabled, flipHorizontally = false) {
    if (!videoElem) return;
    if (!stream || !enabled || !hasEnabledVideoTrack(stream)) {
        videoElem.srcObject = null;
        videoElem.classList.add('video-hidden');
        videoElem.style.transform = "";
    } else {
        if (videoElem.srcObject !== stream) videoElem.srcObject = stream;
        videoElem.classList.remove('video-hidden');
        if (flipHorizontally) {
            videoElem.style.transform = "scaleX(-1)";
        } else {
            videoElem.style.transform = "";
        }
    }
}

function hasEnabledVideoTrack(stream) {
    if (!stream) return false;
    const tracks = stream.getVideoTracks();
    return tracks.length > 0 && tracks.some(track => track.enabled);
}

function updateButtons() {
    const hasName = nameInput.value.trim().length >= 1;
    const hasId = idInput.value.trim().length >= 1;

    saveNameBtn.classList.toggle('disabled', !hasName);
    saveNameBtn.disabled = !hasName;

    const canEnter = saveNameConfirmed && hasName && hasId;
    enterCallBtn.classList.toggle('disabled', !canEnter);
    enterCallBtn.disabled = !canEnter;
}

function resetRoomState() {
    if (roomWaitingUnsub) {
        roomWaitingUnsub();
        roomWaitingUnsub = null;
    }
    enterCallBtn.innerHTML = enterCallOriginalSVG;
    knockPopup.classList.add('removed');
}

function addSpinnerToBtn(btn) {
    btn.innerHTML = spinnerSVG;
    if (!document.getElementById('waiting-spinner-style')) {
        const css = document.createElement('style');
        css.id = 'waiting-spinner-style';
        css.innerHTML = `
            .waiting-spinner { animation: spinner-rotate 1s linear infinite; }
            @keyframes spinner-rotate { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        `;
        document.head.appendChild(css);
    }
}

async function ensurePermission(type) {
    try {
        if (navigator.mediaDevices?.getUserMedia) {
            await navigator.mediaDevices.getUserMedia(type === 'camera' ? { video: true } : { audio: true });
            return true;
        }
    } catch (e) { }
    return false;
}

async function getVideoInputDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput');
}

function updateAllOutgoingVideoPreviews() {
    const flip = isFrontCamera;
    document.querySelectorAll('video.outgoingVideo').forEach(vid => {
        setVideoOrHide(vid, outgoingVideoStream, videoEnabled, flip);
    });
}

function syncMediaToggles() {
    document.querySelectorAll('.videoEnabledToggle').forEach(btn => {
        btn.querySelector('#videoEnabled')?.classList.toggle('removed', !videoEnabled);
        btn.querySelector('#videoDisabled')?.classList.toggle('removed', videoEnabled);
    });

    document.querySelectorAll('.audioEnabledToggle').forEach(btn => {
        btn.querySelector('#audioEnabled')?.classList.toggle('removed', !audioEnabled);
        btn.querySelector('#audioDisabled')?.classList.toggle('removed', audioEnabled);
    });

    if (outgoingVideoStream) {
        outgoingVideoStream.getVideoTracks().forEach(t => t.enabled = videoEnabled);
        outgoingVideoStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);
    }

    if (incomingVideo) {
        setVideoOrHide(incomingVideo, remoteStream, true, false);
        incomingVideo.muted = false;
        incomingVideo.volume = 1;
    }
}

async function switchToNextCamera() {
    videoInputDevices = await getVideoInputDevices();
    if (videoInputDevices.length === 0) return;

    currentVideoDeviceIndex = (currentVideoDeviceIndex + 1) % videoInputDevices.length;
    const nextDevice = videoInputDevices[currentVideoDeviceIndex];

    isFrontCamera = isCurrentCameraFront(videoInputDevices, currentVideoDeviceIndex);

    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: nextDevice.deviceId } },
            audio: audioEnabled
        });

        const videoTrack = newStream.getVideoTracks()[0];

        if (pc) {
            const sender = pc.getSenders().find(s => s.track.kind === 'video');
            if (sender) sender.replaceTrack(videoTrack);
        }

        if (outgoingVideoStream) {
            outgoingVideoStream.getTracks().forEach(track => track.stop());
        }

        outgoingVideoStream = newStream;
        updateAllOutgoingVideoPreviews();
        syncMediaToggles();
    } catch (err) { console.error("Camera switch failed", err); }
}

function setupWebRTC() {
    if (pc && pc.signalingState !== "closed") {
        pc.close();
    }
    pc = new RTCPeerConnection(servers);
    remoteStream = new MediaStream();
    setVideoOrHide(incomingVideo, remoteStream, true, false);
    if (outgoingVideoStream) {
        outgoingVideoStream.getTracks().forEach(track => pc.addTrack(track, outgoingVideoStream));
    }
    pc.ontrack = event => {
        event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
        syncMediaToggles();
    };
    pc.onconnectionstatechange = () => {
        if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
            leaveCallAndReturnToWaitingRoom();
        }
    };
}

async function startCallAsCreator(roomId) {
    setupWebRTC();
    const callDoc = doc(db, 'rooms', roomId);

    pc.onicecandidate = event => {
        if (event.candidate) addDoc(collection(callDoc, 'offerCandidates'), event.candidate.toJSON());
    };

    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);
    await updateDoc(callDoc, { offer: { sdp: offerDescription.sdp, type: offerDescription.type }, participants: 2 });

    if (callUnsub) callUnsub();
    callUnsub = onSnapshot(callDoc, snapshot => {
        const data = snapshot.data();
        if (!pc.currentRemoteDescription && data?.answer) {
            pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
        if (data?.hasEnded) leaveCallAndReturnToWaitingRoom();
    });

    onSnapshot(collection(callDoc, 'answerCandidates'), snapshot => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        });
    });

    transitionToInCall();
}

async function startCallAsJoiner(roomId) {
    setupWebRTC();
    const callDoc = doc(db, 'rooms', roomId);

    pc.onicecandidate = event => {
        if (event.candidate) addDoc(collection(callDoc, 'answerCandidates'), event.candidate.toJSON());
    };

    const callData = (await getDoc(callDoc)).data();
    await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));

    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);
    await updateDoc(callDoc, { answer: { type: answerDescription.type, sdp: answerDescription.sdp }, participants: 2 });

    if (callUnsub) callUnsub();
    callUnsub = onSnapshot(callDoc, snapshot => {
        if (snapshot.data()?.hasEnded) leaveCallAndReturnToWaitingRoom();
    });

    onSnapshot(collection(callDoc, 'offerCandidates'), snapshot => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        });
    });

    transitionToInCall();
}

function transitionToInCall() {
    waitingRoom.classList.add('removed');
    inCall.classList.remove('removed');
    knockPopup.classList.add('removed');
    syncMediaToggles();
}

async function leaveCallAndReturnToWaitingRoom() {
    if (callUnsub) { callUnsub(); callUnsub = null; }

    if (currentRoomId) {
        try { await updateDoc(doc(db, 'rooms', currentRoomId), { hasEnded: true, participants: 0 }); } catch (e) { }
    }

    if (pc && pc.signalingState !== "closed") {
        try { pc.close(); } catch (e) { }
    }

    try {
        if (remoteStream) {
            remoteStream.getTracks().forEach(track => track.stop());
        }
    } catch (e) { }

    setVideoOrHide(incomingVideo, null, false, false);

    inCall.classList.add('removed');
    waitingRoom.classList.remove('removed');
    resetRoomState();
}

async function determineInitialFrontCameraSetting() {
    videoInputDevices = await getVideoInputDevices();
    currentVideoDeviceIndex = 0;
    isFrontCamera = isCurrentCameraFront(videoInputDevices, currentVideoDeviceIndex);
}

document.addEventListener('DOMContentLoaded', async () => {
    nameInput?.addEventListener('input', updateButtons);
    idInput?.addEventListener('input', updateButtons);

    saveNameBtn?.addEventListener('click', function () {
        if (!this.classList.contains('disabled')) {
            saveNameConfirmed = true;
            updateButtons();
        }
    });

    if (roomSetting) {
        const options = roomSetting.querySelectorAll('p');
        options.forEach(option => {
            option.addEventListener('click', () => {
                if (option.id === 'selectedSetting') return;

                options.forEach(opt => opt.id = '');
                option.id = 'selectedSetting';
                resetRoomState();
            });
        });
    }

    await determineInitialFrontCameraSetting();

    try {
        const firstDevice = videoInputDevices.length > 0 ? videoInputDevices[0] : null;
        outgoingVideoStream = await navigator.mediaDevices.getUserMedia({ video: firstDevice ? { deviceId: { exact: firstDevice.deviceId } } : true, audio: true });
        updateAllOutgoingVideoPreviews();
    } catch (e) {
        console.warn("Initial camera access denied or unavailable.");
        updateAllOutgoingVideoPreviews();
        setVideoOrHide(incomingVideo, null, false, false);
    }

    setVideoOrHide(incomingVideo, remoteStream, true, false);

    enterCallBtn.addEventListener('click', async () => {
        if (enterCallBtn.classList.contains('disabled')) return;

        const myName = nameInput.value.trim();
        currentRoomId = idInput.value.trim();
        const isCreating = document.getElementById('selectedSetting').innerText.includes('Create');
        const roomDoc = doc(db, 'rooms', currentRoomId);

        addSpinnerToBtn(enterCallBtn);

        if (isCreating) {
            await setDoc(roomDoc, { creator: myName, knock: null, knockStatus: 'idle', offer: null, answer: null, hasEnded: false, participants: 1 });

            roomWaitingUnsub = onSnapshot(roomDoc, (docSnap) => {
                const data = docSnap.data();
                if (data?.knockStatus === 'pending' && data.knock) {
                    knockMessage.innerText = `${data.knock} wants to join.`;
                    knockPopup.classList.remove('removed');

                    acceptKnockBtn.onclick = async () => {
                        await updateDoc(roomDoc, { knockStatus: 'accepted' });
                        startCallAsCreator(currentRoomId);
                    };

                    declineKnockBtn.onclick = async () => {
                        await updateDoc(roomDoc, { knockStatus: 'rejected', knock: null });
                        knockPopup.classList.add('removed');
                    };
                }
            });
        } else {
            const docExists = await getDoc(roomDoc);
            if (!docExists.exists()) {
                alert("Room does not exist.");
                resetRoomState();
                return;
            }

            await updateDoc(roomDoc, { knock: myName, knockStatus: 'pending' });

            roomWaitingUnsub = onSnapshot(roomDoc, (docSnap) => {
                const data = docSnap.data();
                if (data?.knockStatus === 'accepted') {
                    if (roomWaitingUnsub) { roomWaitingUnsub(); roomWaitingUnsub = null; }
                    startCallAsJoiner(currentRoomId);
                } else if (data?.knockStatus === 'rejected') {
                    if (roomWaitingUnsub) { roomWaitingUnsub(); roomWaitingUnsub = null; }
                    alert("Call declined by host.");
                    enterCallBtn.innerHTML = "Join Failed";
                    setTimeout(() => resetRoomState(), 2000);
                }
            });
        }
    });

    document.querySelectorAll('.videoEnabledToggle').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (await ensurePermission('camera')) {
                videoEnabled = !videoEnabled;
                syncMediaToggles();
                updateAllOutgoingVideoPreviews();
            }
        });
    });

    document.querySelectorAll('.audioEnabledToggle').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (await ensurePermission('audio')) {
                audioEnabled = !audioEnabled;
                if (outgoingVideoStream) {
                    outgoingVideoStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);
                }
                syncMediaToggles();
            }
        });
    });

    document.querySelectorAll('.cameraRotate').forEach(btn => {
        btn.addEventListener('click', async () => {
            videoInputDevices = await getVideoInputDevices();
            if (videoInputDevices.length === 0) return;
            currentVideoDeviceIndex = (currentVideoDeviceIndex + 1) % videoInputDevices.length;
            isFrontCamera = isCurrentCameraFront(videoInputDevices, currentVideoDeviceIndex);
            if (videoEnabled) {
                await switchToNextCamera();
            }
        });
    });

    endCallBtn.addEventListener('click', async () => {
        await leaveCallAndReturnToWaitingRoom();
    });

    syncMediaToggles();
    updateButtons();
});