export function matchesMovie(haystack, query) {
  return haystack.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export function nextWatchlist(current, id) {
  const values = new Set(current);
  values.has(id) ? values.delete(id) : values.add(id);
  return [...values].sort();
}
