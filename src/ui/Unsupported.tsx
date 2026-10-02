import styles from "./Unsupported.module.css";

export type UnsupportedReason = "device" | "webgpu" | "error";

export function Unsupported({
  reason,
  detail,
  onContinue,
}: {
  reason: UnsupportedReason;
  detail?: string;
  onContinue?: () => void;
}) {
  return (
    <div class={styles.screen}>
      <div class={styles.card}>
        {reason === "device" && (
          <>
            <h1 class={styles.title}>Desktop only</h1>
            <p>
              This game is played with a keyboard and mouse, which this device doesn't seem to have.
              Please come back on a desktop or laptop computer.
            </p>
          </>
        )}
        {reason === "webgpu" && (
          <>
            <h1 class={styles.title}>WebGPU required</h1>
            <p>
              This game renders with WebGPU, which your browser doesn't provide. Please use a
              current desktop version of Chrome, Edge, Safari or Firefox with hardware acceleration
              enabled.
            </p>
            <p>
              <a
                class={styles.link}
                href="https://caniuse.com/webgpu"
                target="_blank"
                rel="noreferrer"
              >
                Check WebGPU browser support
              </a>
            </p>
          </>
        )}
        {reason === "error" && (
          <>
            <h1 class={styles.title}>Couldn't start</h1>
            <p>
              The game's renderer failed to start. Make sure hardware acceleration is enabled in
              your browser, then reload the page.
            </p>
          </>
        )}
        {detail && <p class={styles.detail}>{detail}</p>}
        {onContinue && (
          <button type="button" class={styles.continue} onClick={onContinue}>
            Continue anyway
          </button>
        )}
      </div>
    </div>
  );
}
