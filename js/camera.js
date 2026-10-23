// Kamera-Dialog mit "Onion Skin": das letzte Foto liegt halbtransparent über dem Livebild,
// damit jede Aufnahme gleich ausgerichtet werden kann.

const $ = (id) => document.getElementById(id);

/** Öffnet die Kamera; liefert den aufgenommenen JPEG-Blob oder null bei Abbruch. */
export function openCamera({ ghostBlob }) {
  const dialog = $('camera-dialog');
  const stage = $('cam-stage');
  const video = $('cam-video');
  const ghost = $('cam-ghost');
  const opacity = $('cam-ghost-opacity');
  let facing = localStorage.getItem('zr.facing') || 'environment';
  let stream = null;
  let ghostUrl = null;

  if (ghostBlob) {
    ghostUrl = URL.createObjectURL(ghostBlob);
    ghost.src = ghostUrl;
  } else {
    ghost.removeAttribute('src');
  }
  const applyOpacity = () => (ghost.style.opacity = opacity.value);
  opacity.oninput = applyOpacity;
  applyOpacity();

  const stop = () => stream?.getTracks().forEach((t) => t.stop());

  const start = async () => {
    stop();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    stage.classList.toggle('mirror', facing === 'user');
  };

  video.onloadedmetadata = () => {
    stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  };

  return new Promise((resolve, reject) => {
    const finish = (result, err) => {
      stop();
      video.srcObject = null;
      if (ghostUrl) URL.revokeObjectURL(ghostUrl);
      dialog.onclose = null;
      if (dialog.open) dialog.close();
      if (err) reject(err);
      else resolve(result);
    };

    $('cam-close').onclick = () => finish(null);
    dialog.onclose = () => finish(null);
    $('cam-switch').onclick = () => {
      facing = facing === 'user' ? 'environment' : 'user';
      localStorage.setItem('zr.facing', facing);
      start().catch((err) => console.error(err));
    };
    $('cam-shoot').onclick = () => {
      if (!video.videoWidth) return;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      canvas.toBlob((blob) => finish(blob), 'image/jpeg', 0.92);
    };

    if (!navigator.mediaDevices?.getUserMedia) {
      reject(new Error('Kein Kamerazugriff in diesem Browser (HTTPS nötig).'));
      return;
    }
    dialog.showModal();
    start().catch((err) => finish(null, err));
  });
}
