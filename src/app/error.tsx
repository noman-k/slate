"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="app-error">
      <h1>Something interrupted your workspace.</h1>
      <p>Your saved pages are safe. Try opening them again.</p>
      <button className="primary-button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
