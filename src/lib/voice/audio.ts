/**
 * Minimal HTTP streaming audio player using an <audio> element.
 */
export async function playStream(url: string, init?: RequestInit & { signal?: AbortSignal }) {
  const res = await fetch(url, { ...init });
  if (!res.ok || !res.body) throw new Error("Audio stream failed");
  const audio = new Audio();
  audio.autoplay = true;
  // For broad browser support, buffer whole response in this simple version
  const buf = await res.arrayBuffer();
  const blob = new Blob([buf], { type: "audio/mpeg" });
  audio.src = URL.createObjectURL(blob);
  await audio.play();
  return { audio };
}
