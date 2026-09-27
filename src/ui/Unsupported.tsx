import styles from "./Unsupported.module.css";

export function Unsupported({ detail }: { detail?: string }) {
  return (
    <div class={styles.screen}>
      <div class={styles.card}>
        <h1 class={styles.title}>WebGPU required</h1>
        <p>
          This game renders with WebGPU, which your browser doesn't provide (or couldn't start).
          Please use a current desktop version of Chrome, Edge, Safari or Firefox with hardware
          acceleration enabled.
        </p>
        <p>
          <a class={styles.link} href="https://caniuse.com/webgpu" target="_blank" rel="noreferrer">
            Check WebGPU browser support
          </a>
        </p>
        {detail && <p class={styles.detail}>{detail}</p>}
      </div>
    </div>
  );
}
