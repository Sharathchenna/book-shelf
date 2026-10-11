export type ShelfConfig = {
  /** Shown as "<owner>'s Shelf". */
  owner: string;
  bio: string;
  /** Path under /public, e.g. "/avatar.jpg". Initials are shown when absent. */
  avatar?: string;
  links: { label: string; url: string }[];
  /** Where the site is deployed, e.g. "https://books.example.com". Needed for link previews. */
  siteUrl?: string;
  /** The number in your Goodreads profile URL. `bun run import` syncs your public shelves from it. */
  goodreadsUserId?: string;
};

export const shelfConfig: ShelfConfig = {
  owner: "Sharath",
  bio: "A running catalog of what I read, with notes in the margins.",
  links: [],
  siteUrl: "https://read.sharathchenna.com",
  goodreadsUserId: "49386460",
};
