(() => {
  "use strict";

  // ==========================================
  // ZEROLAG — VIDEO TO GIF & FRAME EXTRACTOR
  // ==========================================

  const $ = (id) => document.getElementById(id);

  const GIF_WORKER = "./gif.worker.js";

  const MAX_GIF_SECONDS = 30;
  const MAX_GIF_FRAMES = 600;
  const MAX_EXTRACT_FRAMES = 300;

  let videoFile = null;
  let extractedFrames = [];
  let currentGifUrl = null;
  let isGenerating = false;

  const videoInput = $("videoInput");
  const dropZone = $("dropZone");
  const videoPlayer = $("videoPlayer");

  // ==========================================
  // HELPER FUNCTIONS
  // ==========================================

  function getElement(...ids) {
    for (const id of ids) {
      const element = $(id);
      if (element) return element;
    }
    return null;
  }

  function getNumber(element, fallback) {
    if (!element) return fallback;

    const value = Number(element.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "00:00";

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds
    ).padStart(2, "0")}`;
  }

  function showMessage(message, type = "info") {
    const messageBox = getElement("statusMessage", "message", "notification");

    if (messageBox) {
      messageBox.textContent = message;
      messageBox.className = `status-message ${type}`;
      messageBox.hidden = false;
    } else {
      console.log(`[ZeroLag] ${message}`);
    }
  }

  function setProgress(percent, message = "") {
    const progress = getElement("progressBar", "progressFill");
    const progressText = getElement("progressText", "progressLabel");

    if (progress) {
      progress.style.width = `${Math.max(0, Math.min(100, percent))}%`;

      if (progress.tagName === "PROGRESS") {
        progress.value = percent;
      }
    }

    if (progressText) {
      progressText.textContent =
        message || `${Math.round(percent)}%`;
    }
  }

  function showProgress(show) {
    const container = getElement("progressContainer", "progressSection");

    if (container) {
      container.hidden = !show;
      container.style.display = show ? "" : "none";
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function getVideoDimensions() {
    return {
      width: videoPlayer.videoWidth,
      height: videoPlayer.videoHeight
    };
  }

  function createCanvas(width, height) {
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    return canvas;
  }

  function drawVideoFrame(canvas, width, height) {
    const context = canvas.getContext("2d", {
      willReadFrequently: false
    });

    context.fillStyle = "#000000";
    context.fillRect(0, 0, width, height);

    context.drawImage(videoPlayer, 0, 0, width, height);

    return context;
  }

  // ==========================================
  // VIDEO UPLOAD
  // ==========================================

  function loadVideo(file) {
    if (!file) return;

    if (!file.type.startsWith("video/")) {
      showMessage("Please select a valid video file.", "error");
      return;
    }

    if (videoFile) {
      URL.revokeObjectURL(videoFile);
    }

    videoFile = URL.createObjectURL(file);

    videoPlayer.src = videoFile;
    videoPlayer.load();

    extractedFrames = [];

    videoPlayer.onloadedmetadata = () => {
      const duration = videoPlayer.duration;

      const startInput = $("startTime");
      const endInput = $("endTime");

      if (startInput) {
        startInput.value = 0;
        startInput.max = duration;
      }

      if (endInput) {
        endInput.value = duration;
        endInput.max = duration;
      }

      const durationLabel = getElement("videoDuration", "duration");

      if (durationLabel) {
        durationLabel.textContent = formatTime(duration);
      }

      const videoInfo = getElement("videoInfo", "videoDetails");

      if (videoInfo) {
        videoInfo.hidden = false;
      }

      showMessage("Video loaded successfully!", "success");
    };

    videoPlayer.onerror = () => {
      showMessage("Unable to load this video.", "error");
    };
  }

  if (videoInput) {
    videoInput.addEventListener("change", (event) => {
      loadVideo(event.target.files[0]);
    });
  }

  if (dropZone) {
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

      if (file && videoInput) {
        loadVideo(file);
        videoInput.value = "";
      }
    });

    dropZone.addEventListener("click", (event) => {
      if (
        event.target.closest("button") ||
        event.target.closest("input")
      ) {
        return;
      }

      videoInput?.click();
    });
  }

  // ==========================================
  // VIDEO SEEKING
  // ==========================================

  function seekVideo(time) {
    return new Promise((resolve, reject) => {
      if (!videoPlayer || !Number.isFinite(time)) {
        reject(new Error("Invalid video or timestamp."));
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

      const timeout = setTimeout(() => {
        videoPlayer.removeEventListener("seeked", onSeeked);
        reject(new Error("Video seeking timed out."));
      }, 10000);

      function onSeeked() {
        clearTimeout(timeout);
        videoPlayer.removeEventListener("seeked", onSeeked);
        resolve();
      }

      videoPlayer.addEventListener("seeked", onSeeked, {
        once: true
      });

      videoPlayer.currentTime = target;
    });
  }

  // ==========================================
  // GIF GENERATOR
  // ==========================================

  async function createGif() {
    if (isGenerating) return;

    if (!videoFile || !videoPlayer.duration) {
      showMessage("Upload a video before creating a GIF.", "error");
      return;
    }

    if (typeof GIF === "undefined") {
      showMessage(
        "GIF library did not load. Refresh the page and try again.",
        "error"
      );
      return;
    }

    const start = getNumber($("startTime"), 0);
    const end = getNumber($("endTime"), videoPlayer.duration);

    const requestedWidth = Math.round(
      getNumber($("gifWidth"), 480)
    );

    const fps = Math.max(
      1,
      Math.min(30, getNumber($("gifFps"), 12))
    );

    const quality = Math.max(
      1,
      Math.min(30, getNumber($("gifQuality"), 10))
    );

    const loopValue = getNumber($("gifLoop"), 0);

    if (start < 0 || end <= start || end > videoPlayer.duration + 0.1) {
      showMessage("Please select a valid start and end time.", "error");
      return;
    }

    const duration = end - start;

    if (duration > MAX_GIF_SECONDS) {
      showMessage(
        `GIF duration must be ${MAX_GIF_SECONDS} seconds or less.`,
        "error"
      );
      return;
    }

    const frameCount = Math.ceil(duration * fps);

    if (frameCount > MAX_GIF_FRAMES) {
      showMessage(
        `Too many frames. Reduce the duration or FPS. Maximum: ${MAX_GIF_FRAMES}.`,
        "error"
      );
      return;
    }

    const originalDimensions = getVideoDimensions();

    if (!originalDimensions.width || !originalDimensions.height) {
      showMessage("Video is not ready yet.", "error");
      return;
    }

    const width = Math.min(
      requestedWidth,
      originalDimensions.width
    );

    const height = Math.max(
      1,
      Math.round(
        width *
        originalDimensions.height /
        originalDimensions.width
      )
    );

    const canvas = createCanvas(width, height);

    const delay = Math.max(20, Math.round(1000 / fps));

    // gif.js uses 0 for infinite looping and -1 for no repeat.
    const repeat = loopValue === 1 ? -1 : loopValue;

    let encoder;

    isGenerating = true;

    const generateButton = $("generateGif");

    if (generateButton) {
      generateButton.disabled = true;
      generateButton.textContent = "Creating GIF...";
    }

    showProgress(true);
    setProgress(0, "Preparing video...");

    try {
      videoPlayer.pause();

      encoder = new GIF({
        workers: 2,
        quality: quality,
        width: width,
        height: height,
        repeat: repeat,
        background: "#000000",
        workerScript: GIF_WORKER
      });

      // Collect frames.
      for (let i = 0; i < frameCount; i++) {
        const time = Math.min(
          start + i / fps,
          end - 0.001
        );

        await seekVideo(time);

        drawVideoFrame(canvas, width, height);

        encoder.addFrame(canvas, {
          copy: true,
          delay: delay
        });

        const progress = ((i + 1) / frameCount) * 75;

        setProgress(
          progress,
          `Preparing frames: ${i + 1}/${frameCount}`
        );
      }

      setProgress(78, "Rendering GIF...");

      encoder.on("progress", (progress) => {
        const percentage = 78 + progress * 22;

        setProgress(
          percentage,
          `Rendering GIF: ${Math.round(progress * 100)}%`
        );
      });

      const gifBlob = await new Promise((resolve, reject) => {
        encoder.on("finished", resolve);

        encoder.on("abort", () => {
          reject(new Error("GIF rendering was cancelled."));
        });

        encoder.render();
      });

      if (!gifBlob || gifBlob.size === 0) {
        throw new Error("The generated GIF is empty.");
      }

      if (currentGifUrl) {
        URL.revokeObjectURL(currentGifUrl);
      }

      currentGifUrl = URL.createObjectURL(gifBlob);

      const preview = getElement(
        "gifPreview",
        "generatedGif",
        "resultGif"
      );

      if (preview) {
        if (preview.tagName === "IMG") {
          preview.src = currentGifUrl;
        } else {
          preview.innerHTML = "";

          const image = document.createElement("img");
          image.src = currentGifUrl;
          image.alt = "Generated GIF preview";
          image.style.maxWidth = "100%";

          preview.appendChild(image);
        }
      }

      const resultSection = getElement(
        "gifResult",
        "resultSection",
        "gifOutput"
      );

      if (resultSection) {
        resultSection.hidden = false;
        resultSection.style.display = "";
      }

      const downloadButton = getElement(
        "downloadGif",
        "downloadGIF"
      );

      if (downloadButton) {
        downloadButton.disabled = false;

        downloadButton.onclick = () => {
          downloadBlob(gifBlob, "zerolag-animation.gif");
        };
      }

      setProgress(100, "GIF created successfully!");

      showMessage(
        `GIF created! Size: ${(gifBlob.size / 1024 / 1024).toFixed(2)} MB`,
        "success"
      );

    } catch (error) {
      console.error("GIF creation error:", error);

      showMessage(
        `GIF creation failed: ${error.message}`,
        "error"
      );

    } finally {
      isGenerating = false;

      if (generateButton) {
        generateButton.disabled = false;
        generateButton.textContent = "Create GIF";
      }

      if (encoder) {
        encoder.abort();
      }

      showProgress(false);
    }
  }

  $("generateGif")?.addEventListener("click", createGif);

  // ==========================================
  // CURRENT FRAME EXTRACTION
  // ==========================================

  function getImageFormat() {
    const formatInput = getElement(
      "imageFormat",
      "frameFormat",
      "extractFormat"
    );

    return formatInput?.value === "jpg" ||
      formatInput?.value === "jpeg"
      ? "image/jpeg"
      : "image/png";
  }

  function getImageExtension() {
    return getImageFormat() === "image/jpeg" ? "jpg" : "png";
  }

  async function captureCurrentFrame() {
    if (!videoFile) {
      showMessage("Upload a video first.", "error");
      return;
    }

    try {
      const dimensions = getVideoDimensions();

      const canvas = createCanvas(
        dimensions.width,
        dimensions.height
      );

      drawVideoFrame(canvas, dimensions.width, dimensions.height);

      const format = getImageFormat();

      canvas.toBlob((blob) => {
        if (!blob) {
          showMessage("Could not capture this frame.", "error");
          return;
        }

        downloadBlob(
          blob,
          `zerolag-frame-${Date.now()}.${getImageExtension()}`
        );

        showMessage("Frame downloaded successfully!", "success");
      }, format, 0.95);

    } catch (error) {
      console.error(error);
      showMessage("Frame extraction failed.", "error");
    }
  }

  const currentFrameButton = getElement(
    "captureFrame",
    "extractCurrentFrame",
    "downloadFrame",
    "currentFrame"
  );

  currentFrameButton?.addEventListener(
    "click",
    captureCurrentFrame
  );

  // ==========================================
  // BATCH FRAME EXTRACTION
  // ==========================================

  async function extractAllFrames() {
    if (!videoFile) {
      showMessage("Upload a video first.", "error");
      return;
    }

    const start = getNumber($("startTime"), 0);
    const end = getNumber($("endTime"), videoPlayer.duration);

    const interval = getNumber(
      getElement("frameInterval", "extractInterval", "interval"),
      1
    );

    if (interval <= 0 || end <= start) {
      showMessage("Please enter a valid extraction interval.", "error");
      return;
    }

    const totalFrames = Math.floor((end - start) / interval) + 1;

    if (totalFrames > MAX_EXTRACT_FRAMES) {
      showMessage(
        `This extraction would create ${totalFrames} frames. Maximum: ${MAX_EXTRACT_FRAMES}. Increase the interval.`,
        "error"
      );
      return;
    }

    const dimensions = getVideoDimensions();

    if (!dimensions.width || !dimensions.height) {
      showMessage("Video is not ready yet.", "error");
      return;
    }

    extractedFrames = [];

    const button = getElement(
      "extractFrames",
      "extractAllFrames",
      "batchExtract"
    );

    if (button) {
      button.disabled = true;
      button.textContent = "Extracting...";
    }

    showProgress(true);

    try {
      videoPlayer.pause();

      const canvas = createCanvas(
        dimensions.width,
        dimensions.height
      );

      const format = getImageFormat();
      const extension = getImageExtension();

      for (let i = 0; i < totalFrames; i++) {
        const time = Math.min(
          start + i * interval,
          end - 0.001
        );

        await seekVideo(time);

        drawVideoFrame(
          canvas,
          dimensions.width,
          dimensions.height
        );

        const blob = await new Promise((resolve) => {
          canvas.toBlob(resolve, format, 0.95);
        });

        if (!blob) {
          throw new Error(`Could not extract frame ${i + 1}.`);
        }

        extractedFrames.push({
          blob: blob,
          name: `frame-${String(i + 1).padStart(4, "0")}.${extension}`,
          time: time
        });

        const progress = ((i + 1) / totalFrames) * 100;

        setProgress(
          progress,
          `Extracting frames: ${i + 1}/${totalFrames}`
        );
      }

      showMessage(
        `${extractedFrames.length} frames extracted successfully!`,
        "success"
      );

      const result = getElement(
        "frameResults",
        "extractionResults",
        "framesResult"
      );

      if (result) {
        result.innerHTML = "";

        extractedFrames.forEach((frame) => {
          const imageUrl = URL.createObjectURL(frame.blob);

          const item = document.createElement("div");
          item.className = "frame-item";

          const image = document.createElement("img");
          image.src = imageUrl;
          image.alt = frame.name;
          image.loading = "lazy";

          const caption = document.createElement("p");
          caption.textContent =
            `${frame.name} · ${formatTime(frame.time)}`;

          item.append(image, caption);
          result.appendChild(item);
        });

        result.hidden = false;
      }

      const zipButton = getElement(
        "downloadZip",
        "downloadFramesZip",
        "downloadAllFrames"
      );

      if (zipButton) {
        zipButton.disabled = false;
      }

    } catch (error) {
      console.error("Frame extraction error:", error);
      showMessage(error.message, "error");

    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Extract Frames";
      }

      showProgress(false);
    }
  }

  const batchButton = getElement(
    "extractFrames",
    "extractAllFrames",
    "batchExtract"
  );

  batchButton?.addEventListener("click", extractAllFrames);

  // ==========================================
  // DOWNLOAD ALL FRAMES AS ZIP
  // ==========================================

  async function downloadFramesZip() {
    if (!extractedFrames.length) {
      showMessage("Extract frames before downloading the ZIP.", "error");
      return;
    }

    if (typeof JSZip === "undefined") {
      showMessage(
        "ZIP library did not load. Refresh the page and try again.",
        "error"
      );
      return;
    }

    const button = getElement(
      "downloadZip",
      "downloadFramesZip",
      "downloadAllFrames"
    );

    if (button) {
      button.disabled = true;
      button.textContent = "Preparing ZIP...";
    }

    try {
      const zip = new JSZip();

      extractedFrames.forEach((frame) => {
        zip.file(frame.name, frame.blob);
      });

      const zipBlob = await zip.generateAsync(
        { type: "blob" },
        (metadata) => {
          setProgress(
            metadata.percent,
            `Creating ZIP: ${Math.round(metadata.percent)}%`
          );
        }
      );

      downloadBlob(zipBlob, "zerolag-frames.zip");

      showMessage("ZIP downloaded successfully!", "success");

    } catch (error) {
      console.error(error);
      showMessage("Could not create the ZIP file.", "error");

    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Download ZIP";
      }

      showProgress(false);
    }
  }

  const zipButton = getElement(
    "downloadZip",
    "downloadFramesZip",
    "downloadAllFrames"
  );

  zipButton?.addEventListener("click", downloadFramesZip);

  // ==========================================
  // VIDEO TIME DISPLAY
  // ==========================================

  videoPlayer?.addEventListener("timeupdate", () => {
    const currentTime = getElement(
      "currentTime",
      "videoCurrentTime"
    );

    if (currentTime) {
      currentTime.textContent = formatTime(videoPlayer.currentTime);
    }
  });

  // ==========================================
  // CLEANUP
  // ==========================================

  window.addEventListener("beforeunload", () => {
    if (videoFile) {
      URL.revokeObjectURL(videoFile);
    }

    if (currentGifUrl) {
      URL.revokeObjectURL(currentGifUrl);
    }
  });

  console.log("ZeroLag initialized successfully.");
})();
