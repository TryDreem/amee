// The finished file often arrives from a poll, not from the click that started the export, so
// there's no user activation left by the time it resolves: opening it in a new tab is silently
// swallowed by the popup blocker and the export appears to do nothing. Fetching it as a blob
// sidesteps that entirely -- a blob: URL is same-origin, so `download` is honored and no window
// is opened. Shared by every place that hands a finished export to the user (Editor's own toast,
// Home's export badge/toast) so there's exactly one implementation of this to keep correct.
export async function triggerDownload(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status}`);
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download that was just started.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
