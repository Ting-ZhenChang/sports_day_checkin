// 相機掃 QR code（使用 jsQR 解碼）。QR 內容只有種子碼 / 領取碼字串。
// 手機相機需要 HTTPS 或 localhost 才能使用。
//
//   const scanner = createScanner({ video, onDecode(text), onError(message) });
//   scanner.start();   // 開相機並開始掃
//   scanner.resume();  // 處理完一筆後繼續掃下一筆
//   scanner.stop();    // 關相機

function createScanner({ video, onDecode, onError }) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let stream = null;
  let timer = null;
  let paused = false;

  function tick() {
    if (paused || !stream || video.readyState < 2 || !video.videoWidth) return;

    // 縮小影像加快解碼，手機上也順暢。
    const scale = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
    if (result && result.data) {
      paused = true; // 處理期間不重複觸發
      onDecode(result.data.trim());
    }
  }

  async function start() {
    if (stream) {
      paused = false;
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      onError("此瀏覽器無法使用相機，請改用手動輸入代碼。");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      video.srcObject = stream;
      await video.play();
      paused = false;
      timer = setInterval(tick, 180);
    } catch (err) {
      stream = null;
      const denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
      onError(denied ? "沒有相機權限，請允許使用相機，或改用手動輸入代碼。" : "找不到可用的相機，請改用手動輸入代碼。");
    }
  }

  function resume() {
    paused = false;
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
  }

  return { start, resume, stop };
}
