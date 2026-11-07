
(() => {
  "use strict";

  // ==========================================
  // ZEROLAG - VIDEO TO GIF & FRAME EXTRACTOR
  // ==========================================

  const $ = (id) => document.getElementById(id);

  const videoInput = $("videoInput");
  const dropZone = $("dropZone");
  const uploadContent = $("uploadContent");
  const videoArea = $("videoArea");
  const video = $("videoPlayer");

  const browseButton = $("browseButton");
  const removeVideo = $("removeVideo");

  const generateGif = $("generateGif");
  const captureCurrent = $("captureCurrent");
  const extractBatch = $("extractBatch");
  const downloadZip = $("downloadZip");
  const clearFrames = $("clearFrames");

  const startInput = $("startTime");
  const endInput = $("endTime");

  const seekBar = $("seekBar");
  const currentTimeLabel = $("currentTime");
  const totalTimeLabel = $("totalTime");

  const gifProgressPanel = $("gifProgressPanel");
  const gifProgressFill = $("gifProgressFill");
  const gifProgressText = $("gifProgressText");
  const gifProgressPercent = $("gifProgressPercent");

  const gifResult = $("gifResult");
  const gifPreview = $("gifPreview");
  const downloadGif = $("downloadGif");
  const gifMetadata = $("gifMetadata");

  const frameProgressPanel = $("frameProgressPanel");
  const frameProgressFill = $("frameProgressFill");
  const frameProgressText = $("frameProgressText");
  const frameProgressPercent = $("frameProgressPercent");

  const frameGrid = $("frameGrid");
  const emptyFrames = $("emptyFrames");
  const frameCount = $("frameCount");

  const toast = $("toast");

  const GIF_WORKER =
    "https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js";

  let selectedFile = null;
  let videoURL = null;
  let gifURL = null;
  let duration = 0;

  let frames = [];
  let busy = false;
  let toastTimer = null;

  $("year").textContent = new Date().getFullYear();


  // ==========================================
  // UTILITIES
  // ==========================================

  function notify(message) {
    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 3000);
  }


  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "00:00";

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    return (
      String(mins).padStart(2, "0") +
      ":" +
      String(secs).padStart(2, "0")
    );
  }


  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + " KB";
    }

    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }


  function setProgress(type, percent, message) {
    const gif = type === "gif";

    const fill = gif ? gifProgressFill : frameProgressFill;
    const label = gif ? gifProgressText : frameProgressText;
    const percentage = gif
      ? gifProgressPercent
      : frameProgressPercent;

    const panel = gif ? gifProgressPanel : frameProgressPanel;

    panel.classList.remove("hidden");

    const value = Math.max(0, Math.min(100, percent));

    fill.style.width = value + "%";
    label.textContent = message;
    percentage.textContent = Math.round(value) + "%";
  }


  function hideProgress(type) {
    const panel =
      type === "gif" ? gifProgressPanel : frameProgressPanel;

    panel.classList.add("hidden");
  }


  function setBusy(value) {
    busy = value;

    generateGif.disabled = !selectedFile || value;
    captureCurrent.disabled = !selectedFile || value;
    extractBatch.disabled = !selectedFile || value;

    videoInput.disabled = value;
    browseButton.disabled = value;
    removeVideo.disabled = value;
  }


  function validateRange() {
    if (!selectedFile) {
      notify("Please upload a video first.");
      return null;
    }

    const start = Number(startInput.value);
    const end = Number(endInput.value);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      notify("Enter valid start and end times.");
      return null;
    }

    if (
      start < 0 ||
      end > duration ||
      end <= start
    ) {
      notify("Please check your selected time range.");
      return null;
    }

    return { start, end };
  }


  function getCanvasDimensions(maxWidth) {
    const originalWidth = video.videoWidth;
    const originalHeight = video.videoHeight;

    if (!originalWidth || !originalHeight) {
      throw new Error("Video dimensions are unavailable.");
    }

    const ratio = Math.min(1, maxWidth / originalWidth);

    return {
      width: Math.max(1, Math.round(originalWidth * ratio)),
      height: Math.max(1, Math.round(originalHeight * ratio))
    };
  }


  function makeCanvas(width, height) {
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", {
      alpha: false
    });

    if (!context) {
      throw new Error("Canvas is not supported by this browser.");
    }

    return { canvas, context };
  }


  // ==========================================
  // VIDEO UPLOAD
  // ==========================================

  browseButton.addEventListener("click", () => {
    if (!busy) videoInput.click();
  });


  videoInput.addEventListener("change", (event) => {
    const file = event.target.files[0];

    if (file) loadVideo(file);

    // Allows choosing the same file again.
    videoInput.value = "";
  });


  function loadVideo(file) {
    if (busy) return;

    if (!file.type.startsWith("video/")) {
      notify("Please select a valid video file.");
      return;
    }

    cleanupVideo();

    selectedFile = file;

    videoURL = URL.createObjectURL(file);

    video.src = videoURL;
    video.load();

    uploadContent.classList.add("hidden");
    videoArea.classList.remove("hidden");

    $("videoName").textContent = file.name;
    $("videoDetails").textContent =
      formatBytes(file.size) + " · Loading...";

    generateGif.disabled = true;
    captureCurrent.disabled = true;
    extractBatch.disabled = true;

    gifResult.classList.add("hidden");

    notify("Video selected successfully.");
  }


  video.addEventListener("loadedmetadata", () => {
    if (!selectedFile) return;

    duration = video.duration;

    if (!Number.isFinite(duration)) {
      notify("This video has an unsupported duration.");
      cleanupVideo();
      return;
    }

    startInput.value = "0";
    endInput.value = duration.toFixed(2);

    startInput.max = duration;
    endInput.max = duration;

    seekBar.max = duration;
    seekBar.value = 0;

    totalTimeLabel.textContent = formatTime(duration);

    $("videoDetails").textContent =
      video.videoWidth +
      " × " +
      video.videoHeight +
      " · " +
      formatTime(duration);

    generateGif.disabled = false;
    captureCurrent.disabled = false;
    extractBatch.disabled = false;

    notify("Your video is ready!");
  });


  video.addEventListener("error", () => {
    if (!selectedFile) return;

    notify("Unable to decode this video. Try another format.");
  });


  // Drag and drop

  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("drag-over");
  });


  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });


  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();

    dropZone.classList.remove("drag-over");

    const file = event.dataTransfer.files[0];

    if (file) loadVideo(file);
  });


  // Remove video

  removeVideo.addEventListener("click", () => {
    if (busy) return;

    cleanupVideo();

    notify("Video removed.");
  });


  function cleanupVideo() {
    video.pause();
    video.removeAttribute("src");
    video.load();

    if (videoURL) {
      URL.revokeObjectURL(videoURL);
      videoURL = null;
    }

    if (gifURL) {
      URL.revokeObjectURL(gifURL);
      gifURL = null;
    }

    selectedFile = null;
    duration = 0;

    uploadContent.classList.remove("hidden");
    videoArea.classList.add("hidden");

    gifResult.classList.add("hidden");
    hideProgress("gif");
    hideProgress("frames");

    startInput.value = "0";
    endInput.value = "0";

    seekBar.value = 0;

    generateGif.disabled = true;
    captureCurrent.disabled = true;
    extractBatch.disabled = true;

    clearAllFrames();
  }


  // ==========================================
  // VIDEO TIMELINE
  // ==========================================

  video.addEventListener("timeupdate", () => {
    if (!duration) return;

    seekBar.value = video.currentTime;

    currentTimeLabel.textContent =
      formatTime(video.currentTime);
  });


  seekBar.addEventListener("input", () => {
    if (!selectedFile || busy) return;

    video.currentTime = Number(seekBar.value);
  });


  // ==========================================
  // VIDEO SEEKING
  // ==========================================

  async function seekTo(time) {
    if (!Number.isFinite(time)) {
      throw new Error("Invalid video timestamp.");
    }

    if (Math.abs(video.currentTime - time) < 0.001) {
      return;
    }

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Video seeking timed out."));
      }, 15000);

      function cleanup() {
        clearTimeout(timeout);

        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      }

      function onSeeked() {
        cleanup();
        resolve();
      }

      function onError() {
        cleanup();
        reject(new Error("Unable to seek in this video."));
      }

      video.addEventListener("seeked", onSeeked, {
        once: true
      });

      video.addEventListener("error", onError, {
        once: true
      });

      try {
        video.currentTime = time;
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }


  function canvasToBlob(canvas, mimeType) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Image export failed."));
        }
      }, mimeType, 0.95);
    });
  }


  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 30000);
  }


  // ==========================================
  // GIF GENERATOR
  // ==========================================

  generateGif.addEventListener("click", createGif);


  async function createGif() {
    if (busy) return;

    const range = validateRange();

    if (!range) return;

    if (typeof window.GIF !== "function") {
      notify("GIF encoder failed to load. Refresh the page.");
      return;
    }

    if (range.end - range.start > 30) {
      notify("For smoother performance, keep GIF clips under 30 seconds.");
      return;
    }

    const fps = Number($("gifFps").value);
    const quality = Number($("gifQuality").value);

    const selectedWidth = $("gifWidth").value;

    const maxWidth =
      selectedWidth === "original"
        ? Math.min(video.videoWidth, 1920)
        : Number(selectedWidth);

    const frameDelay = 1000 / fps;

    const frameTotal = Math.ceil(
      (range.end - range.start) * fps
    );

    if (frameTotal < 1 || frameTotal > 600) {
      notify("This GIF requires too many frames.");
      return;
    }

    const wasPlaying = !video.paused;
    const previousTime = video.currentTime;

    let encoder = null;

    setBusy(true);

    gifResult.classList.add("hidden");

    if (gifURL) {
      URL.revokeObjectURL(gifURL);
      gifURL = null;
    }

    setProgress("gif", 0, "Preparing GIF encoder...");

    try {
      const dimensions = getCanvasDimensions(maxWidth);

      const { canvas, context } = makeCanvas(
        dimensions.width,
        dimensions.height
      );

      encoder = new GIF({
        workers: 2,
        quality: quality,
        width: dimensions.width,
        height: dimensions.height,
        workerScript: GIF_WORKER,
        repeat: Number($("gifLoop").value) === 1
          ? -1
          : Number($("gifLoop").value)
      });

      video.pause();

      // Extract frames at the chosen FPS.
      for (let i = 0; i < frameTotal; i++) {

        const timestamp = Math.min(
          range.start + i / fps,
          range.end
        );

        await seekTo(timestamp);

        context.drawImage(
          video,
          0,
          0,
          canvas.width,
          canvas.height
        );

        encoder.addFrame(canvas, {
          copy: true,
          delay: frameDelay
        });

        const progress = ((i + 1) / frameTotal) * 85;

        setProgress(
          "gif",
          progress,
          "Collecting frames: " + (i + 1) + "/" + frameTotal
        );

        // Give the browser opportunities to update.
        if (i % 3 === 0) {
          await new Promise(resolve =>
            requestAnimationFrame(resolve)
          );
        }
      }

      setProgress("gif", 88, "Encoding your GIF...");

      const result = await new Promise((resolve, reject) => {

        encoder.on("progress", (progress) => {
          setProgress(
            "gif",
            88 + progress * 11,
            "Encoding GIF..."
          );
        });

        encoder.on("finished", (blob) => {
          resolve(blob);
        });

        encoder.on("abort", () => {
          reject(new Error("GIF encoding was aborted."));
        });

        try {
          encoder.render();
        } catch (error) {
          reject(error);
        }
      });

      if (!result || result.size === 0) {
        throw new Error("GIF generation produced an empty file.");
      }

      gifURL = URL.createObjectURL(result);

      gifPreview.src = gifURL;

      downloadGif.href = gifURL;

      downloadGif.download =
        "zerolag-" +
        Date.now() +
        ".gif";

      gifMetadata.textContent =
        "Resolution: " +
        dimensions.width +
        " × " +
        dimensions.height +
        " · " +
        fps +
        " FPS · " +
        frameTotal +
        " frames · " +
        formatBytes(result.size);

      gifResult.classList.remove("hidden");

      setProgress("gif", 100, "GIF created successfully!");

      notify("Your GIF is ready!");

      gifResult.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

    } catch (error) {

      console.error("GIF Error:", error);

      notify(error.message || "GIF generation failed.");

    } finally {

      if (encoder && typeof encoder.abort === "function") {
        // Do not abort after successful rendering.
        // The encoder has completed by this point.
      }

      try {
        await seekTo(previousTime);
      } catch (error) {
        console.warn("Could not restore video position.", error);
      }

      if (wasPlaying) {
        video.play().catch(() => {});
      }

      setBusy(false);

      // Keep the completed result visible.
    }
  }


  // ==========================================
  // FRAME EXTRACTION
  // ==========================================

  captureCurrent.addEventListener("click", async () => {

    if (busy || !selectedFile) return;

    setBusy(true);

    try {
      const timestamp = video.currentTime;

      const mimeType = $("frameFormat").value;

      const { canvas, context } = makeCanvas(
        video.videoWidth,
        video.videoHeight
      );

      context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const blob = await canvasToBlob(canvas, mimeType);

      addFrame(blob, timestamp, mimeType);

      notify("Frame captured successfully.");

    } catch (error) {

      console.error(error);

      notify(error.message || "Unable to capture frame.");

    } finally {
      setBusy(false);
    }

  });


  // ==========================================
  // BATCH FRAME EXTRACTION
  // ==========================================

  extractBatch.addEventListener("click", extractAllFrames);


  async function extractAllFrames() {

    if (busy) return;

    const range = validateRange();

    if (!range) return;

    const interval = Number($("frameInterval").value);

    if (
      !Number.isFinite(interval) ||
      interval < 0.1 ||
      interval > 60
    ) {
      notify("Choose an interval between 0.1 and 60 seconds.");
      return;
    }

    const total = Math.floor(
      (range.end - range.start) / interval
    ) + 1;

    if (total > 300) {
      notify("Too many frames. Increase the extraction interval.");
      return;
    }

    const wasPlaying = !video.paused;
    const previousTime = video.currentTime;

    const mimeType = $("frameFormat").value;

    setBusy(true);

    try {

      const { canvas, context } = makeCanvas(
        video.videoWidth,
        video.videoHeight
      );

      video.pause();

      for (let i = 0; i < total; i++) {

        const timestamp = Math.min(
          range.start + i * interval,
          range.end
        );

        await seekTo(timestamp);

        context.drawImage(
          video,
          0,
          0,
          canvas.width,
          canvas.height
        );

        const blob = await canvasToBlob(
          canvas,
          mimeType
        );

        addFrame(blob, timestamp, mimeType);

        const progress = ((i + 1) / total) * 100;

        setProgress(
          "frames",
          progress,
          "Extracting frame " + (i + 1) + " of " + total
        );

        if (i % 2 === 0) {
          await new Promise(resolve =>
            requestAnimationFrame(resolve)
          );
        }
      }

      notify(total + " frames extracted successfully.");

    } catch (error) {

      console.error(error);

      notify(error.message || "Frame extraction failed.");

    } finally {

      try {
        await seekTo(previousTime);
      } catch (error) {
        console.warn(error);
      }

      if (wasPlaying) {
        video.play().catch(() => {});
      }

      setBusy(false);
    }
  }


  // ==========================================
  // FRAME GALLERY
  // ==========================================

  function addFrame(blob, timestamp, mimeType) {

    const id =
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2);

    const url = URL.createObjectURL(blob);

    const extension =
      mimeType === "image/png" ? "png" : "jpg";

    const filename =
      "zerolag-frame-" +
      String(frames.length + 1).padStart(3, "0") +
      "." +
      extension;

    const frame = {
      id,
      blob,
      url,
      timestamp,
      filename
    };

    frames.push(frame);

    renderFrame(frame);

    updateFrameCount();
  }


  function renderFrame(frame) {

    emptyFrames.classList.add("hidden");

    const card = document.createElement("div");

    card.className = "frame-card";
    card.dataset.id = frame.id;

    const image = document.createElement("img");

    image.src = frame.url;
    image.alt = "Video frame at " + formatTime(frame.timestamp);

    const info = document.createElement("div");

    info.className = "frame-card-info";

    const label = document.createElement("p");

    label.textContent =
      formatTime(frame.timestamp) +
      " · " +
      frame.filename;

    const downloadButton = document.createElement("button");

    downloadButton.textContent = "↓ Download";

    downloadButton.addEventListener("click", () => {
      downloadBlob(frame.blob, frame.filename);
    });

    info.append(label, downloadButton);

    card.append(image, info);

    frameGrid.appendChild(card);
  }


  function updateFrameCount() {

    frameCount.textContent =
      frames.length +
      (frames.length === 1
        ? " image captured"
        : " images captured");

    downloadZip.disabled =
      frames.length === 0 || busy;
  }


  function clearAllFrames() {

    frames.forEach((frame) => {
      URL.revokeObjectURL(frame.url);
    });

    frames = [];

    frameGrid.innerHTML = "";

    frameGrid.appendChild(emptyFrames);

    emptyFrames.classList.remove("hidden");

    updateFrameCount();
  }


  clearFrames.addEventListener("click", () => {

    if (busy) return;

    clearAllFrames();

    notify("All extracted frames cleared.");
  });


  // ==========================================
  // ZIP DOWNLOAD
  // ==========================================

  downloadZip.addEventListener("click", async () => {

    if (busy || frames.length === 0) return;

    if (typeof window.JSZip !== "function") {
      notify("ZIP library failed to load.");
      return;
    }

    downloadZip.disabled = true;

    try {

      const zip = new JSZip();

      const folder = zip.folder("ZeroLag-Frames");

      frames.forEach((frame) => {
        folder.file(frame.filename, frame.blob);
      });

      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: {
          level: 3
        }
      });

      downloadBlob(blob, "zerolag-frames.zip");

      notify("Your ZIP file is ready!");

    } catch (error) {

      console.error(error);

      notify("Unable to create ZIP file.");

    } finally {

      downloadZip.disabled = frames.length === 0;
    }
  });


  // ==========================================
  // PAGE INITIALIZATION
  // ==========================================

  updateFrameCount();

  console.log(
    "%cZeroLag initialized successfully.",
    "color:#9870ff;font-weight:bold;font-size:15px;"
  );

})();
