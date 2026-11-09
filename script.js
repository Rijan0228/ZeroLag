
(() => {
  "use strict";

  // ==========================================
  // ZEROLAG STUDIO
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

  let cancelGifRequested = false;
  let cancelFramesRequested = false;

  let activeEncoder = null;
  let toastTimeout = null;

  let trimPreviewHandler = null;


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
    if (!Number.isFinite(bytes) || bytes < 0) {
      return "--";
    }

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
    const context = canvas.getContext("2d", {
      alpha: false
    });

    if (!context) {
      throw new Error("Your browser could not create a canvas.");
    }

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

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 5000);
  }


  function setButtonLoading(button, loading, normalText, loadingText) {
    if (!button) return;

    button.disabled = loading;
    button.textContent = loading ? loadingText : normalText;
  }


  function isVideoReady() {
    return Boolean(
      videoObjectUrl &&
      videoPlayer.videoWidth &&
      Number.isFinite(videoPlayer.duration)
    );
  }


  // ==========================================
  // PROGRESS
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

    const safePercent = Math.max(
      0,
      Math.min(100, percent)
    );

    if (area) area.hidden = false;

    if (bar) {
      bar.style.width = `${safePercent}%`;
    }

    if (label) {
      label.textContent = message;
    }

    if (percentage) {
      percentage.textContent = `${Math.round(safePercent)}%`;
    }
  }


  function hideProgress(type) {
    const area = $(
      type === "gif" ? "gifProgressArea" : "frameProgressArea"
    );

    if (area) area.hidden = true;
  }


  // ==========================================
  // CLEANUP
  // ==========================================

  function clearGifResult() {
    $("gifResult").hidden = true;

    $("gifPreview").removeAttribute("src");

    $("downloadGif").removeAttribute("href");

    if (gifObjectUrl) {
      URL.revokeObjectURL(gifObjectUrl);
      gifObjectUrl = null;
    }
  }


  function clearFramePreviews() {
    frameObjectUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });

    frameObjectUrls = [];

    $("frameResults").innerHTML = "";
  }


  function clearFrameResults() {
    clearFramePreviews();

    extractedFrames = [];

    $("extractedPanel").hidden = true;
    $("frameCount").textContent = "0 frames extracted.";
  }


  function resetResults() {
    clearGifResult();
    clearFrameResults();

    hideProgress("gif");
    hideProgress("frames");
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

    if (isGeneratingGif || isExtractingFrames) {
      showToast("Wait for the current operation to finish first.", "error");
      return;
    }

    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl);
    }

    resetResults();

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

    $("videoDuration").textContent = "Loading...";
    $("videoResolution").textContent = "Loading...";

    $("gifEstimate").textContent = "Calculating...";

    showToast("Video selected. Preparing preview...", "success");
  }


  videoInput.addEventListener("change", (event) => {
    loadVideo(event.target.files[0]);

    // Allows selecting the same file again.
    event.target.value = "";
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


  dropZone.addEventListener("dragleave", (event) => {
    if (!dropZone.contains(event.relatedTarget)) {
      dropZone.classList.remove("dragging");
    }
  });


  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();

    dropZone.classList.remove("dragging");

    const file = event.dataTransfer.files[0];

    loadVideo(file);
  });


  videoPlayer.addEventListener("loadedmetadata", () => {
    const duration = videoPlayer.duration;

    if (!Number.isFinite(duration) || duration <= 0) {
      showToast("This video has an unsupported duration.", "error");
      return;
    }

    $("videoDuration").textContent = formatTime(duration);

    $("videoResolution").textContent =
      `${videoPlayer.videoWidth} × ${videoPlayer.videoHeight}`;

    $("startTime").value = "0";
    $("endTime").value = duration.toFixed(2);

    $("startTime").min = "0";
    $("startTime").max = duration;

    $("endTime").min = "0";
    $("endTime").max = duration;

    updateGifEstimate();

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
      if (
        !Number.isFinite(time) ||
        !Number.isFinite(videoPlayer.duration)
      ) {
        reject(new Error("Invalid video timestamp."));
        return;
      }

      const target = Math.max(
        0,
        Math.min(time, videoPlayer.duration - 0.01)
      );

      if (
        Math.abs(videoPlayer.currentTime - target) < 0.015 &&
        !videoPlayer.seeking
      ) {
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

    if (!isVideoReady()) {
      throw new Error("Upload a video first.");
    }

    if (
      start < 0 ||
      end <= start ||
      end > videoPlayer.duration
    ) {
      throw new Error("Please enter a valid start and end time.");
    }

    return { start, end };
  }


  function stopTrimPreview() {
    if (trimPreviewHandler) {
      videoPlayer.removeEventListener(
        "timeupdate",
        trimPreviewHandler
      );

      trimPreviewHandler = null;
    }
  }


  $("previewTrimButton").addEventListener("click", async () => {
    if (!isVideoReady()) {
      showToast("Upload a video first.", "error");
      return;
    }

    try {
      const { start, end } = getTrimRange();

      stopTrimPreview();

      await seekVideo(start);

      await videoPlayer.play();

      trimPreviewHandler = () => {
        if (videoPlayer.currentTime >= end) {
          videoPlayer.pause();
          stopTrimPreview();
        }
      };

      videoPlayer.addEventListener(
        "timeupdate",
        trimPreviewHandler
      );

      showToast("Previewing your selected section.", "success");

    } catch (error) {
      showToast(error.message, "error");
    }
  });


  $("resetTrimButton").addEventListener("click", () => {
    if (!isVideoReady()) return;

    $("startTime").value = "0";
    $("endTime").value = videoPlayer.duration.toFixed(2);

    updateGifEstimate();

    showToast("Trim selection reset.");
  });


  $("startTime").addEventListener("input", updateGifEstimate);
  $("endTime").addEventListener("input", updateGifEstimate);


  // ==========================================
  // GIF SIZE ESTIMATOR
  // ==========================================

  function updateGifEstimate() {
    if (!isVideoReady()) return;

    try {
      const { start, end } = getTrimRange();

      const duration = end - start;

      const fps = getNumber("gifFps", 12);
      const requestedWidth = getNumber("gifWidth", 480);

      const width = Math.min(
        requestedWidth,
        videoPlayer.videoWidth
      );

      const height = Math.max(
        1,
        Math.round(
          width * videoPlayer.videoHeight / videoPlayer.videoWidth
        )
      );

      const frames = Math.ceil(duration * fps);

      // This is only a rough estimate. Actual GIF size varies
      // significantly with image complexity and movement.
      const rawBytes = width * height * frames;

      const estimatedBytes = rawBytes * 0.12;

      $("gifEstimate").textContent =
        `${formatFileSize(estimatedBytes)} · ${frames} frames`;

    } catch {
      $("gifEstimate").textContent =
        "Check your trim selection";
    }
  }


  ["gifWidth", "gifFps", "gifQuality"].forEach((id) => {
    $(id).addEventListener("change", updateGifEstimate);
  });


  // ==========================================
  // GIF CREATION
  // ==========================================

  async function createGif() {
    if (isGeneratingGif) return;

    if (!isVideoReady()) {
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

    const button = $("generateGif");

    let encoder = null;

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

      const width = Math.min(
        requestedWidth,
        originalWidth
      );

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

      // GIF.js repeat: 0 = infinite, -1 = play once.
      const repeat = loopValue === 1 ? -1 : 0;

      isGeneratingGif = true;
      cancelGifRequested = false;

      button.disabled = true;
      button.textContent = "Creating GIF...";

      $("cancelGif").hidden = false;

      videoPlayer.pause();
      stopTrimPreview();

      clearGifResult();

      updateProgress("gif", 0, "Preparing GIF encoder...");

      encoder = new GIF({
        workers: 2,
        quality,
        width,
        height,
        repeat,
        background: "#000000",
        workerScript: GIF_WORKER
      });

      activeEncoder = encoder;


      // Prepare frames.
      for (let i = 0; i < frameCount; i++) {

        if (cancelGifRequested) {
          throw new Error("GIF creation cancelled.");
        }

        const timestamp = Math.min(
          start + i / fps,
          end - 0.001
        );

        await seekVideo(timestamp);

        if (cancelGifRequested) {
          throw new Error("GIF creation cancelled.");
        }

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

        // Give the browser a chance to update the interface.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }


      if (cancelGifRequested) {
        throw new Error("GIF creation cancelled.");
      }

      updateProgress("gif", 78, "Rendering your GIF...");


      // Render the GIF.
      const gifBlob = await new Promise((resolve, reject) => {
        let settled = false;

        function finish(callback, value) {
          if (settled) return;

          settled = true;

          callback(value);
        }

        encoder.on("progress", (progress) => {
          updateProgress(
            "gif",
            78 + progress * 22,
            `Rendering GIF: ${Math.round(progress * 100)}%`
          );
        });

        encoder.on("finished", (blob) => {
          finish(resolve, blob);
        });

        encoder.on("abort", () => {
          finish(
            reject,
            new Error("GIF rendering was cancelled.")
          );
        });

        try {
          encoder.render();
        } catch (error) {
          finish(reject, error);
        }
      });


      if (cancelGifRequested) {
        throw new Error("GIF creation cancelled.");
      }

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

      $("gifDimensions").textContent =
        `Dimensions: ${width} × ${height}`;

      const downloadLink = $("downloadGif");

      downloadLink.href = gifObjectUrl;
      downloadLink.download = "zerolag-animation.gif";

      $("gifResult").hidden = false;

      updateProgress("gif", 100, "GIF created successfully!");

      showToast("Your GIF is ready to download!", "success");

    } catch (error) {
      console.error("ZeroLag GIF error:", error);

      if (error.message === "GIF creation cancelled.") {
        showToast("GIF creation cancelled.");
      } else {
        showToast(error.message || "GIF creation failed.", "error");
      }

    } finally {
      isGeneratingGif = false;
      cancelGifRequested = false;
      activeEncoder = null;

      button.disabled = false;
      button.innerHTML =
        '<span class="button-icon">✳</span> Create GIF <span class="button-arrow">→</span>';

      $("cancelGif").hidden = true;

      setTimeout(() => hideProgress("gif"), 1500);
    }
  }


  $("generateGif").addEventListener("click", createGif);


  $("cancelGif").addEventListener("click", () => {
    if (!isGeneratingGif) return;

    cancelGifRequested = true;

    // GIF.js supports aborting an active render.
    if (activeEncoder && typeof activeEncoder.abort === "function") {
      try {
        activeEncoder.abort();
      } catch (error) {
        console.warn("Could not abort GIF encoder:", error);
      }
    }

    showToast("Cancelling GIF creation...");
  });


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
    if (!isVideoReady()) {
      showToast("Upload a video first.", "error");
      return;
    }

    try {
      if (videoPlayer.readyState < 2) {
        throw new Error("Wait for the video to load.");
      }

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

  async function extractFrames() {
    if (isExtractingFrames) return;

    if (!isVideoReady()) {
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
      cancelFramesRequested = false;

      button.disabled = true;
      button.textContent = "Extracting...";

      $("cancelFrames").hidden = false;

      videoPlayer.pause();
      stopTrimPreview();

      clearFrameResults();

      const width = videoPlayer.videoWidth;
      const height = videoPlayer.videoHeight;

      const canvas = makeCanvas(width, height);

      const mimeType = getImageMimeType();
      const extension = getImageExtension();


      for (let i = 0; i < totalFrames; i++) {

        if (cancelFramesRequested) {
          throw new Error("Frame extraction cancelled.");
        }

        const timestamp = Math.min(
          start + i * interval,
          end - 0.001
        );

        await seekVideo(timestamp);

        if (cancelFramesRequested) {
          throw new Error("Frame extraction cancelled.");
        }

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

        await new Promise((resolve) => setTimeout(resolve, 0));
      }


      if (cancelFramesRequested) {
        throw new Error("Frame extraction cancelled.");
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

      if (error.message === "Frame extraction cancelled.") {
        clearFrameResults();
        showToast("Frame extraction cancelled.");
      } else {
        clearFrameResults();
        showToast(error.message, "error");
      }

    } finally {
      isExtractingFrames = false;
      cancelFramesRequested = false;

      button.disabled = false;
      button.innerHTML = "Extract frames →";

      $("cancelFrames").hidden = true;

      setTimeout(() => hideProgress("frames"), 1500);
    }
  }


  // ==========================================
  // DISPLAY EXTRACTED FRAMES
  // ==========================================

  function displayExtractedFrames() {
    const container = $("frameResults");

    container.innerHTML = "";

    extractedFrames.forEach((frame, index) => {
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

      const downloadButton = document.createElement("button");

      downloadButton.type = "button";
      downloadButton.className = "frame-download";
      downloadButton.textContent = "Download ↓";

      downloadButton.addEventListener("click", () => {
        downloadBlob(frame.blob, frame.filename);
      });

      item.append(
        image,
        caption,
        downloadButton
      );

      container.appendChild(item);
    });
  }


  $("extractFrames").addEventListener(
    "click",
    extractFrames
  );


  $("cancelFrames").addEventListener("click", () => {
    if (!isExtractingFrames) return;

    cancelFramesRequested = true;

    showToast("Cancelling frame extraction...");
  });


  // ==========================================
  // DOWNLOAD FRAMES AS ZIP
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

      downloadBlob(
        zipBlob,
        "zerolag-extracted-frames.zip"
      );

      showToast("Your ZIP file is ready!", "success");

    } catch (error) {
      console.error(error);

      showToast("Could not create the ZIP file.", "error");

    } finally {
      button.disabled = false;
      button.textContent = "Download ZIP ↓";

      setTimeout(() => hideProgress("frames"), 1500);
    }
  }


  $("downloadZip").addEventListener("click", downloadZip);


  // ==========================================
  // FOOTER
  // ==========================================

  $("year").textContent = new Date().getFullYear();


  // ==========================================
  // CLEANUP
  // ==========================================

  window.addEventListener("beforeunload", () => {
    stopTrimPreview();

    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl);
    }

    if (gifObjectUrl) {
      URL.revokeObjectURL(gifObjectUrl);
    }

    frameObjectUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });

    if (
      activeEncoder &&
      typeof activeEncoder.abort === "function"
    ) {
      try {
        activeEncoder.abort();
      } catch {
        // The page is already closing.
      }
    }
  });


  console.log("ZeroLag Studio initialized.");

})();
