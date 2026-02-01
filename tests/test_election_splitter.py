"""
Unit tests for election_splitter.py
Run with: pytest test_election_splitter.py -v
"""

import pytest
import pandas as pd
import numpy as np
from io import StringIO


# ============================================================================
# HELPER FUNCTIONS (extracted from election_splitter.py for testing)
# ============================================================================

def extract_party_from_candidate(candidate: str) -> str | None:
    """Extract party abbreviation from candidate name.
    
    Current implementation: Split on spaces and take first token.
    Example: "Rep Donald Trump" -> "Rep"
    """
    if isinstance(candidate, str) and candidate.split():
        return candidate.split()[0]
    return None


def get_winning_candidate(row: pd.Series, candidate_cols: list) -> str | None:
    """Determine winning candidate from a row of vote counts."""
    if not candidate_cols:
        return None
    return row[candidate_cols].idxmax()


# ============================================================================
# TESTS FOR extract_party_from_candidate
# ============================================================================

class TestExtractPartyFromCandidate:
    
    def test_standard_format(self):
        """Standard format: 'Party FirstName LastName'"""
        assert extract_party_from_candidate("Rep Donald Trump") == "Rep"
        assert extract_party_from_candidate("Dem Joe Biden") == "Dem"
        assert extract_party_from_candidate("Lib Jo Jorgensen") == "Lib"
    
    def test_single_word(self):
        """Single word returns that word as party"""
        assert extract_party_from_candidate("Independent") == "Independent"
    
    def test_empty_string(self):
        """Empty string returns None"""
        assert extract_party_from_candidate("") is None
    
    def test_whitespace_only(self):
        """Whitespace-only string returns None"""
        assert extract_party_from_candidate("   ") is None
    
    def test_none_input(self):
        """None input returns None"""
        assert extract_party_from_candidate(None) is None
    
    def test_numeric_input(self):
        """Non-string input returns None"""
        assert extract_party_from_candidate(123) is None
        assert extract_party_from_candidate(np.nan) is None
    
    def test_leading_whitespace(self):
        """Leading whitespace is handled by split()"""
        # BUG: Leading whitespace creates empty first element
        result = extract_party_from_candidate("  Rep Donald Trump")
        # split() handles this correctly - empty strings are NOT included
        assert result == "Rep"
    
    def test_candidate_with_suffix(self):
        """Candidate names with suffixes"""
        assert extract_party_from_candidate("Rep John Smith Jr.") == "Rep"
        assert extract_party_from_candidate("Dem Jane Doe III") == "Dem"
    
    def test_hyphenated_party(self):
        """Edge case: Hyphenated party names"""
        assert extract_party_from_candidate("Non-Partisan John Smith") == "Non-Partisan"


# ============================================================================
# TESTS FOR WINNING CANDIDATE DETERMINATION
# ============================================================================

class TestWinningCandidate:
    
    def test_clear_winner(self):
        """One candidate has more votes than others"""
        row = pd.Series({
            "Rep Candidate A": 1000,
            "Dem Candidate B": 800,
            "Lib Candidate C": 200
        })
        candidates = ["Rep Candidate A", "Dem Candidate B", "Lib Candidate C"]
        
        winner = get_winning_candidate(row, candidates)
        assert winner == "Rep Candidate A"
    
    def test_tie_goes_to_first(self):
        """Tie scenario - idxmax returns first occurrence"""
        row = pd.Series({
            "Rep Candidate A": 500,
            "Dem Candidate B": 500
        })
        candidates = ["Rep Candidate A", "Dem Candidate B"]
        
        winner = get_winning_candidate(row, candidates)
        # idxmax returns first max value encountered
        assert winner == "Rep Candidate A"
    
    def test_all_zeros(self):
        """All candidates have zero votes"""
        row = pd.Series({
            "Rep A": 0,
            "Dem B": 0
        })
        candidates = ["Rep A", "Dem B"]
        
        winner = get_winning_candidate(row, candidates)
        # idxmax still returns first - this is technically correct behavior
        assert winner == "Rep A"
    
    def test_single_candidate(self):
        """Only one candidate"""
        row = pd.Series({"Rep A": 100})
        candidates = ["Rep A"]
        
        winner = get_winning_candidate(row, candidates)
        assert winner == "Rep A"
    
    def test_no_candidates(self):
        """Empty candidate list"""
        row = pd.Series({"Rep A": 100})
        candidates = []
        
        winner = get_winning_candidate(row, candidates)
        assert winner is None
    
    def test_negative_votes_edge_case(self):
        """BUG: Negative votes would be handled incorrectly"""
        row = pd.Series({
            "Rep A": -100,  # Invalid but possible from data errors
            "Dem B": 50
        })
        candidates = ["Rep A", "Dem B"]
        
        winner = get_winning_candidate(row, candidates)
        assert winner == "Dem B"  # Dem B has max value


# ============================================================================
# TESTS FOR DATA AGGREGATION LOGIC
# ============================================================================

