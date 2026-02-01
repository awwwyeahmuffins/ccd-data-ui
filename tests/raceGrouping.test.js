// tests/raceGrouping.test.js
// ===========================
// Unit tests for race grouping logic

import { describe, it, expect } from './test-helpers.js';
import {
  getRaceFamily,
  groupElectionsByFamily,
  sortFamilies,
  getRaceFamilyDisplayName
} from '../js/raceGrouping.js';

describe('Race Grouping Logic', () => {
  describe('getRaceFamily', () => {
    it('should strip year from filename', () => {
      const entry = {
        filename: 'Governor_2024.csv',
        year: 2024,
        category: 'State',
        displayName: 'Governor (2024)'
      };
      expect(getRaceFamily(entry)).toBe('Governor');
    });

    it('should normalize punctuation and spacing', () => {
      const entry = {
        filename: 'City_Council_Place_1_City_of_Lavon_2024.csv',
        year: 2024,
        category: 'City',
        displayName: 'City Council Place 1 City of Lavon (2024)'
      };
      expect(getRaceFamily(entry)).toBe('City Council Place 1 City of Lavon');
    });

    it('should preserve district/precinct numbers', () => {
      const entry = {
        filename: 'Constable_Precinct_No_1_2024.csv',
        year: 2024,
        category: 'County'
      };
      expect(getRaceFamily(entry)).toBe('Constable Precinct No 1');
    });

    it('should handle abbreviations', () => {
      const entry = {
        filename: 'Lt_Governor_2024.csv',
        year: 2024,
        category: 'State'
      };
      expect(getRaceFamily(entry)).toBe('Lieutenant Governor');
    });

    it('should handle entries without year', () => {
      const entry = {
        filename: 'Governor.csv',
        year: null,
        category: 'State'
      };
      expect(getRaceFamily(entry)).toBe('Governor');
    });

    it('should return empty string for invalid entry', () => {
      expect(getRaceFamily(null)).toBe('');
      expect(getRaceFamily({})).toBe('');
    });
  });

  describe('groupElectionsByFamily', () => {
    it('should group elections by family', () => {
      const manifest = [
        { filename: 'Governor_2024.csv', year: 2024, category: 'State', displayName: 'Governor (2024)' },
        { filename: 'Governor_2022.csv', year: 2022, category: 'State', displayName: 'Governor (2022)' },
        { filename: 'Mayor_City_of_Princeton_2024.csv', year: 2024, category: 'City', displayName: 'Mayor City of Princeton (2024)' }
      ];

      const grouped = groupElectionsByFamily(manifest);
      
      expect(Object.keys(grouped)).toContain('Governor');
      expect(Object.keys(grouped)).toContain('Mayor City of Princeton');
      expect(grouped['Governor'].entries).toHaveLength(2);
      expect(grouped['Governor'].totalYears).toBe(2);
      expect(grouped['Governor'].latestYear).toBe(2024);
    });

    it('should sort entries within family by year descending', () => {
      const manifest = [
        { filename: 'Governor_2022.csv', year: 2022, category: 'State' },
        { filename: 'Governor_2024.csv', year: 2024, category: 'State' },
        { filename: 'Governor_2020.csv', year: 2020, category: 'State' }
      ];

      const grouped = groupElectionsByFamily(manifest);
      const entries = grouped['Governor'].entries;
      
      expect(entries[0].year).toBe(2024);
      expect(entries[1].year).toBe(2022);
      expect(entries[2].year).toBe(2020);
    });

    it('should handle empty manifest', () => {
      expect(groupElectionsByFamily([])).toEqual({});
      expect(groupElectionsByFamily(null)).toEqual({});
    });
  });

  describe('sortFamilies', () => {
    const grouped = {
      'City Council': { category: 'City', entries: [], totalYears: 1, latestYear: 2024 },
      'Governor': { category: 'State', entries: [], totalYears: 2, latestYear: 2024 },
      'President': { category: 'Federal', entries: [], totalYears: 1, latestYear: 2020 },
      'Sheriff': { category: 'County', entries: [], totalYears: 1, latestYear: 2024 }
    };

    it('should sort alphabetically by default', () => {
      const sorted = sortFamilies(grouped, 'alphabetical');
      expect(sorted[0].familyKey).toBe('City Council');
      expect(sorted[1].familyKey).toBe('Governor');
      expect(sorted[2].familyKey).toBe('President');
      expect(sorted[3].familyKey).toBe('Sheriff');
    });

    it('should sort by category', () => {
      const sorted = sortFamilies(grouped, 'category');
      expect(sorted[0].familyKey).toBe('President'); // Federal
      expect(sorted[1].familyKey).toBe('Governor'); // State
      expect(sorted[2].familyKey).toBe('Sheriff'); // County
      expect(sorted[3].familyKey).toBe('City Council'); // City
    });

    it('should sort by latest year', () => {
      const groupedWithYears = {
        'Race A': { category: 'State', entries: [], totalYears: 1, latestYear: 2020 },
        'Race B': { category: 'State', entries: [], totalYears: 1, latestYear: 2024 },
        'Race C': { category: 'State', entries: [], totalYears: 1, latestYear: 2022 }
      };
      const sorted = sortFamilies(groupedWithYears, 'latestYear');
      expect(sorted[0].familyKey).toBe('Race B');
      expect(sorted[1].familyKey).toBe('Race C');
      expect(sorted[2].familyKey).toBe('Race A');
    });
  });

  describe('getRaceFamilyDisplayName', () => {
    it('should capitalize first letter of each word', () => {
      expect(getRaceFamilyDisplayName('governor')).toBe('Governor');
      expect(getRaceFamilyDisplayName('city council place 1')).toBe('City Council Place 1');
    });

    it('should handle empty string', () => {
      expect(getRaceFamilyDisplayName('')).toBe('');
      expect(getRaceFamilyDisplayName(null)).toBe('');
    });
  });
});
