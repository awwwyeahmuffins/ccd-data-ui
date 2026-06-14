// tests/districtViewSlug.test.js
// districtViewSlugForRace maps a district's own race to its cross-county
// district view slug (cd-/sd-/hd-<n>) — imports the REAL module.

import { describe, it, expect } from '@jest/globals';
import { districtViewSlugForRace } from '../js/electionFilters.js';

describe('districtViewSlugForRace', () => {
  describe('congressional (cd)', () => {
    it('matches "United States Representative District 3" (2024 spelling)', () => {
      expect(districtViewSlugForRace({
        office: 'United States Representative District 3', district: '3',
      })).toBe('cd-3');
    });

    it('matches "U S Representative District 3" (2022 spelling)', () => {
      expect(districtViewSlugForRace({
        office: 'U S Representative District 3', district: '3',
      })).toBe('cd-3');
    });

    it('matches "U.S. House District 4" (VEST/OE 2020 spelling)', () => {
      expect(districtViewSlugForRace({
        office: 'U.S. House District 4', district: '4',
      })).toBe('cd-4');
    });
  });

  describe('state senate (sd)', () => {
    it('matches "State Senator District 8"', () => {
      expect(districtViewSlugForRace({
        office: 'State Senator District 8', district: '8',
      })).toBe('sd-8');
    });

    it('matches "State Senate District 30"', () => {
      expect(districtViewSlugForRace({
        office: 'State Senate District 30', district: '30',
      })).toBe('sd-30');
    });
  });

  describe('state house (hd)', () => {
    it('matches "State Representative District 66"', () => {
      expect(districtViewSlugForRace({
        office: 'State Representative District 66', district: '66',
      })).toBe('hd-66');
    });

    it('matches "State House" (Dallas spelling, district in separate field)', () => {
      expect(districtViewSlugForRace({
        office: 'State House', district: '100',
      })).toBe('hd-100');
    });

    it('does NOT confuse "United States Representative" with state house', () => {
      expect(districtViewSlugForRace({
        office: 'United States Representative District 32', district: '32',
      })).toBe('cd-32');
    });
  });

  describe('district number embedded in office text (no district field)', () => {
    it('parses "State Senator, District No. 24"', () => {
      expect(districtViewSlugForRace({
        office: 'State Senator, District No. 24', district: null,
      })).toBe('sd-24');
    });

    it('parses "State House 74 Dist 74"', () => {
      expect(districtViewSlugForRace({
        office: 'State House 74 Dist 74', district: null,
      })).toBe('hd-74');
    });

    it('absorbs the source typo "State House, Disttrict 88"', () => {
      expect(districtViewSlugForRace({
        office: 'State House, Disttrict 88', district: null,
      })).toBe('hd-88');
    });

    it('parses "United States Representative, District No. 34"', () => {
      expect(districtViewSlugForRace({
        office: 'United States Representative, District No. 34', district: null,
      })).toBe('cd-34');
    });

    it('ignores city-council "Representative" races', () => {
      expect(districtViewSlugForRace({
        office: 'Representative, City of Ep, Dist 1', district: null,
      })).toBeNull();
    });
  });

  describe('non-district and malformed entries', () => {
    it('returns null for statewide races (no district)', () => {
      expect(districtViewSlugForRace({ office: 'Governor', district: null })).toBeNull();
      expect(districtViewSlugForRace({ office: 'United States Senator', district: null })).toBeNull();
    });

    it('returns null for non-numeric district values (appeals court "Place")', () => {
      expect(districtViewSlugForRace({
        office: 'Justice 5th Court of Appeals District Place 10', district: 'Place',
      })).toBeNull();
    });

    it('returns null for county/local district offices', () => {
      expect(districtViewSlugForRace({
        office: 'County Commissioner Precinct 1', district: '1',
      })).toBeNull();
      expect(districtViewSlugForRace({
        office: 'City Council District 3 City of Greenville', district: '3',
      })).toBeNull();
    });

    it('returns null for null/undefined entries', () => {
      expect(districtViewSlugForRace(null)).toBeNull();
      expect(districtViewSlugForRace(undefined)).toBeNull();
      expect(districtViewSlugForRace({})).toBeNull();
    });
  });
});
