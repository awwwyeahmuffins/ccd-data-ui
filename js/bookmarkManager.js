// js/bookmarkManager.js
// =====================
// Bookmark/Favorites Manager
// Manages bookmarked elections with localStorage persistence

const STORAGE_KEY = 'ccd_bookmarks';
const MAX_BOOKMARKS = 20;

/**
 * Loads bookmarks from localStorage
 * @returns {Array<Object>} Array of bookmark objects
 */
function loadBookmarks() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [];
    }
    return JSON.parse(stored);
  } catch (error) {
    console.error('Error loading bookmarks:', error);
    return [];
  }
}

/**
 * Saves the bookmarks array to localStorage
 * @param {Array<Object>} bookmarks
 */
function persistBookmarks(bookmarks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  } catch (error) {
    console.error('Error saving bookmarks:', error);
  }
}

/**
 * Adds an election to bookmarks. Max 20 bookmarks (oldest removed if exceeded).
 * @param {Object} election - Election with { filename, displayName, year, category }
 */
function saveBookmark(election) {
  if (!election || !election.filename) {
    return;
  }

  const bookmarks = loadBookmarks();

  // Don't add duplicates
  if (bookmarks.some(b => b.filename === election.filename)) {
    return;
  }

  bookmarks.push({
    filename: election.filename,
    displayName: election.displayName || election.filename.replace(/\.csv$/, '').replace(/_/g, ' '),
    year: election.year || null,
    category: election.category || null,
  });

  // Remove oldest (first) entries if over max
  while (bookmarks.length > MAX_BOOKMARKS) {
    bookmarks.shift();
  }

  persistBookmarks(bookmarks);
}

/**
 * Removes a bookmark by filename
 * @param {string} filename
 */
function removeBookmark(filename) {
  const bookmarks = loadBookmarks();
  const filtered = bookmarks.filter(b => b.filename !== filename);
  persistBookmarks(filtered);
}

/**
 * Toggles a bookmark on or off
 * @param {Object} election - Election with { filename, displayName, year, category }
 * @returns {boolean} true if now bookmarked, false if removed
 */
export function toggleBookmark(election) {
  if (isBookmarked(election.filename)) {
    removeBookmark(election.filename);
    return false;
  } else {
    saveBookmark(election);
    return true;
  }
}

/**
 * Checks if an election is bookmarked
 * @param {string} filename
 * @returns {boolean}
 */
export function isBookmarked(filename) {
  const bookmarks = loadBookmarks();
  return bookmarks.some(b => b.filename === filename);
}

/**
 * Returns the current bookmarks array
 * @returns {Array<Object>}
 */
export function getBookmarks() {
  return loadBookmarks();
}

/**
 * Returns HTML string for a bookmark star button
 * @param {string} filename
 * @returns {string} HTML string
 */
export function renderBookmarkStar(filename) {
  const bookmarked = isBookmarked(filename);
  const activeClass = bookmarked ? 'active' : '';
  const title = bookmarked ? 'Remove from favorites' : 'Add to favorites';
  return `<button class="bookmark-star ${activeClass}" data-bookmark="${filename}" title="${title}" aria-label="${title}">\u2605</button>`;
}

/**
 * Returns HTML string for the bookmarks section in the panel.
 * Returns empty string if no bookmarks.
 * @param {Array<Object>} elections - Full elections manifest array
 * @returns {string} HTML string
 */
export function renderBookmarksSection(elections) {
  const bookmarks = loadBookmarks();
  if (bookmarks.length === 0) {
    return '';
  }

  // Build a lookup map from the elections manifest
  const electionMap = new Map();
  if (elections && elections.length > 0) {
    for (const e of elections) {
      electionMap.set(e.filename, e);
    }
  }

  let itemsHtml = '';
  for (const bookmark of bookmarks) {
    // Prefer manifest data for display name, year, category
    const manifest = electionMap.get(bookmark.filename);
    const displayName = (manifest && manifest.displayName) || bookmark.displayName || bookmark.filename;
    const year = (manifest && manifest.year) || bookmark.year || '';
    const category = (manifest && manifest.category) || bookmark.category || '';
    const star = renderBookmarkStar(bookmark.filename);
    const meta = [year, category].filter(Boolean).join(' \u2022 ');

    itemsHtml += `
  <div class="recent-item" data-filename="${bookmark.filename}">
    <div class="recent-item-title">${displayName} ${star}</div>
    <div class="recent-item-meta">${meta}</div>
  </div>`;
  }

  return `<div class="recent-section bookmarks-section">
  <div class="section-title" style="display: flex; justify-content: space-between; align-items: center;">
    <span>Favorites</span>
  </div>${itemsHtml}
</div>`;
}
