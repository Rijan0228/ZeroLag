
(() => {
  "use strict";

  // ==========================================
  // ZEROLAG — MAIN APPLICATION
  // ==========================================

  const $ = (id) => document.getElementById(id);

  const GIF_WORKER = "./gif.worker.js";

  const MAX_GIF_SECONDS = 30;
  const MAX_GIF_FRAMES = 600;
  const MAX_EXTRACTED_FRAMES = 300;

  const videoInput = $("videoInput");
  const videoPlayer = $("videoPlayer");
  const dropZone = $("dropZone");

  let videoObjectUrl = null;
  let gifObjectUrl = null;
  let frameObjectUrls = [];

  let extractedFrames = [];
  let isGeneratingGif = false;
  let isExtractingFrames = false;
  let toastTimeout = null;

  // ==========================================
  // GENERAL HELPERS
  // ==========================================

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "00:00";

    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60);

    return (
      String(minutes).padStart(2, "0") +
      ":" +
      String(remaining).padStart(2, "0")
    );
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function showToast(message, type = "info") {
    const toast = $("toast");

    if (!toast) return;

    toast.textContent = message;
    toast.className = `toast show ${type}`;

    clearTimeout(toastTimeout);

    toastTimeout = setTimeout(() => {
      toast.className = "toast";
    }, 3500);
  }

  function getNumber(id, fallback = 0) {
    const element = $(id);

    if (!element) return fallback;

    const value = Number(element.value);

    return Number.isFinite(value) ? value : fallback;
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    return canvas;
  }

  function drawVideo(canvas, width, height) {
    const context = canvas.getContext("2d");

    context.fillStyle = "#000000";
    context.fillRect(0, 0, width, height);

    context.drawImage(
      videoPlayer,
      0,
      0,
      width,
      height
    );

    return context;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function setButtonLoading(button, loading, normalText, loadingText) {
    if (!button) return;

    button.disabled = loading;
    button.textContent = loading ? loadingText : normalText;
  }

  // ==========================================
  // PROGRESS DISPLAY
  // ==========================================

  function updateProgress(type, percent, message) {
    const isGif = type === "gif";

    const area = $(
      isGif ? "gifProgressArea" : "frameProgressArea"
    );

    const bar = $(
      isGif ? "gifProgressBar" : "frameProgressBar"
    );

    const label = $(
      isGif ? "gifProgressText" : "frameProgressText"
    );

    const percentage = $(
      isGif ? "gifProgressPercent" : "frameProgressPercent"
    );

    if (area) area.hidden = false;

    if (bar) {
      bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }

    if (label) label.textContent = message;

    if (percentage) {
      percentage.textContent = `${Math.round(percent)}%`;
    }
  }

  function hideProgress(type) {
    const area = $(
      type === "gif" ? "gifProgressArea" : "frameProgressArea"
    );

    if (area) area.hidden = true;
  }

  // ==========================================
  // VIDEO UPLOAD
  // ==========================================

  function loadVideo(file) {
    if (!file) return;

    if (!file.type.startsWith("video/")) {
      showToast("Please select a valid video file.", "error");
      return;
    }

    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl);
    }

    videoObjectUrl = URL.createObjectURL(file);

    videoPlayer.pause();
    videoPlayer.src = videoObjectUrl;
    videoPlayer.load();

    $("fileName").textContent = file.name;
    $("fileDetails").textContent = formatFileSize(file.size);

    $("uploadContent").hidden = true;
    $("uploadLoaded").hidden = false;

    $("editorLayout").hidden = false;
    $("gifSettings").hidden = false;

    $("gifResult").hidden = true;
    $("extractedPanel").hidden = true;

    extractedFrames = [];
    clearFramePreviews();

    if (gifObjectUrl) {
      URL.revokeObjectURL(gifObjectUrl);
      gifObjectUrl = null;
    }

    $("videoDuration").textContent = "Loading...";
    $("videoResolution").textContent = "Loading...";

    showToast("Video selected. Preparing preview...", "success");
  }

  videoInput.addEventListener("change", (event) => {
    loadVideo(event.target.files[0]);
  });

  $("browseButton").addEventListener("click", () => {
    videoInput.click();
  });

  $("changeVideoButton").addEventListener("click", () => {
    videoInput.click();
  });

  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragging");
  });

  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();

    dropZone.classList.remove("dragging");

    const file = event.dataTransfer.files[0];

    loadVideo(file);

    // Allow selecting the same file again later.
    videoInput.value = "";
  });

  videoPlayer.addEventListener("loadedmetadata", () => {
    const duration = videoPlayer.duration;

    if (!Number.isFinite(duration)) {
      showToast("This video has an unsupported duration.", "error");
      return;
    }

    $("videoDuration").textContent = formatTime(duration);

    $("videoResolution").textContent =
      `${videoPlayer.videoWidth} × ${videoPlayer.videoHeight}`;

    $("startTime").value = "0";
    $("endTime").value = duration.toFixed(2);

    $("startTime").max = duration;
    $("endTime").max = duration;

    showToast("Video is ready!", "success");
  });

  videoPlayer.addEventListener("error", () => {
    showToast(
      "Your browser could not decode this video format.",
      "error"
    );
  });

  videoPlayer.addEventListener("timeupdate", () => {
    $("currentTime").textContent = formatTime(
      videoPlayer.currentTime
    );
  });

  // ==========================================
  // VIDEO SEEKING
  // ==========================================

  function seekVideo(time) {
    return new Promise((resolve, reject) => {
      if (!Number.isFinite(time) || !videoPlayer.duration) {
        reject(new Error("Invalid video timestamp."));
        return;
      }

      const target = Math.max(
        0,
        Math.min(time, videoPlayer.duration - 0.01)
      );

      if (Math.abs(videoPlayer.currentTime - target) < 0.015) {
        resolve();
        return;
      }

      let timeout;

      function cleanup() {
        clearTimeout(timeout);
        videoPlayer.removeEventListener("seeked", onSeeked);
        videoPlayer.removeEventListener("error", onError);
      }

      function onSeeked() {
        cleanup();
        resolve();
      }

      function onError() {
        cleanup();
        reject(new Error("Unable to seek within this video."));
      }

      videoPlayer.addEventListener("seeked", onSeeked, {
        once: true
      });

      videoPlayer.addEventListener("error", onError, {
        once: true
      });

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Video seeking timed out."));
      }, 10000);

      videoPlayer.currentTime = target;
    });
  }

  // ==========================================
  // TRIM CONTROLS
  // ==========================================

  function getTrimRange() {
    const start = getNumber("startTime", 0);
    const end = getNumber("endTime", videoPlayer.duration);

    if (start < 0 || end <= start || end > videoPlayer.duration) {
      throw new Error("Please enter a valid start and end time.");
    }

    return { start, end };
  }

  $("previewTrimButton").addEventListener("click", async () => {
    if (!videoPlayer.duration) {
      showToast("Upload a video first.", "error");
      return;
    }

    try {
      const { start, end } = getTrimRange();

      await seekVideo(start);

      await videoPlayer.play();

      const stopAtEnd = () => {
        if (videoPlayer.currentTime >= end) {
          videoPlayer.pause();
          videoPlayer.removeEventListener("timeupdate", stopAtEnd);
        }
      };

      videoPlayer.addEventListener("timeupdate", stopAtEnd);

      showToast("Previewing your selected section.", "success");

    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("resetTrimButton").addEventListener("click", () => {
    if (!videoPlayer.duration) return;

    $("startTime").value = "0";
    $("endTime").value = videoPlayer.duration.toFixed(2);

    showToast("Trim selection reset.");
  });

  // ==========================================
  // GIF CREATION
  // ==========================================

  async function createGif() {
    if (isGeneratingGif) return;

    if (!videoObjectUrl || !videoPlayer.duration) {
      showToast("Upload a video first.", "error");
      return;
    }

    if (typeof GIF === "undefined") {
      showToast(
        "GIF library failed to load. Check your internet connection.",
        "error"
      );
      return;
    }

    let encoder = null;

    const button = $("generateGif");

    try {
      const { start, end } = getTrimRange();

      const duration = end - start;

      if (duration > MAX_GIF_SECONDS) {
        throw new Error(
          `GIF duration cannot exceed ${MAX_GIF_SECONDS} seconds.`
        );
      }

      const fps = getNumber("gifFps", 12);
      const quality = getNumber("gifQuality", 10);
      const requestedWidth = getNumber("gifWidth", 480);
      const loopValue = getNumber("gifLoop", 0);

      const originalWidth = videoPlayer.videoWidth;
      const originalHeight = videoPlayer.videoHeight;

      if (!originalWidth || !originalHeight) {
        throw new Error("The video is not ready yet.");
      }

      const width = Math.min(requestedWidth, originalWidth);

      const height = Math.max(
        1,
        Math.round(width * originalHeight / originalWidth)
      );

      const frameCount = Math.ceil(duration * fps);

      if (frameCount > MAX_GIF_FRAMES) {
        throw new Error(
          "Too many GIF frames. Reduce the FPS or trim duration."
        );
      }

      const canvas = makeCanvas(width, height);

      const frameDelay = Math.max(
        20,
        Math.round(1000 / fps)
      );

      // GIF.js repeat: 0 = infinite, -1 = no repeat.
      const repeat = loopValue === 1 ? -1 : 0;

      isGeneratingGif = true;

      button.disabled = true;
      button.textContent = "Creating your GIF...";

      videoPlayer.pause();

      $("gifResult").hidden = true;

      updateProgress("gif", 0, "Preparing GIF encoder...");

      encoder = new GIF({
        workers: 2,
        quality: quality,
        width: width,
        height: height,
        repeat: repeat,
        background: "#000000",
        workerScript: GIF_WORKER
      });

      // Add frames to the GIF encoder.
      for (let i = 0; i < frameCount; i++) {
        const timestamp = Math.min(
          start + i / fps,
          end - 0.001
        );

        await seekVideo(timestamp);

        drawVideo(canvas, width, height);

        encoder.addFrame(canvas, {
          copy: true,
          delay: frameDelay
        });

        const percent = ((i + 1) / frameCount) * 75;

        updateProgress(
          "gif",
          percent,
          `Preparing frames: ${i + 1} of ${frameCount}`
        );
      }

      updateProgress("gif", 78, "Rendering your GIF...");

      // Render the final GIF.
      const gifBlob = await new Promise((resolve, reject) => {
        let settled = false;

        encoder.on("progress", (progress) => {
          updateProgress(
            "gif",
            78 + progress * 22,
            `Rendering GIF: ${Math.round(progress * 100)}%`
          );
        });

        encoder.on("finished", (blob) => {
          if (settled) return;
          settled = true;
          resolve(blob);
        });

        encoder.on("abort", () => {
          if (settled) return;
          settled = true;
          reject(new Error("GIF rendering was cancelled."));
        });

        try {
          encoder.render();
        } catch (error) {
          reject(error);
        }
      });

      if (!gifBlob || gifBlob.size === 0) {
        throw new Error("The GIF was empty. Please try again.");
      }

      if (gifObjectUrl) {
        URL.revokeObjectURL(gifObjectUrl);
      }

      gifObjectUrl = URL.createObjectURL(gifBlob);

      $("gifPreview").src = gifObjectUrl;

      $("gifFileSize").textContent =
        `File size: ${formatFileSize(gifBlob.size)}`;

      const downloadLink = $("downloadGif");

      downloadLink.href = gifObjectUrl;
      downloadLink.download = "zerolag-animation.gif";

      $("gifResult").hidden = false;

      updateProgress("gif", 100, "GIF created successfully!");

      showToast("Your GIF is ready to download!", "success");

    } catch (error) {
      console.error("ZeroLag GIF error:", error);

      showToast(error.message || "GIF creation failed.", "error");

    } finally {
      isGeneratingGif = false;

      button.disabled = false;
      button.innerHTML =
        '<span class="button-icon">✧</span> Create My GIF <span class="button-arrow">→</span>';

      setTimeout(() => hideProgress("gif"), 1200);
    }
  }

  $("generateGif").addEventListener("click", createGif);

  // ==========================================
  // IMAGE FORMAT
  // ==========================================

  function getImageMimeType() {
    return $("imageFormat").value === "jpg"
      ? "image/jpeg"
      : "image/png";
  }

  function getImageExtension() {
    return $("imageFormat").value === "jpg"
      ? "jpg"
      : "png";
  }

  function canvasToBlob(canvas, type, quality = 0.95) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Could not create the image."));
        }
      }, type, quality);
    });
  }

  // ==========================================
  // CAPTURE CURRENT FRAME
  // ==========================================

  async function captureCurrentFrame() {
    if (!videoObjectUrl || !videoPlayer.videoWidth) {
      showToast("Upload a video first.", "error");
      return;
    }

    try {
      const width = videoPlayer.videoWidth;
      const height = videoPlayer.videoHeight;

      const canvas = makeCanvas(width, height);

      drawVideo(canvas, width, height);

      const blob = await canvasToBlob(
        canvas,
        getImageMimeType()
      );

      const filename =
        `zerolag-frame-${Date.now()}.${getImageExtension()}`;

      downloadBlob(blob, filename);

      showToast("Frame downloaded successfully!", "success");

    } catch (error) {
      console.error(error);
      showToast(error.message, "error");
    }
  }

  $("captureFrame").addEventListener(
    "click",
    captureCurrentFrame
  );

  // ==========================================
  // BATCH FRAME EXTRACTION
  // ==========================================

  function clearFramePreviews() {
    frameObjectUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });

    frameObjectUrls = [];

    $("frameResults").innerHTML = "";
  }

  async function extractFrames() {
    if (isExtractingFrames) return;

    if (!videoObjectUrl || !videoPlayer.videoWidth) {
      showToast("Upload a video first.", "error");
      return;
    }

    const button = $("extractFrames");

    try {
      const { start, end } = getTrimRange();

      const interval = getNumber("frameInterval", 1);

      if (interval <= 0) {
        throw new Error("Choose a valid extraction interval.");
      }

      const totalFrames =
        Math.floor((end - start) / interval) + 1;

      if (totalFrames > MAX_EXTRACTED_FRAMES) {
        throw new Error(
          `Too many frames. Maximum is ${MAX_EXTRACTED_FRAMES}. Increase the interval.`
        );
      }

      isExtractingFrames = true;

      button.disabled = true;
      button.textContent = "Extracting...";

      videoPlayer.pause();

      clearFramePreviews();
      extractedFrames = [];

      $("extractedPanel").hidden = true;

      const width = videoPlayer.videoWidth;
      const height = videoPlayer.videoHeight;

      const canvas = makeCanvas(width, height);

      const mimeType = getImageMimeType();
      const extension = getImageExtension();

      for (let i = 0; i < totalFrames; i++) {
        const timestamp = Math.min(
          start + i * interval,
          end - 0.001
        );

        await seekVideo(timestamp);

        drawVideo(canvas, width, height);

        const blob = await canvasToBlob(
          canvas,
          mimeType
        );

        const filename =
          `frame-${String(i + 1).padStart(4, "0")}.${extension}`;

        extractedFrames.push({
          blob,
          filename,
          timestamp
        });

        const percent =
          ((i + 1) / totalFrames) * 100;

        updateProgress(
          "frames",
          percent,
          `Extracting frames: ${i + 1} of ${totalFrames}`
        );
      }

      displayExtractedFrames();

      $("frameCount").textContent =
        `${extractedFrames.length} frames extracted successfully.`;

      $("extractedPanel").hidden = false;

      showToast(
        `${extractedFrames.length} frames extracted!`,
        "success"
      );

    } catch (error) {
      console.error("Frame extraction error:", error);
      showToast(error.message, "error");

    } finally {
      isExtractingFrames = false;

      button.disabled = false;
      button.innerHTML = 'Extract Frames <span>→</span>';

      setTimeout(() => hideProgress("frames"), 1200);
    }
  }

  function displayExtractedFrames() {
    const container = $("frameResults");

    container.innerHTML = "";

    extractedFrames.forEach((frame) => {
      const imageUrl = URL.createObjectURL(frame.blob);

      frameObjectUrls.push(imageUrl);

      const item = document.createElement("div");
      item.className = "frame-item";

      const image = document.createElement("img");

      image.src = imageUrl;
      image.alt = frame.filename;
      image.loading = "lazy";

      const caption = document.createElement("p");

      caption.textContent =
        `${frame.filename} · ${formatTime(frame.timestamp)}`;

      item.append(image, caption);

      container.appendChild(item);
    });
  }

  $("extractFrames").addEventListener(
    "click",
    extractFrames
  );

  // ==========================================
  // DOWNLOAD EXTRACTED FRAMES AS ZIP
  // ==========================================

  async function downloadZip() {
    const button = $("downloadZip");

    if (!extractedFrames.length) {
      showToast("Extract frames first.", "error");
      return;
    }

    if (typeof JSZip === "undefined") {
      showToast(
        "ZIP library failed to load. Refresh the page and try again.",
        "error"
      );
      return;
    }

    button.disabled = true;
    button.textContent = "Creating ZIP...";

    try {
      const zip = new JSZip();

      extractedFrames.forEach((frame) => {
        zip.file(frame.filename, frame.blob);
      });

      const zipBlob = await zip.generateAsync(
        { type: "blob" },
        (metadata) => {
          updateProgress(
            "frames",
            metadata.percent,
            `Creating ZIP: ${Math.round(metadata.percent)}%`
          );
        }
      );

      downloadBlob(zipBlob, "zerolag-extracted-frames.zip");

      showToast("Your ZIP file is ready!", "success");

    } catch (error) {
      console.error(error);
      showToast("Could not create the ZIP file.", "error");

    } finally {
      button.disabled = false;
      button.textContent = "Download ZIP ↓";

      setTimeout(() => hideProgress("frames"), 1200);
    }
  }

  $("downloadZip").addEventListener("click", downloadZip);

  // ==========================================
  // FOOTER YEAR
  // ==========================================

  $("year").textContent = new Date().getFullYear();

  // ==========================================
  // CLEANUP
  // ==========================================

  window.addEventListener("beforeunload", () => {
    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl);
    }

    if (gifObjectUrl) {
      URL.revokeObjectURL(gifObjectUrl);
    }

    clearFramePreviews();
  });

  console.log("ZeroLag Studio initialized.");
})();
