/** Competition ranking: tied scores share the same rank (1, 1, 3, …). */
export function formatRankLabel(rank: number | null | undefined, total?: number | null): string | null {
  if (rank == null) return null;
  if (total != null && total > 0) {
    const topPct = Math.max(1, Math.ceil((rank / total) * 100));
    return total > 1 ? `Rank #${rank} of ${total} · Top ${topPct}%` : `Rank #${rank}`;
  }
  return `Rank #${rank}`;
}
