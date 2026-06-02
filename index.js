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

const AppState = {
    currentRoomId: null,
    saveNameConfirmed: false,
    isFrontCamera: false,
    unsubs: []
};

const MediaState = {
    videoEnabled: getStoredBool("f2f_videoEnabled", false),
    audioEnabled: getStoredBool("f2f_audioEnabled", false),
    outgoingStream: null,
    remoteStream: new MediaStream(),
    videoDevices: [],
    currentDeviceIndex: 0
};

const RTCState = {
    pc: null
};

const UI = {
    nameInput: document.getElementById('nameInput'),
    idInput: document.getElementById('idInput'),
    saveNameBtn: document.getElementById('saveName'),
    enterCallBtn: document.getElementById('enterCall'),
    waitingRoom: document.getElementById('waitingRoom'),
    inCall: document.getElementById('inCall'),
    incomingVideo: document.getElementById('incomingVideo'),
    endCallBtn: document.getElementById('endCall'),
    roomSetting: document.getElementById('roomSetting'),
    knockPopup: document.getElementById('knockPopup'),
    knockMessage: document.getElementById('knockMessage'),
    acceptKnockBtn: document.getElementById('acceptKnock'),
    declineKnockBtn: document.getElementById('declineKnock'),
    outgoingVideos: document.querySelectorAll('video.outgoingVideo'),
    videoToggles: document.querySelectorAll('.videoEnabledToggle'),
    audioToggles: document.querySelectorAll('.audioEnabledToggle'),
    cameraRotates: document.querySelectorAll('.cameraRotate'),
    fullscreenBtn: document.getElementById('fullscreen')
};

const enterCallOriginalSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M9 8v-2a2 2 0 0 1 2 -2h7a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-7a2 2 0 0 1 -2 -2v-2" /><path d="M3 12h13l-3 -3" /><path d="M13 15l3 -3" /></svg>`;
const spinnerSVG = `<svg class="waiting-spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12 6l0 -3" /><path d="M16.25 7.75l2.15 -2.15" /><path d="M18 12l3 0" /><path d="M16.25 16.25l2.15 2.15" /><path d="M12 18l0 3" /><path d="M7.75 16.25l-2.15 2.15" /><path d="M6 12l-3 0" /><path d="M7.75 7.75l-2.15 -2.15" /></svg>`;

function getStoredBool(key, def) {
    return window.localStorage && localStorage.getItem(key) !== null
        ? localStorage.getItem(key) === "true"
        : def;
}

function setStoredBool(key, value) {
    if (window.localStorage) localStorage.setItem(key, value ? "true" : "false");
}

function persistMediaStates() {
    setStoredBool("f2f_videoEnabled", MediaState.videoEnabled);
    setStoredBool("f2f_audioEnabled", MediaState.audioEnabled);
}

function hasEnabledVideoTrack(stream) {
    return stream?.getVideoTracks().some(track => track.enabled) ?? false;
}

function isCurrentCameraFront(device) {
    if (!device?.label) return true;
    const label = device.label.toLowerCase();
    return label.includes('front') || label.includes('user') || label.includes('selfie');
}

function updateFormValidation() {
    const hasName = UI.nameInput.value.trim().length >= 1;
    const hasId = UI.idInput.value.trim().length >= 1;

    UI.saveNameBtn.classList.toggle('disabled', !hasName);
    UI.saveNameBtn.disabled = !hasName;

    const canEnter = AppState.saveNameConfirmed && hasName && hasId;
    UI.enterCallBtn.classList.toggle('disabled', !canEnter);
    UI.enterCallBtn.disabled = !canEnter;
}

function resetRoomUI() {
    clearFirebaseListeners();
    UI.enterCallBtn.innerHTML = enterCallOriginalSVG;
    UI.knockPopup.classList.add('removed');
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

function transitionToInCall() {
    UI.waitingRoom.classList.add('removed');
    UI.inCall.classList.remove('removed');
    UI.knockPopup.classList.add('removed');
    syncMediaUI();
}

function setVideoRenderState(videoElem, stream, enabled, flipHorizontally = false) {
    if (!videoElem) return;
    if (!stream || !enabled || !hasEnabledVideoTrack(stream)) {
        videoElem.srcObject = null;
        videoElem.classList.add('video-hidden');
        videoElem.style.transform = "";
    } else {
        if (videoElem.srcObject !== stream) videoElem.srcObject = stream;
        videoElem.classList.remove('video-hidden');
        videoElem.style.transform = flipHorizontally ? "scaleX(-1)" : "";
    }
}

async function fetchVideoDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput');
}

