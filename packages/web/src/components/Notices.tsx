import type { Announcement } from '@sahlykanta/shared';

export function Notices({ announcements }: { announcements: Announcement[] }): React.ReactElement | null {
  if (announcements.length === 0) return null;

  return (
    <section className="notices" aria-labelledby="notices-title">
      <h2 className="notices__title" id="notices-title">
        Tiedotteet
      </h2>
      {announcements.map((announcement) => (
        <p className="notices__body" key={announcement.id}>
          {announcement.body}
        </p>
      ))}
    </section>
  );
}
