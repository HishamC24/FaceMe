let saveNameConfirmed = false;

function updateButtons() {
    const nameInput = document.getElementById('nameInput');
    const idInput = document.getElementById('idInput');
    const saveNameBtn = document.getElementById('saveName');
    const enterCallBtn = document.getElementById('enterCall');

    if (nameInput.value.trim().length >= 1) {
        saveNameBtn.classList.remove('disabled');
        saveNameBtn.disabled = false;
    } else {
        saveNameBtn.classList.add('disabled');
        saveNameBtn.disabled = true;
    }

    if (
        saveNameConfirmed &&
        nameInput.value.trim().length >= 1 &&
        idInput.value.trim().length >= 1
    ) {
        enterCallBtn.classList.remove('disabled');
        enterCallBtn.disabled = false;
    } else {
        enterCallBtn.classList.add('disabled');
        enterCallBtn.disabled = true;
    }
}

async function ensureCameraPermission() {
    let granted = false;
    try {
        if (navigator.permissions) {
            let status = await navigator.permissions.query({ name: 'camera' });
            if (status.state === 'granted') return true;
        }
    } catch (e) { }
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
            await navigator.mediaDevices.getUserMedia({ video: true });
            granted = true;
        } catch (e) {
            granted = false;
        }
    }
    return granted;
}

async function ensureMicPermission() {
    let granted = false;
    try {
        if (navigator.permissions) {
            let status = await navigator.permissions.query({ name: 'microphone' });
            if (status.state === 'granted') return true;
        }
    } catch (e) { }
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            granted = true;
        } catch (e) {
            granted = false;
        }
    }
    return granted;
}

let outgoingVideoStream = null;
let videoInputDevices = [];
let currentVideoDeviceIndex = 0;
let videoEnabled = true;
let audioEnabled = true;

async function getVideoInputDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput');
}

function updateAllOutgoingVideoPreviews() {
    document.querySelectorAll('video.outgoingVideo').forEach(function (vid) {
        vid.srcObject = outgoingVideoStream && videoEnabled ? outgoingVideoStream : null;
    });
}

function syncAllVideoToggles() {
    document.querySelectorAll('.videoEnabledToggle').forEach(btn => {
        const videoEnabledIcon = btn.querySelector('#videoEnabled') || document.getElementById('videoEnabled');
        const videoDisabledIcon = btn.querySelector('#videoDisabled') || document.getElementById('videoDisabled');
        if (videoEnabledIcon) {
            if (videoEnabled) videoEnabledIcon.classList.remove('removed');
            else videoEnabledIcon.classList.add('removed');
        }
        if (videoDisabledIcon) {
            if (!videoEnabled) videoDisabledIcon.classList.remove('removed');
            else videoDisabledIcon.classList.add('removed');
        }
    });
}

function syncAllAudioToggles() {
    document.querySelectorAll('.audioEnabledToggle').forEach(btn => {
        const audioEnabledIcon = btn.querySelector('#audioEnabled') || document.getElementById('audioEnabled');
        const audioDisabledIcon = btn.querySelector('#audioDisabled') || document.getElementById('audioDisabled');
        if (audioEnabledIcon) {
            if (audioEnabled) audioEnabledIcon.classList.remove('removed');
            else audioEnabledIcon.classList.add('removed');
        }
        if (audioDisabledIcon) {
            if (!audioEnabled) audioDisabledIcon.classList.remove('removed');
            else audioDisabledIcon.classList.add('removed');
        }
    });
}

async function switchToNextCamera() {
    videoInputDevices = await getVideoInputDevices();
    if (videoInputDevices.length === 0) return;
    currentVideoDeviceIndex = (currentVideoDeviceIndex + 1) % videoInputDevices.length;
    const nextDevice = videoInputDevices[currentVideoDeviceIndex];
    if (outgoingVideoStream) {
        outgoingVideoStream.getTracks().forEach(track => track.stop());
        outgoingVideoStream = null;
    }
    try {
        outgoingVideoStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: nextDevice.deviceId } }
        });
        updateAllOutgoingVideoPreviews();
    } catch (err) {
    }
}

async function tryInitializeVideoPreview() {
    if (!videoEnabled) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
        videoInputDevices = await getVideoInputDevices();
        currentVideoDeviceIndex = 0;
        if (videoInputDevices.length > 0) {
            outgoingVideoStream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: videoInputDevices[currentVideoDeviceIndex].deviceId } }
            });
        } else {
            outgoingVideoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        updateAllOutgoingVideoPreviews();
    } catch (err) {
        outgoingVideoStream = null;
        updateAllOutgoingVideoPreviews();
        videoEnabled = false;
        syncAllVideoToggles();
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const nameInput = document.getElementById('nameInput');
    const idInput = document.getElementById('idInput');
    const saveNameBtn = document.getElementById('saveName');
    const enterCallBtn = document.getElementById('enterCall');

    nameInput && nameInput.addEventListener('input', updateButtons);
    idInput && idInput.addEventListener('input', updateButtons);

    if (saveNameBtn) {
        saveNameBtn.addEventListener('click', function () {
            if (!this.classList.contains('disabled')) {
                saveNameConfirmed = true;
                updateButtons();
            }
        });
    }

    updateButtons();

    syncAllVideoToggles();
    syncAllAudioToggles();

    const roomSetting = document.getElementById('roomSetting');
    if (roomSetting) {
        const options = roomSetting.querySelectorAll('p');
        options.forEach(function (option) {
            option.addEventListener('click', function () {
                options.forEach(function (opt) {
                    opt.id = '';
                });
                option.id = 'selectedSetting';
            });
        });
    }

    tryInitializeVideoPreview();

    document.querySelectorAll('.videoEnabledToggle').forEach((videoToggle) => {
        videoToggle.addEventListener('click', async function () {
            const allowed = await ensureCameraPermission();
            if (!allowed) return;
            videoEnabled = !videoEnabled;
            syncAllVideoToggles();

            if (videoEnabled) {
                try {
                    if (!outgoingVideoStream) {
                        videoInputDevices = await getVideoInputDevices();
                        currentVideoDeviceIndex = 0;
                        if (videoInputDevices.length > 0) {
                            outgoingVideoStream = await navigator.mediaDevices.getUserMedia({
                                video: { deviceId: { exact: videoInputDevices[currentVideoDeviceIndex].deviceId } }
                            });
                        } else {
                            outgoingVideoStream = await navigator.mediaDevices.getUserMedia({ video: true });
                        }
                    }
                    updateAllOutgoingVideoPreviews();
                } catch (err) {
                }
            } else {
                if (outgoingVideoStream) {
                    outgoingVideoStream.getTracks().forEach(track => track.stop());
                    outgoingVideoStream = null;
                }
                updateAllOutgoingVideoPreviews();
            }
        });
    });

    document.querySelectorAll('.audioEnabledToggle').forEach((audioToggle) => {
        audioToggle.addEventListener('click', async function () {
            const allowed = await ensureMicPermission();
            if (!allowed) return;
            audioEnabled = !audioEnabled;
            syncAllAudioToggles();
        });
    });

    document.querySelectorAll('.cameraRotate').forEach((cameraRotateBtn) => {
        cameraRotateBtn.addEventListener('click', async function () {
            const allowed = await ensureCameraPermission();
            if (!allowed) return;
            if (videoEnabled) {
                await switchToNextCamera();
            }
        });
    });

    updateAllOutgoingVideoPreviews();
});