async function requestPermissions(type) {
    try {
        await navigator.mediaDevices.getUserMedia(type === 'camera' ? { video: true } : { audio: true });
        return true;
    } catch {
        return false;
    }
}

async function initMedia() {
    MediaState.videoDevices = await fetchVideoDevices();
    if (MediaState.videoDevices.length > 0) {
        AppState.isFrontCamera = isCurrentCameraFront(MediaState.videoDevices[0]);
    }

    try {
        if (MediaState.videoEnabled || MediaState.audioEnabled) {
            await acquireLocalStream();
        }
    } catch (e) {
        console.warn("Initial media access denied.", e);
        MediaState.videoEnabled = false;
        MediaState.audioEnabled = false;
    }
    updateOutgoingPreviews();
    syncMediaUI();
}

async function acquireLocalStream() {
    const targetDevice = MediaState.videoDevices[MediaState.currentDeviceIndex] || MediaState.videoDevices[0];
    const constraints = {
        video: MediaState.videoEnabled && targetDevice ? { deviceId: { exact: targetDevice.deviceId } } : false,
        audio: MediaState.audioEnabled
    };

    MediaState.outgoingStream = await navigator.mediaDevices.getUserMedia(constraints);

    if (RTCState.pc) {
        const transceivers = RTCState.pc.getTransceivers();
        const audioSender = transceivers.find(t => t.receiver.track.kind === 'audio')?.sender;
        const videoSender = transceivers.find(t => t.receiver.track.kind === 'video')?.sender;

        const newAudioTrack = MediaState.outgoingStream.getAudioTracks()[0];
        const newVideoTrack = MediaState.outgoingStream.getVideoTracks()[0];

        if (audioSender && newAudioTrack) audioSender.replaceTrack(newAudioTrack);
        if (videoSender && newVideoTrack) videoSender.replaceTrack(newVideoTrack);
    }
}

function stopLocalStream() {
    if (MediaState.outgoingStream) {
        MediaState.outgoingStream.getTracks().forEach(track => track.stop());
        MediaState.outgoingStream = null;
    }
}

async function cycleCamera() {
    if (MediaState.videoDevices.length <= 1) return;

    MediaState.currentDeviceIndex = (MediaState.currentDeviceIndex + 1) % MediaState.videoDevices.length;
    AppState.isFrontCamera = isCurrentCameraFront(MediaState.videoDevices[MediaState.currentDeviceIndex]);

    if (MediaState.videoEnabled) {
        stopLocalStream();
        await acquireLocalStream();
        updateOutgoingPreviews();
    }
}

function updateOutgoingPreviews() {
    UI.outgoingVideos.forEach(vid => {
        setVideoRenderState(vid, MediaState.outgoingStream, MediaState.videoEnabled, AppState.isFrontCamera);
    });
}

function syncMediaUI() {
    UI.videoToggles.forEach(btn => {
        btn.querySelector('#videoEnabled')?.classList.toggle('removed', !MediaState.videoEnabled);
        btn.querySelector('#videoDisabled')?.classList.toggle('removed', MediaState.videoEnabled);
    });

    UI.audioToggles.forEach(btn => {
        btn.querySelector('#audioEnabled')?.classList.toggle('removed', !MediaState.audioEnabled);
        btn.querySelector('#audioDisabled')?.classList.toggle('removed', MediaState.audioEnabled);
    });

    setVideoRenderState(UI.incomingVideo, MediaState.remoteStream, true, false);
    if (UI.incomingVideo) {
        UI.incomingVideo.muted = false;
        UI.incomingVideo.volume = 1;
    }
}

