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
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
};

let pc = new RTCPeerConnection(servers);
let remoteStream = new MediaStream();

let saveNameConfirmed = false;
let outgoingVideoStream = null;
let videoInputDevices = [];
let currentVideoDeviceIndex = 0;
let videoEnabled = true;
let audioEnabled = true;
let currentRoomId = null;

let callUnsub = null;

const nameInput = document.getElementById('nameInput');
const idInput = document.getElementById('idInput');
const saveNameBtn = document.getElementById('saveName');
const enterCallBtn = document.getElementById('enterCall');
const waitingRoom = document.getElementById('waitingRoom');
const inCall = document.getElementById('inCall');
const incomingVideo = document.getElementById('incomingVideo');
const endCallBtn = document.getElementById('endCall');

const knockPopup = document.getElementById('knockPopup');
const knockMessage = document.getElementById('knockMessage');
const acceptKnockBtn = document.getElementById('acceptKnock');
const declineKnockBtn = document.getElementById('declineKnock');

const spinnerSVG = `<svg class="waiting-spinner" xmlns="http://www.w3.org/2000/svg"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12 6l0 -3" /><path d="M16.25 7.75l2.15 -2.15" /><path d="M18 12l3 0" /><path d="M16.25 16.25l2.15 2.15" /><path d="M12 18l0 3" /><path d="M7.75 16.25l-2.15 2.15" /><path d="M6 12l-3 0" /><path d="M7.75 7.75l-2.15 -2.15" /></svg>`;

function setVideoOrHide(videoElem, stream, enabled) {
    if (!stream || !enabled || !hasEnabledVideoTrack(stream)) {
        videoElem.srcObject = null;
        videoElem.classList.add('video-hidden');
    } else {
        if (videoElem.srcObject !== stream) videoElem.srcObject = stream;
        videoElem.classList.remove('video-hidden');
    }
}

function hasEnabledVideoTrack(stream) {
    if (!stream) return false;
    const tracks = stream.getVideoTracks();
    return tracks.length > 0 && tracks.some(track => track.enabled);
}

function updateButtons() {
    if (nameInput.value.trim().length >= 1) {
        saveNameBtn.classList.remove('disabled');
        saveNameBtn.disabled = false;
    } else {
        saveNameBtn.classList.add('disabled');
        saveNameBtn.disabled = true;
    }

    if (saveNameConfirmed && nameInput.value.trim().length >= 1 && idInput.value.trim().length >= 1) {
        enterCallBtn.classList.remove('disabled');
        enterCallBtn.disabled = false;
    } else {
        enterCallBtn.classList.add('disabled');
        enterCallBtn.disabled = true;
    }
}

async function ensurePermission(type) {
    let granted = false;
    try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            await navigator.mediaDevices.getUserMedia(type === 'camera' ? { video: true } : { audio: true });
            granted = true;
        }
    } catch (e) { granted = false; }
    return granted;
}

async function getVideoInputDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput');
}

function updateAllOutgoingVideoPreviews() {
    document.querySelectorAll('video.outgoingVideo').forEach(vid => {
        setVideoOrHide(vid, outgoingVideoStream, videoEnabled);
    });
}

function syncMediaToggles() {
    document.querySelectorAll('.videoEnabledToggle').forEach(btn => {
        const videoEnabledIcon = btn.querySelector('#videoEnabled');
        const videoDisabledIcon = btn.querySelector('#videoDisabled');
        if (videoEnabledIcon) videoEnabledIcon.classList.toggle('removed', !videoEnabled);
        if (videoDisabledIcon) videoDisabledIcon.classList.toggle('removed', videoEnabled);
    });

    document.querySelectorAll('.audioEnabledToggle').forEach(btn => {
        const audioEnabledIcon = btn.querySelector('#audioEnabled');
        const audioDisabledIcon = btn.querySelector('#audioDisabled');
        if (audioEnabledIcon) audioEnabledIcon.classList.toggle('removed', !audioEnabled);
        if (audioDisabledIcon) audioDisabledIcon.classList.toggle('removed', audioEnabled);
    });

    if (outgoingVideoStream) {
        outgoingVideoStream.getVideoTracks().forEach(t => t.enabled = videoEnabled);
        outgoingVideoStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);
    }

    if (incomingVideo) {
        setVideoOrHide(incomingVideo, remoteStream, true);
        incomingVideo.muted = !audioEnabled;
        incomingVideo.volume = audioEnabled ? 1 : 0;
    }
}

async function switchToNextCamera() {
    videoInputDevices = await getVideoInputDevices();
    if (videoInputDevices.length === 0) return;
    currentVideoDeviceIndex = (currentVideoDeviceIndex + 1) % videoInputDevices.length;
    const nextDevice = videoInputDevices[currentVideoDeviceIndex];

    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: nextDevice.deviceId } },
            audio: audioEnabled
        });

        const videoTrack = newStream.getVideoTracks()[0];
        const sender = pc.getSenders().find(s => s.track.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);

        outgoingVideoStream = newStream;
        updateAllOutgoingVideoPreviews();
        syncMediaToggles();
    } catch (err) { console.error("Camera switch failed", err); }
}

function setupWebRTC() {
    if (outgoingVideoStream) {
        outgoingVideoStream.getTracks().forEach(track => {
            pc.addTrack(track, outgoingVideoStream);
        });
    }

    pc.ontrack = event => {
        remoteStream.getTracks().forEach(track => remoteStream.removeTrack(track));
        event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
        syncMediaToggles();
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
            leaveCallAndReturnToWaitingRoom();
        }
    };
}

