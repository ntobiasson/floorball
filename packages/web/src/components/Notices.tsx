import type { Announcement } from '@sahlykanta/shared';
import { useT } from '../lib/i18n/index.js';

export function Notices({
  announcements,
}: {
  announcements: Announcement[];
}): React.ReactElement | null {
  const t = useT();

  if (announcements.length === 0) return null;

  return (
    <section className="notices" aria-labelledby="notices-title">
      <h2 className="notices__title" id="notices-title">
        {t.notices.heading}
      </h2>
      {announcements.map((announcement) => (
        <p className="notices__body" key={announcement.id}>
          {announcement.body}
        </p>
      ))}
    </section>
  );
}