function setupWebRTC() {
    if (RTCState.pc && RTCState.pc.signalingState !== "closed") {
        RTCState.pc.close();
    }

    RTCState.pc = new RTCPeerConnection(servers);
    MediaState.remoteStream = new MediaStream();

    const audioTransceiver = RTCState.pc.addTransceiver('audio', { direction: 'sendrecv' });
    const videoTransceiver = RTCState.pc.addTransceiver('video', { direction: 'sendrecv' });

    if (MediaState.outgoingStream) {
        MediaState.outgoingStream.getAudioTracks().forEach(track => audioTransceiver.sender.replaceTrack(track));
        MediaState.outgoingStream.getVideoTracks().forEach(track => videoTransceiver.sender.replaceTrack(track));
    }

    RTCState.pc.ontrack = event => {
        MediaState.remoteStream.addTrack(event.track);
        syncMediaUI();
    };

    RTCState.pc.onconnectionstatechange = () => {
        if (["disconnected", "failed", "closed"].includes(RTCState.pc.connectionState)) {
            teardownCall();
        }
    };
}

function clearFirebaseListeners() {
    AppState.unsubs.forEach(unsub => unsub());
    AppState.unsubs = [];
}

async function executeCallAsCreator(roomId) {
    setupWebRTC();
    const callDoc = doc(db, 'rooms', roomId);

    RTCState.pc.onicecandidate = event => {
        if (event.candidate) addDoc(collection(callDoc, 'offerCandidates'), event.candidate.toJSON());
    };

    const offerDescription = await RTCState.pc.createOffer();
    await RTCState.pc.setLocalDescription(offerDescription);
    await updateDoc(callDoc, { offer: { sdp: offerDescription.sdp, type: offerDescription.type }, participants: 2 });

    const callUnsub = onSnapshot(callDoc, snapshot => {
        const data = snapshot.data();
        if (!RTCState.pc.currentRemoteDescription && data?.answer) {
            RTCState.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
        if (data?.hasEnded) teardownCall();
    });
    AppState.unsubs.push(callUnsub);

    const answerUnsub = onSnapshot(collection(callDoc, 'answerCandidates'), snapshot => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') RTCState.pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        });
    });
    AppState.unsubs.push(answerUnsub);

    transitionToInCall();
}

async function executeCallAsJoiner(roomId) {
    setupWebRTC();
    const callDoc = doc(db, 'rooms', roomId);

    RTCState.pc.onicecandidate = event => {
        if (event.candidate) addDoc(collection(callDoc, 'answerCandidates'), event.candidate.toJSON());
    };

    const callData = (await getDoc(callDoc)).data();
    await RTCState.pc.setRemoteDescription(new RTCSessionDescription(callData.offer));

    const answerDescription = await RTCState.pc.createAnswer();
    await RTCState.pc.setLocalDescription(answerDescription);
    await updateDoc(callDoc, { answer: { type: answerDescription.type, sdp: answerDescription.sdp }, participants: 2 });

    const callUnsub = onSnapshot(callDoc, snapshot => {
        if (snapshot.data()?.hasEnded) teardownCall();
    });
    AppState.unsubs.push(callUnsub);

    const offerUnsub = onSnapshot(collection(callDoc, 'offerCandidates'), snapshot => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') RTCState.pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        });
    });
    AppState.unsubs.push(offerUnsub);

    transitionToInCall();
}

async function teardownCall() {
    clearFirebaseListeners();

    if (AppState.currentRoomId) {
        try {
            await updateDoc(doc(db, 'rooms', AppState.currentRoomId), { hasEnded: true, participants: 0 });
        } catch (e) { console.warn("Failed to update room end state", e); }
    }

    if (RTCState.pc && RTCState.pc.signalingState !== "closed") {
        RTCState.pc.close();
    }

    MediaState.remoteStream.getTracks().forEach(track => track.stop());
    setVideoRenderState(UI.incomingVideo, null, false, false);

    UI.inCall.classList.add('removed');
    UI.waitingRoom.classList.remove('removed');
    resetRoomUI();
}

