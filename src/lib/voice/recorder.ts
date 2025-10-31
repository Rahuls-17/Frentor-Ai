/**
 * Voice recorder with VAD (silence auto-stop), push-to-talk friendly,
 * and a hard cap so it never “listens forever”.
 * Also picks a browser-supported mime if the requested one isn’t available.
 */
export function createRecorder(opts?: {
  mimeType?: string;
  vad?: { enabled?: boolean; silenceMs?: number; threshold?: number };
  maxDurationMs?: number;
}) {
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let stream: MediaStream | null = null;

  let audioCtx: AudioContext | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let vadRaf: number | null = null;
  let maxTimer: number | null = null;

  const mimeType = opts?.mimeType || "audio/webm;codecs=opus";
  const vadEnabled = !!opts?.vad?.enabled;
  const silenceMs = opts?.vad?.silenceMs ?? 1200;
  const threshold = opts?.vad?.threshold ?? 0.03;
  const maxDurationMs = opts?.maxDurationMs ?? 12000;

  function cleanupGraph() {
    if (vadRaf) { try { cancelAnimationFrame(vadRaf); } catch {} vadRaf = null; }
    try { sourceNode?.disconnect(); } catch {}
    try { analyser?.disconnect(); } catch {}
    if (audioCtx) { try { audioCtx.close(); } catch {} }
    sourceNode = null; analyser = null; audioCtx = null;
  }
  function cleanupStream() {
    try { stream?.getTracks().forEach(t => t.stop()); } catch {}
    stream = null;
  }

  function beginVAD() {
    if (!vadEnabled || !stream) return;
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      sourceNode = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      sourceNode.connect(analyser);

      const data = new Uint8Array(analyser.fftSize);
      let silenceStart = performance.now();

      const loop = () => {
        if (!analyser) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / data.length);
        const now = performance.now();
        if (rms < threshold) {
          if (now - silenceStart >= silenceMs) { stop().catch(() => {}); return; }
        } else {
          silenceStart = now; // speaking detected, reset timer
        }
        vadRaf = requestAnimationFrame(loop) as unknown as number;
      };
      vadRaf = requestAnimationFrame(loop) as unknown as number;
    } catch {
      // Ignore VAD errors; user can still stop manually or via hard cap
    }
  }

  async function start() {
    if (mediaRecorder && mediaRecorder.state === "recording") return;
    chunks = [];

    // Pick a supported mime (iOS often prefers audio/mp4 or audio/m4a)
    let chosenType = mimeType;
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported && !MediaRecorder.isTypeSupported(mimeType)) {
      chosenType = undefined as any; // let browser choose
    }

    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, chosenType ? { mimeType: chosenType } : undefined);

    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.start(); // we collect all chunks; final blob assembled on stop()

    beginVAD();

    if (maxDurationMs > 0) {
      maxTimer = window.setTimeout(() => { stop().catch(() => {}); }, maxDurationMs) as unknown as number;
    }
  }

  async function stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const finalize = () => {
        if (maxTimer) { try { clearTimeout(maxTimer); } catch {} maxTimer = null; }
        cleanupGraph();
        cleanupStream();
        // Respect the actual recorded type (iOS yields audio/mp4 or audio/m4a)
        const detectedType = (chunks[0] as any)?.type || (mimeType.includes("wav") ? "audio/wav" : "audio/webm");
        resolve(new Blob(chunks, { type: detectedType }));
      };
      if (!mediaRecorder) return reject(new Error("Not recording"));
      try { mediaRecorder.onstop = () => finalize(); mediaRecorder.stop(); }
      catch { finalize(); }
      finally { mediaRecorder = null; }
    });
  }

  function isRecording() { return mediaRecorder?.state === "recording"; }

  return { start, stop, isRecording };
}
