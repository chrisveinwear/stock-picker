"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteReportButton({ ticker, redirectTo }: { ticker: string; redirectTo?: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!confirming) {
      setConfirming(true);
      return;
    }

    setLoading(true);
    await fetch("/api/research/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker }),
    });

    if (redirectTo) {
      router.push(redirectTo);
    } else {
      router.refresh();
    }
  }

  function handleCancel(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(false);
  }

  if (loading) {
    return <span className="text-xs text-zinc-500">Deleting…</span>;
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <span className="text-xs text-zinc-400">Delete?</span>
        <button
          onClick={handleDelete}
          className="text-xs text-red-400 hover:text-red-300 transition-colors font-medium"
        >
          Yes
        </button>
        <button
          onClick={handleCancel}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          No
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={handleDelete}
      className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
      title="Delete report"
    >
      Delete
    </button>
  );
}
