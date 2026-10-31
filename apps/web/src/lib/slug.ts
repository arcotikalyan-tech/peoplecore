/** An organization URL from its name: "Digital Hike Pvt. Ltd." → "digital-hike-pvt-ltd" (3–50 lowercase letters, digits, hyphens). */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return slug.length >= 3 ? slug : slug ? `${slug}-hr` : '';
}

/** What someone typed into the URL field, made valid as they type: lowercase, spaces and symbols become hyphens. */
export function cleanSlug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+/, '').slice(0, 50);
}
