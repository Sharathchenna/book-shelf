/**
 * Keyword-based categories from Open Library subjects and the reader's shelves.
 * Rules are checked in order, so more specific genres come first.
 * A model-based classifier replaces this when shelves can be uploaded.
 */
const RULES: [string, RegExp][] = [
  ["Comics & Manga", /\b(comics?|graphic novels?|manga|manhwa)\b/i],
  ["Poetry & Drama", /\b(poetry|poems)\b|^(drama|plays)$/im],
  ["Horror", /\b(horror|ghost stories|haunted)/i],
  ["Science Fiction", /science fiction|sci-?fi|dystopia|space opera|cyberpunk/i],
  ["Fantasy", /\bfantasy|\bmagic\b|dragons|wizards/i],
  ["Mystery & Thriller", /\b(myster|detective|thriller|suspense|crime)/i],
  ["Romance", /\bromance|love stories/i],
  ["Historical Fiction", /historical fiction/i],
  ["Young Readers", /\b(juvenile|children'?s|young adult)/i],
  ["AI & Engineering", /artificial intelligence|machine learning|computer|programming|software|database/i],
  ["Business & Startups", /\b(business|entrepreneur|startups?|management|economics|investing|leadership)/i],
  ["Psychology & Self", /psychology|self-help|habits|personal development|decision making|happiness/i],
  ["Biography & Memoir", /biography|autobiography|memoir/i],
  ["Science", /\b(science|physics|biology|genetics|evolution|astronomy|neuroscience)\b/i],
  ["Philosophy", /philosophy|stoic|ethics/i],
  ["History & Politics", /\b(history|politic|world war|civilization)/i],
  ["Writing & Craft", /authorship|creative writing|\bwriting\b/i],
  ["Classics", /\bclassics?\b/i],
  ["Literary Fiction", /\b(fiction|novel)/i],
];

export function categorize(item: { title: string; subjects: string[]; tags: string[] }): string {
  // The reader's own shelves win; then the first subjects, which are the most representative.
  const sources = [item.tags.join("\n"), [...item.subjects.slice(0, 12), item.title].join("\n")];
  for (const text of sources) {
    for (const [category, re] of RULES) if (re.test(text)) return category;
  }
  return "Nonfiction";
}