class TestDataAggregation:
    
    def test_sum_aggregation_for_votes(self):
        """Vote columns should be summed during aggregation"""
        df = pd.DataFrame({
            "PRECINCT CODE": ["101", "101", "101"],
            "Rep A": [100, 150, 200],
            "Dem B": [80, 120, 100]
        })
        
        agg_dict = {
            "PRECINCT CODE": "first",
            "Rep A": "sum",
            "Dem B": "sum"
        }
        
        result = df.groupby("PRECINCT CODE", as_index=False).agg(agg_dict)
        
        assert result.loc[0, "Rep A"] == 450
        assert result.loc[0, "Dem B"] == 300
    
    def test_first_aggregation_for_metadata(self):
        """Metadata columns should use 'first' aggregation"""
        df = pd.DataFrame({
            "PRECINCT CODE": ["101", "101"],
            "PRECINCT NAME": ["Downtown A", "Downtown B"],  # Different names!
            "REGISTERED VOTERS TOTAL": [1000, 1000]
        })
        
        agg_dict = {
            "PRECINCT CODE": "first",
            "PRECINCT NAME": "first",
            "REGISTERED VOTERS TOTAL": "first"
        }
        
        result = df.groupby("PRECINCT CODE", as_index=False).agg(agg_dict)
        
        # Takes first value - potential data inconsistency is hidden!
        assert result.loc[0, "PRECINCT NAME"] == "Downtown A"
    
    def test_handles_nan_in_aggregation(self):
        """NaN values should be handled in sum aggregation"""
        df = pd.DataFrame({
            "PRECINCT CODE": ["101", "101"],
            "Rep A": [100, np.nan]
        })
        
        result = df.groupby("PRECINCT CODE")["Rep A"].sum()
        
        # sum() ignores NaN by default
        assert result["101"] == 100


# ============================================================================
# TESTS FOR FILE OUTPUT
# ============================================================================

class TestFileOutput:
    
    def test_safe_filename_generation(self):
        """Race names should be sanitized for filenames"""
        race_name = "U.S. Representative, District 3"
        safe_name = race_name.replace('/', '_').replace(' ', '_')
        
        assert safe_name == "U.S._Representative,_District_3"
        # Note: Commas and periods are NOT replaced - may cause issues on some systems
    
    def test_off_by_one_in_output(self):
        """BUG: iloc[:-1] drops the last row"""
        df = pd.DataFrame({
            "A": [1, 2, 3, 4, 5]
        })
        
        # Current code: agg_df.iloc[:-1].to_csv(...)
        output_df = df.iloc[:-1]
        
        assert len(output_df) == 4  # Row with value 5 is DROPPED!
        assert 5 not in output_df["A"].values
        
        # This appears to be intentional to drop a summary/total row,
        # but should be documented or use a more explicit filter


# ============================================================================
# INTEGRATION-STYLE TESTS
# ============================================================================

class TestElectionSplitterIntegration:
    
    def test_candidate_column_identification(self):
        """Candidate columns are identified by exclusion"""
        all_columns = [
            "COUNTY NUMBER", "PRECINCT CODE", "PRECINCT NAME",
            "REGISTERED VOTERS TOTAL", "BALLOTS CAST TOTAL", "BALLOTS CAST BLANK",
            "Rep Donald Trump", "Dem Joe Biden", "Lib Jo Jorgensen",
            "Write-in", "OVER VOTES", "UNDER VOTES"
        ]
        
        static_exclude = {
            "COUNTY NUMBER", "PRECINCT CODE", "PRECINCT NAME",
            "REGISTERED VOTERS TOTAL", "BALLOTS CAST TOTAL", "BALLOTS CAST BLANK",
            "Write-in", "OVER VOTES", "UNDER VOTES"
        }
        
        candidates = [col for col in all_columns if col not in static_exclude]
        
        assert candidates == ["Rep Donald Trump", "Dem Joe Biden", "Lib Jo Jorgensen"]
    
    def test_end_to_end_flow(self):
        """Simulate end-to-end processing of a small dataset"""
        # Create mock multi-index CSV data
        csv_data = StringIO("""PRECINCT CODE,PRECINCT NAME,Rep A,Dem B
101,Downtown,500,300
102,Uptown,200,400""")
        
        df = pd.read_csv(csv_data)
        
        # Identify candidates
        static = {"PRECINCT CODE", "PRECINCT NAME"}
        candidates = [c for c in df.columns if c not in static]
        
        # Determine winners
        df["Winning Candidate"] = df[candidates].idxmax(axis=1)
        df["Winning Party"] = df["Winning Candidate"].apply(extract_party_from_candidate)
        
        assert df.loc[0, "Winning Candidate"] == "Rep A"
        assert df.loc[0, "Winning Party"] == "Rep"
        assert df.loc[1, "Winning Candidate"] == "Dem B"
        assert df.loc[1, "Winning Party"] == "Dem"


# ============================================================================
# RUN TESTS
# ============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
