"use client";

export function DeleteConfirmationCancelButton() {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.currentTarget.closest("details")?.removeAttribute("open");
      }}
      className="rounded-md border border-border px-2 py-1 font-semibold text-foreground"
    >
      Cancel
    </button>
  );
}