async function startCallAsCreator(roomId) {
    setupWebRTC();
    const callDoc = doc(db, 'rooms', roomId);
    const offerCandidates = collection(callDoc, 'offerCandidates');
    const answerCandidates = collection(callDoc, 'answerCandidates');

    pc.onicecandidate = event => {
        if (event.candidate) addDoc(offerCandidates, event.candidate.toJSON());
    };

    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);
    await updateDoc(callDoc, { offer: { sdp: offerDescription.sdp, type: offerDescription.type }, participants: 2 });

    if (callUnsub) callUnsub();
    callUnsub = onSnapshot(callDoc, snapshot => {
        const data = snapshot.data();
        if (!pc.currentRemoteDescription && data?.answer) {
            const answerDescription = new RTCSessionDescription(data.answer);
            pc.setRemoteDescription(answerDescription);
        }
        if (data && data.hasEnded) {
            leaveCallAndReturnToWaitingRoom();
        }
    });

    onSnapshot(answerCandidates, snapshot => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        });
    });

    transitionToInCall();
}

async function startCallAsJoiner(roomId) {
    setupWebRTC();
    const callDoc = doc(db, 'rooms', roomId);
    const offerCandidates = collection(callDoc, 'offerCandidates');
    const answerCandidates = collection(callDoc, 'answerCandidates');

    pc.onicecandidate = event => {
        if (event.candidate) addDoc(answerCandidates, event.candidate.toJSON());
    };

    const callData = (await getDoc(callDoc)).data();
    await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));

    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);
    await updateDoc(callDoc, { answer: { type: answerDescription.type, sdp: answerDescription.sdp }, participants: 2 });

    if (callUnsub) callUnsub();
    callUnsub = onSnapshot(callDoc, snapshot => {
        const data = snapshot.data();
        if (data && data.hasEnded) {
            leaveCallAndReturnToWaitingRoom();
        }
    });

    onSnapshot(offerCandidates, snapshot => {
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
    if (callUnsub) {
        callUnsub();
        callUnsub = null;
    }
    if (currentRoomId) {
        try {
            const callDocRef = doc(db, 'rooms', currentRoomId);
            await updateDoc(callDocRef, { hasEnded: true, participants: 0 });
        } catch (e) {
        }
    }
    if (pc && pc.signalingState !== "closed") {
        try { pc.close(); } catch (e) { }
    }
    try {
        if (outgoingVideoStream) {
            outgoingVideoStream.getTracks().forEach(track => track.stop());
            outgoingVideoStream = null;
        }
    } catch (e) { }
    try {
        remoteStream.getTracks().forEach(track => remoteStream.removeTrack(track));
    } catch (e) { }
    updateAllOutgoingVideoPreviews();
    setVideoOrHide(incomingVideo, null, false);
    inCall.classList.add('removed');
    waitingRoom.classList.remove('removed');
    enterCallBtn.innerHTML = "Join Room";
}

function addSpinnerToBtn(btn) {
    btn.innerHTML = spinnerSVG;
    if (!document.getElementById('waiting-spinner-style')) {
        const css = document.createElement('style');
        css.id = 'waiting-spinner-style';
        css.innerHTML = `
            .waiting-spinner {
                animation: spinner-rotate 1s linear infinite;
            }
            @keyframes spinner-rotate {
                from { transform: rotate(0deg);}
                to { transform: rotate(360deg);}
            }
        `;
        document.head.appendChild(css);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    nameInput && nameInput.addEventListener('input', updateButtons);
    idInput && idInput.addEventListener('input', updateButtons);

    saveNameBtn && saveNameBtn.addEventListener('click', function () {
        if (!this.classList.contains('disabled')) {
            saveNameConfirmed = true;
            updateButtons();
        }
    });

    const roomSetting = document.getElementById('roomSetting');
    if (roomSetting) {
        const options = roomSetting.querySelectorAll('p');
        options.forEach(option => {
            option.addEventListener('click', () => {
                options.forEach(opt => opt.id = '');
                option.id = 'selectedSetting';
            });
        });
    }

    try {
        outgoingVideoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        updateAllOutgoingVideoPreviews();
    } catch (e) {
        console.warn("Initial camera access denied or unavailable.");
        updateAllOutgoingVideoPreviews();
        setVideoOrHide(incomingVideo, null, false);
    }

    setVideoOrHide(incomingVideo, remoteStream, true);

    enterCallBtn.addEventListener('click', async () => {
        const myName = nameInput.value.trim();
        currentRoomId = idInput.value.trim();
        const isCreating = document.getElementById('selectedSetting').innerText.includes('Create');
        const roomDoc = doc(db, 'rooms', currentRoomId);

        if (isCreating) {
            await setDoc(roomDoc, { creator: myName, knock: null, knockStatus: 'idle', offer: null, answer: null, hasEnded: false, participants: 1 });

            onSnapshot(roomDoc, (docSnap) => {
                const data = docSnap.data();
                if (data && data.knockStatus === 'pending' && data.knock) {
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
            addSpinnerToBtn(enterCallBtn);
        } else {
            const docExists = await getDoc(roomDoc);
            if (!docExists.exists()) return alert("Room does not exist.");

            await updateDoc(roomDoc, { knock: myName, knockStatus: 'pending' });
            addSpinnerToBtn(enterCallBtn);

            const unsub = onSnapshot(roomDoc, (docSnap) => {
                const data = docSnap.data();
                if (data.knockStatus === 'accepted') {
                    unsub();
                    startCallAsJoiner(currentRoomId);
                } else if (data.knockStatus === 'rejected') {
                    unsub();
                    alert("Call declined by host.");
                    enterCallBtn.innerHTML = "Join Failed";
                    setTimeout(() => enterCallBtn.innerHTML = "Join Room", 2000);
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
                syncMediaToggles();
            }
        });
    });

    document.querySelectorAll('.cameraRotate').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (await ensurePermission('camera') && videoEnabled) {
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