document.addEventListener('DOMContentLoaded', async () => {
    UI.nameInput?.addEventListener('input', updateFormValidation);
    UI.idInput?.addEventListener('input', updateFormValidation);

    UI.saveNameBtn?.addEventListener('click', () => {
        if (!UI.saveNameBtn.classList.contains('disabled')) {
            AppState.saveNameConfirmed = true;
            updateFormValidation();
        }
    });

    if (UI.roomSetting) {
        const options = UI.roomSetting.querySelectorAll('p');
        options.forEach(option => {
            option.addEventListener('click', () => {
                if (option.id === 'selectedSetting') return;
                options.forEach(opt => opt.id = '');
                option.id = 'selectedSetting';
                resetRoomUI();
            });
        });
    }

    UI.enterCallBtn.addEventListener('click', async () => {
        if (UI.enterCallBtn.classList.contains('disabled')) return;

        const myName = UI.nameInput.value.trim();
        AppState.currentRoomId = UI.idInput.value.trim();
        const isCreating = document.getElementById('selectedSetting').innerText.includes('Create');
        const roomDoc = doc(db, 'rooms', AppState.currentRoomId);

        addSpinnerToBtn(UI.enterCallBtn);

        if (isCreating) {
            await setDoc(roomDoc, { creator: myName, knock: null, knockStatus: 'idle', offer: null, answer: null, hasEnded: false, participants: 1 });

            const roomUnsub = onSnapshot(roomDoc, (docSnap) => {
                const data = docSnap.data();
                if (data?.knockStatus === 'pending' && data.knock) {
                    UI.knockMessage.innerText = `${data.knock} wants to join.`;
                    UI.knockPopup.classList.remove('removed');

                    UI.acceptKnockBtn.onclick = async () => {
                        await updateDoc(roomDoc, { knockStatus: 'accepted' });
                        executeCallAsCreator(AppState.currentRoomId);
                    };

                    UI.declineKnockBtn.onclick = async () => {
                        await updateDoc(roomDoc, { knockStatus: 'rejected', knock: null });
                        UI.knockPopup.classList.add('removed');
                    };
                }
            });
            AppState.unsubs.push(roomUnsub);
        } else {
            const docExists = await getDoc(roomDoc);
            if (!docExists.exists()) {
                alert("Room does not exist.");
                resetRoomUI();
                return;
            }

            await updateDoc(roomDoc, { knock: myName, knockStatus: 'pending' });

            const roomUnsub = onSnapshot(roomDoc, (docSnap) => {
                const data = docSnap.data();
                if (data?.knockStatus === 'accepted') {
                    clearFirebaseListeners();
                    executeCallAsJoiner(AppState.currentRoomId);
                } else if (data?.knockStatus === 'rejected') {
                    clearFirebaseListeners();
                    alert("Call declined by host.");
                    UI.enterCallBtn.innerHTML = "Join Failed";
                    setTimeout(() => resetRoomUI(), 2000);
                }
            });
            AppState.unsubs.push(roomUnsub);
        }
    });

    UI.videoToggles.forEach(btn => {
        btn.addEventListener('click', async () => {
            if (await requestPermissions('camera')) {
                MediaState.videoEnabled = !MediaState.videoEnabled;
                persistMediaStates();

                if (MediaState.videoEnabled) {
                    if (!MediaState.outgoingStream || !hasEnabledVideoTrack(MediaState.outgoingStream)) {
                        await acquireLocalStream();
                    } else {
                        MediaState.outgoingStream.getVideoTracks().forEach(t => t.enabled = true);
                    }
                } else {
                    if (MediaState.outgoingStream) {
                        MediaState.outgoingStream.getVideoTracks().forEach(t => t.stop());
                    }
                }
                updateOutgoingPreviews();
                syncMediaUI();
            }
        });
    });

    UI.audioToggles.forEach(btn => {
        btn.addEventListener('click', async () => {
            if (await requestPermissions('audio')) {
                MediaState.audioEnabled = !MediaState.audioEnabled;
                persistMediaStates();

                if (MediaState.audioEnabled) {
                    const hasLiveAudio = MediaState.outgoingStream &&
                        MediaState.outgoingStream.getAudioTracks().some(t => t.readyState === 'live');

                    if (!hasLiveAudio) {
                        await acquireLocalStream();
                    } else {
                        MediaState.outgoingStream.getAudioTracks().forEach(t => t.enabled = true);
                    }
                } else {
                    if (MediaState.outgoingStream) {
                        MediaState.outgoingStream.getAudioTracks().forEach(t => t.stop());
                    }
                }
                syncMediaUI();
            }
        });
    });

    UI.cameraRotates.forEach(btn => {
        btn.addEventListener('click', cycleCamera);
    });

    UI.endCallBtn.addEventListener('click', teardownCall);

    if (UI.fullscreenBtn) {
        UI.fullscreenBtn.addEventListener('click', async () => {
            try {
                const docEl = document.documentElement;
                if (!document.fullscreenElement) {
                    const elem = (UI.inCall && !UI.inCall.classList.contains('removed')) ? UI.inCall : document.body;
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

    await initMedia();
    updateFormValidation();
});