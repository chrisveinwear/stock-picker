import AnnouncementAlerts from "@/components/AnnouncementAlerts";

export const dynamic = "force-dynamic";

export default function NewsPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">News</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Material ASX announcements and high-impact news across your holdings &amp; watchlist
        </p>
      </div>

      {/* Material announcement alerts (high-impact / thesis-relevant news) */}
      <AnnouncementAlerts />
    </div>
  );
}
