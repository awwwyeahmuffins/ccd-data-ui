// tests/recentlyViewed.test.js
// =============================
// Unit tests for recently viewed manager

import { describe, it, expect, beforeEach, afterEach } from './test-helpers.js';
import {
  addRecentlyViewed,
  getRecentlyViewed,
  clearRecentlyViewed,
  getRecentlyViewedCount,
  validateRecentlyViewed
} from '../js/recentlyViewed.js';

describe('Recently Viewed Manager', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('addRecentlyViewed', () => {
    it('should add entry to recently viewed', () => {
      const entry = {
        filename: 'Governor_2024.csv',
        year: 2024,
        category: 'State',
        displayName: 'Governor (2024)'
      };
      
      addRecentlyViewed(entry);
      const list = getRecentlyViewed();
      
      expect(list).toHaveLength(1);
      expect(list[0].filename).toBe('Governor_2024.csv');
    });

    it('should dedupe by filename', () => {
      const entry1 = { filename: 'Governor_2024.csv', year: 2024 };
      const entry2 = { filename: 'Mayor_2024.csv', year: 2024 };
      const entry3 = { filename: 'Governor_2024.csv', year: 2024 }; // Duplicate
      
      addRecentlyViewed(entry1);
      addRecentlyViewed(entry2);
      addRecentlyViewed(entry3);
      
      const list = getRecentlyViewed();
      expect(list).toHaveLength(2);
      expect(list[0].filename).toBe('Governor_2024.csv'); // Most recent
      expect(list[1].filename).toBe('Mayor_2024.csv');
    });

    it('should limit to MAX_ITEMS (5)', () => {
      for (let i = 1; i <= 7; i++) {
        addRecentlyViewed({ filename: `Race_${i}_2024.csv`, year: 2024 });
      }
      
      const list = getRecentlyViewed();
      expect(list).toHaveLength(5);
      expect(list[0].filename).toBe('Race_7_2024.csv'); // Most recent
    });

    it('should ignore invalid entries', () => {
      addRecentlyViewed(null);
      addRecentlyViewed({});
      addRecentlyViewed({ year: 2024 }); // Missing filename
      
      expect(getRecentlyViewed()).toHaveLength(0);
    });
  });

  describe('getRecentlyViewed', () => {
    it('should return empty array when no entries', () => {
      expect(getRecentlyViewed()).toEqual([]);
    });

    it('should validate against manifest', () => {
      addRecentlyViewed({ filename: 'Governor_2024.csv', year: 2024 });
      addRecentlyViewed({ filename: 'Invalid_Race.csv', year: 2024 });
      
      const manifest = [
        { filename: 'Governor_2024.csv', year: 2024, category: 'State' }
      ];
      
      const list = getRecentlyViewed(manifest);
      expect(list).toHaveLength(1);
      expect(list[0].filename).toBe('Governor_2024.csv');
    });

    it('should filter expired entries', () => {
      // Add entry with old timestamp
      const oldEntry = {
        filename: 'Old_Race.csv',
        year: 2020,
        timestamp: Date.now() - (31 * 24 * 60 * 60 * 1000) // 31 days ago
      };
      
      localStorage.setItem('ccd_recently_viewed', JSON.stringify([oldEntry]));
      
      const list = getRecentlyViewed();
      expect(list).toHaveLength(0);
    });
  });

  describe('clearRecentlyViewed', () => {
    it('should clear all entries', () => {
      addRecentlyViewed({ filename: 'Race1.csv', year: 2024 });
      addRecentlyViewed({ filename: 'Race2.csv', year: 2024 });
      
      clearRecentlyViewed();
      
      expect(getRecentlyViewed()).toHaveLength(0);
    });
  });

  describe('getRecentlyViewedCount', () => {
    it('should return correct count', () => {
      expect(getRecentlyViewedCount()).toBe(0);
      
      addRecentlyViewed({ filename: 'Race1.csv', year: 2024 });
      addRecentlyViewed({ filename: 'Race2.csv', year: 2024 });
      
      expect(getRecentlyViewedCount()).toBe(2);
    });

    it('should validate against manifest', () => {
      addRecentlyViewed({ filename: 'Valid_Race.csv', year: 2024 });
      addRecentlyViewed({ filename: 'Invalid_Race.csv', year: 2024 });
      
      const manifest = [{ filename: 'Valid_Race.csv', year: 2024 }];
      
      expect(getRecentlyViewedCount(manifest)).toBe(1);
    });
  });

  describe('validateRecentlyViewed', () => {
    it('should remove invalid entries from storage', () => {
      // Manually add invalid entry
      localStorage.setItem('ccd_recently_viewed', JSON.stringify([
        { filename: 'Valid_Race.csv', year: 2024, timestamp: Date.now() },
        { filename: 'Invalid_Race.csv', year: 2024, timestamp: Date.now() }
      ]));
      
      const manifest = [{ filename: 'Valid_Race.csv', year: 2024 }];
      validateRecentlyViewed(manifest);
      
      const list = getRecentlyViewed(manifest);
      expect(list).toHaveLength(1);
      expect(list[0].filename).toBe('Valid_Race.csv');
    });
  });
});
